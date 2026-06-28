import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

export async function POST(request: Request) {
  const body = await request.json();
  const { event_id, callsign, band, mode, rcvd_class, rcvd_section, operator_call, station_number } = body;

  if (!event_id || !callsign || !band || !mode) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const pool = getPool();

  const { rows: evRows } = await pool.query(
    'SELECT class, arrl_section FROM events WHERE id = $1',
    [event_id]
  );
  if (!evRows[0]) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  const event = evRows[0];

  // Dupe check
  const { rows: dupeRows } = await pool.query(
    `SELECT id FROM qsos
     WHERE event_id=$1 AND callsign=$2 AND band=$3 AND mode=$4 AND is_dupe=false
     LIMIT 1`,
    [event_id, callsign.toUpperCase().trim(), band, mode]
  );
  const is_dupe = dupeRows.length > 0;

  const { rows } = await pool.query(
    `INSERT INTO qsos
       (event_id, callsign, band, mode, datetime_utc, sent_class, sent_section,
        rcvd_class, rcvd_section, operator_call, station_number, is_dupe)
     VALUES ($1,$2,$3,$4,NOW(),$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      event_id,
      callsign.toUpperCase().trim(),
      band,
      mode,
      event.class,
      event.arrl_section,
      rcvd_class?.toUpperCase().trim() ?? null,
      rcvd_section?.toUpperCase().trim() ?? null,
      operator_call?.toUpperCase().trim() ?? null,
      station_number ?? 1,
      is_dupe,
    ]
  );

  return NextResponse.json(rows[0], { status: 201 });
}

export async function GET(request: Request) {
  const eventId = new URL(request.url).searchParams.get('event_id');
  if (!eventId) return NextResponse.json({ error: 'event_id required' }, { status: 400 });

  const pool = getPool();
  const { rows } = await pool.query(
    'SELECT * FROM qsos WHERE event_id=$1 ORDER BY datetime_utc DESC',
    [eventId]
  );
  return NextResponse.json(rows);
}
