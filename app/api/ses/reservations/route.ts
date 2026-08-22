import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import {
  EXCLUSION_VIOLATION,
  RESERVATION_COLUMNS,
  UPCOMING_WINDOW_HOURS,
  formatSlotEnd,
  loadEvent,
  overlappingHolder,
} from '@/lib/ses';
import { BANDS, MODES } from '@/lib/types';

/**
 * Current and upcoming call checkouts for the coordination grid.
 * Released slots and slots that have already ended are omitted.
 */
export async function GET(request: Request) {
  const eventId = new URL(request.url).searchParams.get('event_id');
  if (!eventId) return NextResponse.json({ error: 'event_id required' }, { status: 400 });

  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT ${RESERVATION_COLUMNS}
     FROM ses_reservations
     WHERE event_id = $1
       AND status <> 'RELEASED'
       AND during && tstzrange(NOW(), NOW() + ($2 || ' hours')::interval, '[)')
     ORDER BY lower(during) ASC`,
    [eventId, String(UPCOMING_WINDOW_HOURS)]
  );

  return NextResponse.json(rows);
}

/**
 * Check out the shared callsign for a band/mode window.
 *
 * Overlap is rejected by the ses_no_overlap exclusion constraint rather than
 * by a SELECT-then-INSERT here, which would race between two operators
 * claiming the same slot at the same instant. The constraint violation is
 * translated into a 409 naming whoever already holds it.
 */
export async function POST(request: Request) {
  const body = await request.json();
  const { event_id, join_code, op_call, band, mode, minutes, starts_at, planned_freq, note } = body;

  if ((!event_id && !join_code) || !op_call || !band || !mode) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }
  if (!(BANDS as readonly string[]).includes(band)) {
    return NextResponse.json({ error: `Unknown band "${band}"` }, { status: 400 });
  }
  if (!(MODES as readonly string[]).includes(mode)) {
    return NextResponse.json({ error: `Unknown mode "${mode}"` }, { status: 400 });
  }

  const pool = getPool();
  const event = await loadEvent(pool, { event_id, join_code });
  if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  if (event.event_type !== 'SES') {
    return NextResponse.json(
      { error: 'Call checkout only applies to special event stations' },
      { status: 400 }
    );
  }

  const opCall = op_call.toUpperCase().trim();
  const start = starts_at ? new Date(starts_at) : new Date();
  if (isNaN(start.getTime())) {
    return NextResponse.json({ error: 'Invalid starts_at' }, { status: 400 });
  }
  const lengthMinutes = Number(minutes) > 0 ? Number(minutes) : event.slot_minutes;
  const end = new Date(start.getTime() + lengthMinutes * 60_000);

  try {
    const { rows } = await pool.query(
      `INSERT INTO ses_reservations (event_id, op_call, band, mode, during, planned_freq, note)
       VALUES ($1, $2, $3, $4, tstzrange($5, $6, '[)'), $7, $8)
       RETURNING ${RESERVATION_COLUMNS}`,
      [event.id, opCall, band, mode, start, end, planned_freq?.trim() || null, note?.trim() || null]
    );
    return NextResponse.json(rows[0], { status: 201 });
  } catch (err) {
    if ((err as { code?: string }).code === EXCLUSION_VIOLATION) {
      const holder = await overlappingHolder(pool, event.id, band, mode, start, end);
      return NextResponse.json(
        {
          error: holder
            ? `${holder.op_call} already holds ${band} ${mode} until ${formatSlotEnd(holder.ends_at)}`
            : `${band} ${mode} is already checked out for that window`,
          holder,
        },
        { status: 409 }
      );
    }
    throw err;
  }
}
