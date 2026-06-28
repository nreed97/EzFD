import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { parseAdif } from '@/lib/adif';

export async function POST(request: Request) {
  const body = await request.json() as {
    event_id?: string;
    adif?: string;
    operator_call?: string;
    station_number?: number;
  };

  const { event_id, adif, operator_call, station_number } = body;
  if (!event_id || !adif) {
    return NextResponse.json({ error: 'Missing event_id or adif' }, { status: 400 });
  }

  const pool = getPool();
  const { rows: evRows } = await pool.query(
    'SELECT class, arrl_section FROM events WHERE id = $1',
    [event_id]
  );
  if (!evRows[0]) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  const event = evRows[0];

  const records = parseAdif(adif);
  let imported = 0, dupes = 0, skipped = 0;

  for (const rec of records) {
    if (!rec.band) { skipped++; continue; }

    const callsign = rec.callsign;

    const { rows: dupeRows } = await pool.query(
      `SELECT id FROM qsos
       WHERE event_id=$1 AND callsign=$2 AND band=$3 AND mode=$4 AND is_dupe=false
       LIMIT 1`,
      [event_id, callsign, rec.band, rec.mode]
    );
    const is_dupe = dupeRows.length > 0;
    is_dupe ? dupes++ : imported++;

    const dt = rec.datetime_utc ? new Date(rec.datetime_utc) : new Date();

    await pool.query(
      `INSERT INTO qsos
         (event_id, callsign, band, mode, datetime_utc, sent_class, sent_section,
          rcvd_class, rcvd_section, operator_call, station_number, is_dupe)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        event_id,
        callsign,
        rec.band,
        rec.mode,
        dt,
        event.class,
        event.arrl_section,
        rec.rcvd_class  || null,
        rec.rcvd_section || null,
        operator_call?.toUpperCase().trim() ?? null,
        station_number ?? 1,
        is_dupe,
      ]
    );
  }

  return NextResponse.json({ imported, dupes, skipped, total: records.length });
}
