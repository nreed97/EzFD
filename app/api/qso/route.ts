import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { checkSlot, isOperatorApproved } from '@/lib/ses';
import { isDupeQSO } from '@/lib/events';

export async function POST(request: Request) {
  const body = await request.json();
  const {
    event_id, join_code, callsign, band, mode, rcvd_class, rcvd_section,
    operator_call, station_number,
    rst_sent, rst_rcvd, rcvd_name, rcvd_qth, rcvd_grid, comment, adif_mode, freq_khz,
    replay,
  } = body;

  if ((!event_id && !join_code) || !callsign || !band || !mode) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const pool = getPool();

  const { rows: evRows } = join_code
    ? await pool.query(
        `SELECT id, class, arrl_section, event_type, dupe_rule, slot_enforcement,
                require_operator_approval
         FROM events WHERE join_code = $1`, [join_code.toUpperCase()])
    : await pool.query(
        `SELECT id, class, arrl_section, event_type, dupe_rule, slot_enforcement,
                require_operator_approval
         FROM events WHERE id = $1`, [event_id]);
  if (!evRows[0]) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  const event = evRows[0];
  const resolvedEventId = event.id;
  const isSes = event.event_type === 'SES';

  const call = callsign.toUpperCase().trim();
  const opCall = operator_call?.toUpperCase().trim() ?? null;
  const now = new Date();

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
      isSes ? null : Math.max(1, Number(station_number) || 1),
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

  const is_dupe = await isDupeQSO(
    pool, resolvedEventId, call, band, mode, event.dupe_rule ?? 'EVENT', now
  );

  const { rows } = await pool.query(
    `INSERT INTO qsos
       (event_id, callsign, band, mode, datetime_utc, sent_class, sent_section,
        rcvd_class, rcvd_section, operator_call, station_number, is_dupe,
        rst_sent, rst_rcvd, rcvd_name, rcvd_qth, rcvd_grid, comment, adif_mode, freq_khz)
     VALUES ($1,$2,$3,$4,NOW(),$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     RETURNING *`,
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
      isSes ? null : (rcvd_class?.toUpperCase().trim() ?? null),
      rcvd_section?.toUpperCase().trim() || null,
      opCall,
      station_number ?? 1,
      is_dupe,
      rst_sent?.trim() || null,
      rst_rcvd?.trim() || null,
      rcvd_name?.trim() || null,
      rcvd_qth?.trim() || null,
      rcvd_grid?.toUpperCase().trim() || null,
      comment?.trim() || null,
      adif_mode?.toUpperCase().trim() || null,
      Number.isFinite(Number(freq_khz)) && freq_khz ? Math.round(Number(freq_khz)) : null,
    ]
  );

  // The QSO is created either way; the warning is advisory for the operator.
  return NextResponse.json(
    slotWarning ? { ...rows[0], slot_warning: slotWarning } : rows[0],
    { status: 201 }
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const eventId = url.searchParams.get('event_id');
  if (!eventId) return NextResponse.json({ error: 'event_id required' }, { status: 400 });

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
