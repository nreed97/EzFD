import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import {
  EXCLUSION_VIOLATION,
  RESERVATION_COLUMNS,
  UPCOMING_WINDOW_HOURS,
  formatSlotEnd,
  loadEvent,
  overlappingHolder,
  describeHolder,
} from '@/lib/ses';
import { BANDS, MODES } from '@/lib/types';

/**
 * Current and upcoming call checkouts for the coordination grid.
 * Released slots and slots that have already ended are omitted by default.
 *
 * The dashboard timeline needs history too — "who had 20m PH before me" is
 * the whole point of it — so two opt-in params widen the result. Both
 * default to the original behaviour, so the logging-page panel and the
 * dashboard sidebar are unaffected.
 *
 *   past_hours=N        also return slots overlapping the N hours before now
 *   include_released=1  also return RELEASED slots, which are the record of
 *                       who actually held the call earlier
 *
 * A slot cancelled before it ever started is clamped to a zero-length range
 * by the release path; those never appear here regardless of the params,
 * because an empty range doesn't overlap anything under `&&`.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const eventId = params.get('event_id');
  if (!eventId) return NextResponse.json({ error: 'event_id required' }, { status: 400 });

  const rawPast = Number(params.get('past_hours'));
  // Clamp: a hostile or fat-fingered value must not turn this into a full
  // table scan of a multi-week special event.
  const pastHours = Number.isFinite(rawPast) ? Math.min(Math.max(rawPast, 0), 168) : 0;
  const includeReleased = params.get('include_released') === '1';

  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT ${RESERVATION_COLUMNS}
     FROM ses_reservations
     WHERE event_id = $1
       AND ($4::boolean OR status <> 'RELEASED')
       AND during && tstzrange(
             NOW() - ($3 || ' hours')::interval,
             NOW() + ($2 || ' hours')::interval,
             '[)')
     ORDER BY lower(during) ASC`,
    [eventId, String(UPCOMING_WINDOW_HOURS), String(pastHours), includeReleased]
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
  const { event_id, join_code, op_call, band, mode, minutes, starts_at, planned_freq, note,
          station_number } = body;

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
  // Contests coordinate the same way. Field Day has the same
  // one-signal-per-band-per-mode rule, and a 3A club running three
  // transmitters has exactly the problem this already solves — the difference
  // is only who holds a slot: an operator for a special event, a station for a
  // contest.
  const isSes = event.event_type === 'SES';

  const opCall = op_call.toUpperCase().trim();
  // Which position holds the slot. On a contest that is the transmitter, and
  // it is what "mine" is tested against. On a special event the *operator*
  // still holds the callsign — but one operator can run two radios from two
  // windows, and without a station recorded both claims look identical, so
  // leaving one band released the other's slot. Recording it disambiguates
  // the windows; describeHolder() still shows an SES holder as their call.
  const stationNumber = Math.max(1, parseInt(String(station_number ?? 1), 10) || 1);
  const start = starts_at ? new Date(starts_at) : new Date();
  if (isNaN(start.getTime())) {
    return NextResponse.json({ error: 'Invalid starts_at' }, { status: 400 });
  }
  const lengthMinutes = Number(minutes) > 0 ? Number(minutes) : event.slot_minutes;
  const end = new Date(start.getTime() + lengthMinutes * 60_000);

  try {
    const { rows } = await pool.query(
      `INSERT INTO ses_reservations (event_id, op_call, band, mode, during, planned_freq, note, station_number)
       VALUES ($1, $2, $3, $4, tstzrange($5, $6, '[)'), $7, $8, $9)
       RETURNING ${RESERVATION_COLUMNS}`,
      [event.id, opCall, band, mode, start, end, planned_freq?.trim() || null, note?.trim() || null,
       stationNumber]
    );
    return NextResponse.json(rows[0], { status: 201 });
  } catch (err) {
    if ((err as { code?: string }).code === EXCLUSION_VIOLATION) {
      const holder = await overlappingHolder(pool, event.id, band, mode, start, end);
      return NextResponse.json(
        {
          error: holder
            ? `${describeHolder(holder, isSes)} already holds ${band} ${mode} until ${formatSlotEnd(holder.ends_at)}`
            : `${band} ${mode} is already claimed for that window`,
          holder,
        },
        { status: 409 }
      );
    }
    throw err;
  }
}
