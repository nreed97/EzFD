import type { Band, Mode, SesReservation } from './types';

/**
 * What each band and mode is doing right now, for the operating position
 * picker.
 *
 * Pure over data the caller has already fetched — reservations and presence —
 * with `nowMs` passed in rather than read, so the same inputs always give the
 * same answer and this is testable without a browser or a database.
 *
 * Two different things make a slot busy, and an operator choosing where to sit
 * needs to tell them apart:
 *
 *   a *claim* is somebody having booked the band and mode through the checkout
 *   system, which is what the database constraint enforces;
 *
 *   *presence* is somebody's logging window reporting that they are actually
 *   sitting on it, claimed or not.
 *
 * A band can be claimed and empty (booked for later in the shift), or busy and
 * unclaimed (a contest where claiming is opt-in). Collapsing the two would
 * hide exactly the case worth seeing.
 */

export type SlotState = 'open' | 'mine' | 'claimed' | 'busy';

export interface SlotInfo {
  band: Band;
  mode: Mode;
  state: SlotState;
  /** Who holds the claim, already formatted for display. */
  heldBy?: string;
  /** When the claim ends, ISO. Absent on an open-ended claim. */
  until?: string | null;
  /** Callsigns whose logging window reports them here, claim or no claim. */
  onAir: string[];
}

export interface PresenceRow {
  op_call: string;
  station: number;
  band: string;
  mode: string;
}

export const slotKey = (band: string, mode: string) => `${band}|${mode}`;

function activeAt(r: SesReservation, nowMs: number): boolean {
  if (r.status === 'RELEASED') return false;
  const start = new Date(r.starts_at).getTime();
  const end = r.ends_at ? new Date(r.ends_at).getTime() : Infinity;
  // A start we cannot parse is treated as active rather than dropped: hiding a
  // real claim would let someone take a band that is already spoken for, which
  // is worse than showing one claim too many.
  if (!Number.isFinite(start)) return true;
  return start <= nowMs && end > nowMs;
}

/**
 * Build the board.
 *
 * `myCall` and `myStation` decide which claims read as yours. A contest claim
 * belongs to a station and a special event claim to an operator — the same
 * split `checkSlot` uses, so the picker and the logging gate agree about whose
 * slot is whose.
 */
export function buildSlotBoard(
  bands: Band[],
  modes: Mode[],
  reservations: SesReservation[],
  presence: PresenceRow[],
  nowMs: number,
  opts: { myCall?: string; myStation?: number | null; isSes?: boolean } = {},
): Map<string, SlotInfo> {
  const myCall = (opts.myCall ?? '').toUpperCase().trim();
  const isSes = opts.isSes ?? false;

  const claims = new Map<string, SesReservation>();
  for (const r of reservations) {
    if (!activeAt(r, nowMs)) continue;
    // First active claim wins the display. The database constraint makes two
    // overlapping claims on one band and mode impossible, so this only ever
    // picks between a claim and nothing.
    const k = slotKey(r.band, r.mode);
    if (!claims.has(k)) claims.set(k, r);
  }

  const here = new Map<string, string[]>();
  for (const p of presence) {
    const k = slotKey(p.band, p.mode);
    const list = here.get(k) ?? [];
    if (!list.includes(p.op_call)) list.push(p.op_call);
    here.set(k, list);
  }

  const board = new Map<string, SlotInfo>();
  for (const band of bands) {
    for (const mode of modes) {
      const k = slotKey(band, mode);
      const claim = claims.get(k);
      const onAir = here.get(k) ?? [];

      let state: SlotState = 'open';
      let heldBy: string | undefined;
      let until: string | null | undefined;

      if (claim) {
        const mine = isSes
          ? claim.op_call.toUpperCase() === myCall
          : claim.station_number != null && claim.station_number === opts.myStation;
        state = mine ? 'mine' : 'claimed';
        heldBy = (!isSes && claim.station_number != null)
          ? `Station ${claim.station_number}`
          : claim.op_call;
        until = claim.ends_at;
      } else if (onAir.length > 0) {
        // Nobody booked it, but somebody is sitting on it. On a contest, where
        // claiming is opt-in, this is the normal case rather than a problem.
        state = 'busy';
      }

      board.set(k, { band, mode, state, heldBy, until, onAir });
    }
  }
  return board;
}

/** A one-line summary for the picker's header — how much is free. */
export function countOpen(board: Map<string, SlotInfo>): { open: number; total: number } {
  let open = 0;
  for (const s of board.values()) if (s.state === 'open') open++;
  return { open, total: board.size };
}
