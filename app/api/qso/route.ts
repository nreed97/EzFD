import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { checkSlot, isOperatorApproved } from '@/lib/ses';
import { badRequest, callsign, isBand, isMode, isUuid, jsonBody, text } from '@/lib/validate';

/** How far back a queued contact may be dated. A browser can hold a contact
 *  through a tab closed overnight; anything older than this is more likely a
 *  wrong clock than a real contact, and is stamped as arriving now. */
const MAX_AGE_MS = 7 * 24 * 3600_000;

export async function POST(request: Request) {
  const body = await jsonBody(request);
  if (!body) return badRequest('Body must be a JSON object');
  const {
    event_id, join_code, band, mode, rcvd_class, rcvd_section,
    operator_call, station_number, is_gota,
    rst_sent, rst_rcvd, rcvd_name, rcvd_qth, rcvd_grid, comment, adif_mode, freq_khz,
    replay, age_ms,
  } = body;

  if ((!event_id && !join_code) || !body.callsign || !band || !mode) {
    return badRequest('Missing required fields');
  }
  if (event_id && !isUuid(event_id)) return badRequest('event_id is not a valid id');
  if (join_code && typeof join_code !== 'string') return badRequest('join_code must be text');
  const call = callsign(body.callsign);
  if (!call) return badRequest(`${String(body.callsign).slice(0, 20)} is not a callsign`);
  if (!isBand(band)) return badRequest(`Unknown band ${String(band).slice(0, 10)}`);
  if (!isMode(mode)) return badRequest('Mode must be PH, CW or DIG');
  const opCall = operator_call == null || operator_call === '' ? null : callsign(operator_call);
  if (operator_call && !opCall) return badRequest('operator_call is not a callsign');

  const pool = getPool();

  const { rows: evRows } = join_code
    ? await pool.query(
        `SELECT id, class, arrl_section, event_type, dupe_rule, slot_enforcement,
                require_operator_approval
         FROM events WHERE join_code = $1`, [String(join_code).toUpperCase()])
    : await pool.query(
        `SELECT id, class, arrl_section, event_type, dupe_rule, slot_enforcement,
                require_operator_approval
         FROM events WHERE id = $1`, [event_id]);
  if (!evRows[0]) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  const event = evRows[0];
  const resolvedEventId = event.id;
  const isSes = event.event_type === 'SES';
  const station = Math.max(1, Math.round(Number(station_number)) || 1);

  // The server's clock stamps every contact, and that stays true. What a
  // queued contact adds is how long ago it was logged, measured by the browser
  // between queueing and sending — two readings of the *same* clock, so how
  // wrong that clock is cancels out. Without it a contact queued through a
  // twenty-minute outage was stamped with the reconnect time, which moved it
  // in the log, could carry it past the end of the contest period, and broke
  // LoTW matching against the other station's log.
  const age = Number(age_ms);
  const ageSeconds = Number.isFinite(age) && age > 0 ? Math.min(age, MAX_AGE_MS) / 1000 : 0;

  // ── Roster approval gate (SES, opt-in per event) ──────────────────────
  //
  // Replays bypass this for the same reason they bypass the slot gate: the
  // contact already happened on the air under the event's callsign, and
  // refusing it only loses the record. A coordinator who didn't want that
  // operator on the air can delete the QSOs; they can't un-transmit them.
  if (isSes && event.require_operator_approval && opCall && !replay) {
    if (!(await isOperatorApproved(pool, resolvedEventId, opCall))) {
      return NextResponse.json(
        { error: `${opCall} is not yet approved to operate this event. Ask the coordinator to approve you.` },
        { status: 403 }
      );
    }
  }

  // ── Band/mode checkout gate (SES only) ────────────────────────────────
  //
  // `replay` marks a QSO coming back off the offline queue. Those are
  // *always* accepted: by the time the browser reconnects the slot has
  // certainly expired, and a contact that already happened on the air must
  // never be dropped because of a network blip. The gate is about
  // coordinating who transmits next, not about vetoing history.
  //
  // Contests get the same coordination, because Field Day has the same
  // one-signal-per-band-per-mode rule — but the holder is the station rather
  // than the operator, and enforcement defaults to SOFT. For a special event
  // two stations signing one callsign is a rules problem, so blocking is
  // defensible; on Field Day it is a coordination problem, and refusing to
  // log a contact that already happened on the air is worse than warning.
  let slotWarning: string | null = null;
  if (opCall && !replay) {
    const slot = await checkSlot(
      pool, resolvedEventId, opCall, band, mode,
      isSes ? null : station,
      isSes,   // an unclaimed band is only a finding on a special event
    );
    if (!slot.ok) {
      if (event.slot_enforcement === 'HARD') {
        return NextResponse.json(
          { error: slot.reason ?? 'You do not hold this band/mode', held_by: slot.heldBy ?? null },
          { status: 409 }
        );
      }
      slotWarning = slot.reason ?? null;
    }
  }

  const freq = Number(freq_khz);
  const client = await pool.connect();
  let row;
  try {
    await client.query('BEGIN');
    // Two operators logging the same station in the same instant each saw
    // the other's contact as not yet there, and both were stored as the one
    // that counts. Serialising on the dupe group closes that.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',
      [`${resolvedEventId}|${call}|${band}|${mode}`]);

    const { rows } = await client.query(
      `INSERT INTO qsos
         (event_id, callsign, band, mode, datetime_utc, sent_class, sent_section,
          rcvd_class, rcvd_section, operator_call, station_number, is_dupe,
          rst_sent, rst_rcvd, rcvd_name, rcvd_qth, rcvd_grid, comment, adif_mode, freq_khz,
          is_gota)
       VALUES ($1,$2,$3,$4,NOW() - make_interval(secs => $20::double precision),$5,$6,$7,$8,$9,$10,false,
               $11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING id`,
      [
        resolvedEventId,
        call,
        band,
        mode,
        // An SES has no contest class, so that stays NULL rather than stamping
        // every contact with one that doesn't exist. The section is different:
        // it's optional on an SES but still worth recording, since special
        // events run outside FD/WFD and operators still trade sections.
        isSes ? null : event.class,
        event.arrl_section ?? null,
        isSes ? null : text(rcvd_class, { upper: true, max: 4 }),
        text(rcvd_section, { upper: true, max: 5 }),
        opCall,
        station,
        text(rst_sent, { max: 10 }),
        text(rst_rcvd, { max: 10 }),
        text(rcvd_name, { max: 60 }),
        text(rcvd_qth, { max: 60 }),
        text(rcvd_grid, { upper: true, max: 10 }),
        text(comment),
        text(adif_mode, { upper: true, max: 20 }),
        Number.isFinite(freq) && freq > 0 && freq < 300_000_000 ? Math.round(freq) : null,
        // Only a Field Day entry has a GOTA station (rule 7.3.13.1 lists it for
        // classes A and F). A flag arriving on an SES or WFD contact is ignored
        // rather than stored, so a stale bookmark cannot invent a bonus that
        // does not exist for that event type.
        event.event_type === 'FD' ? is_gota === true : false,
        ageSeconds,
      ]
    );

    // Settled for the group rather than guessed for the row: a backdated
    // replay can land before a contact already logged, and then it is the
    // later one that becomes the dupe.
    await client.query('SELECT ezfd_recompute_dupes($1, $2, $3, $4)',
      [resolvedEventId, call, band, mode]);
    ({ rows: [row] } = await client.query('SELECT * FROM qsos WHERE id = $1', [rows[0].id]));
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  // The QSO is created either way; the warning is advisory for the operator.
  return NextResponse.json(
    slotWarning ? { ...row, slot_warning: slotWarning } : row,
    { status: 201 }
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const eventId = url.searchParams.get('event_id');
  if (!eventId) return NextResponse.json({ error: 'event_id required' }, { status: 400 });
  if (!isUuid(eventId)) return badRequest('event_id is not a valid id');

  // ?deleted=1 asks for the soft-deleted contacts instead of the live log —
  // the recovery view. Everything else sees only live rows.
  const wantDeleted = url.searchParams.get('deleted') === '1';

  const pool = getPool();
  const { rows } = await pool.query(
    wantDeleted
      ? 'SELECT * FROM qsos WHERE event_id=$1 AND deleted_at IS NOT NULL ORDER BY deleted_at DESC'
      : 'SELECT * FROM qsos WHERE event_id=$1 AND deleted_at IS NULL ORDER BY datetime_utc DESC',
    [eventId]
  );
  return NextResponse.json(rows);
}
