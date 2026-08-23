import type { Pool } from 'pg';
import type { Band, Mode, SesReservation, SlotEnforcement } from './types';

/** Postgres raises this when an EXCLUDE constraint rejects a row. For
 *  ses_reservations it means another operator already holds that band/mode
 *  for an overlapping window — see the ses_no_overlap constraint. */
export const EXCLUSION_VIOLATION = '23P01';

/** How far ahead the coordination grid looks for upcoming slots. */
export const UPCOMING_WINDOW_HOURS = 48;

/** Reservations are stored as a single TSTZRANGE so the exclusion constraint
 *  can test overlap directly; clients want two plain timestamps instead. */
export const RESERVATION_COLUMNS = `
  id, event_id, op_call, band, mode, planned_freq, note, status, created_at,
  station_number,
  lower(during) AS starts_at,
  upper(during) AS ends_at
`;

/** pg returns TIMESTAMPTZ as a JS Date, not a string, so interpolating a
 *  reservation bound straight into a message yields the full
 *  "Sat Aug 22 2026 02:24:29 GMT+0000 (...)" form. Operators read UTC. */
export function formatSlotEnd(value: string | Date | null): string {
  if (!value) return 'further notice';
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return 'further notice';
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}Z`;
}

export interface SesEventConfig {
  id: string;
  join_code: string;
  event_type: string;
  slot_enforcement: SlotEnforcement;
  slot_minutes: number;
  dupe_rule: string;
}

/** Resolve an event by either id or join code. Callers accept both because
 *  the WSJT-X bridge and offline queue submit by join code. */
export async function loadEvent(
  pool: Pool,
  { event_id, join_code }: { event_id?: string; join_code?: string }
): Promise<SesEventConfig | null> {
  const { rows } = join_code
    ? await pool.query(
        `SELECT id, join_code, event_type, slot_enforcement, slot_minutes, dupe_rule
         FROM events WHERE join_code = $1`,
        [join_code.toUpperCase()]
      )
    : await pool.query(
        `SELECT id, join_code, event_type, slot_enforcement, slot_minutes, dupe_rule
         FROM events WHERE id = $1`,
        [event_id]
      );
  return rows[0] ?? null;
}

/** The reservation covering (band, mode) right now, if any. */
export async function currentHolder(
  pool: Pool,
  eventId: string,
  band: Band | string,
  mode: Mode | string
): Promise<SesReservation | null> {
  const { rows } = await pool.query(
    `SELECT ${RESERVATION_COLUMNS}
     FROM ses_reservations
     WHERE event_id = $1 AND band = $2 AND mode = $3
       AND status <> 'RELEASED'
       AND during @> NOW()
     LIMIT 1`,
    [eventId, band, mode]
  );
  return rows[0] ?? null;
}

/** Whichever reservation overlaps the given window — used to explain a 409
 *  after the exclusion constraint has already rejected the insert. */
export async function overlappingHolder(
  pool: Pool,
  eventId: string,
  band: Band | string,
  mode: Mode | string,
  startsAt: Date,
  endsAt: Date
): Promise<SesReservation | null> {
  const { rows } = await pool.query(
    `SELECT ${RESERVATION_COLUMNS}
     FROM ses_reservations
     WHERE event_id = $1 AND band = $2 AND mode = $3
       AND status <> 'RELEASED'
       AND during && tstzrange($4, $5, '[)')
     ORDER BY lower(during) ASC
     LIMIT 1`,
    [eventId, band, mode, startsAt, endsAt]
  );
  return rows[0] ?? null;
}

/** Whether an operator is cleared to log on a gated event.
 *
 *  Returns true when the event doesn't require approval at all, so callers
 *  can call this unconditionally. An operator with no roster row on a gated
 *  event is not approved — they have to be added and approved first. */
export async function isOperatorApproved(
  pool: Pool,
  eventId: string,
  opCall: string
): Promise<boolean> {
  const { rows } = await pool.query(
    'SELECT approved FROM ses_operators WHERE event_id=$1 AND op_call=$2',
    [eventId, opCall.toUpperCase().trim()]
  );
  return rows[0]?.approved === true;
}

export interface SlotCheck {
  /** True when this operator may transmit on (band, mode) right now. */
  ok: boolean;
  /** Set when someone *else* holds the slot. */
  heldBy?: string;
  /** Human-readable reason, surfaced to the operator either as a warning
   *  (SOFT enforcement) or as the 409 error body (HARD). */
  reason?: string;
}

/** How a slot's holder reads to an operator.
 *
 *  A special event slot is held by a person — one operator has the club call
 *  on that band and mode. A contest slot is held by a *station*: on Field Day
 *  station 2 holds 20m phone regardless of who is sitting at it, and
 *  operators rotate through stations across the weekend. Naming the operator
 *  there would be actively misleading, since the person changes and the
 *  claim doesn't. */
export function describeHolder(holder: { op_call: string; station_number?: number | null }): string {
  return holder.station_number != null
    ? `Station ${holder.station_number}`
    : holder.op_call;
}

/** Check whether the caller holds the slot for a band/mode.
 *
 *  `stationNumber` is the caller's station on a contest event, and null on a
 *  special event — matching how the holder is recorded. Passing it is what
 *  lets an operator who moved from station 1 to station 2 log on station 2's
 *  slot without re-claiming it.
 *
 *  Note this is only ever advisory input to the caller: under SOFT
 *  enforcement the QSO is logged anyway, and replayed QSOs from the offline
 *  queue skip the check entirely. A contact that already happened on the air
 *  must always make it into the log. */
export async function checkSlot(
  pool: Pool,
  eventId: string,
  opCall: string,
  band: Band | string,
  mode: Mode | string,
  stationNumber: number | null = null,
  requireClaim = true
): Promise<SlotCheck> {
  const holder = await currentHolder(pool, eventId, band, mode);
  if (!holder) {
    // On a special event the checkout is the point: transmitting on a band
    // nobody holds is the thing being coordinated, so an unheld slot is a
    // finding. On a contest, claiming a station's band is opt-in — a club
    // that never uses the schedule must not be warned on every single QSO.
    if (!requireClaim) return { ok: true };
    return { ok: false, reason: `Nobody has checked out ${band} ${mode} right now.` };
  }

  // A contest slot belongs to a station; a special event slot to an operator.
  const mine = holder.station_number != null
    ? holder.station_number === stationNumber
    : holder.op_call === opCall.toUpperCase().trim();

  if (!mine) {
    return {
      ok: false,
      heldBy: describeHolder(holder),
      reason: `${describeHolder(holder)} holds ${band} ${mode} until ${formatSlotEnd(holder.ends_at)}.`,
    };
  }
  return { ok: true };
}
