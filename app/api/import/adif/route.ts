import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { parseAdif } from '@/lib/adif';
import { isDupeQSO } from '@/lib/events';

/** How close two contacts must be in time to be considered the same QSO
 *  arriving twice. ADIF only carries minute resolution, and a logger may
 *  round differently, so an exact timestamp match is too strict. */
const MERGE_WINDOW_SECONDS = 120;

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
    'SELECT id, class, arrl_section, event_type, dupe_rule FROM events WHERE id = $1',
    [event_id]
  );
  if (!evRows[0]) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  const event = evRows[0];
  const isSes = event.event_type === 'SES';

  const records = parseAdif(adif);
  let imported = 0, dupes = 0, skipped = 0, alreadyPresent = 0;

  for (const rec of records) {
    if (!rec.band) { skipped++; continue; }

    const callsign = rec.callsign;
    const dt = rec.datetime_utc ? new Date(rec.datetime_utc) : new Date();

    // Idempotency. Importing is how an operator who logged offline in N1MM
    // or N3FJP merges into the central log, and re-importing the same file —
    // or two operators importing an overlapping export — must not double the
    // log. This is distinct from the dupe *rule* below: that flags a contact
    // worked twice on the air, this detects the same contact arriving twice.
    const { rows: seen } = await pool.query(
      `SELECT id FROM qsos
       WHERE event_id=$1 AND callsign=$2 AND band=$3 AND mode=$4
         AND ABS(EXTRACT(EPOCH FROM (datetime_utc - $5::timestamptz))) <= $6
       LIMIT 1`,
      [event_id, callsign, rec.band, rec.mode, dt, MERGE_WINDOW_SECONDS]
    );
    if (seen.length > 0) { alreadyPresent++; continue; }

    const is_dupe = await isDupeQSO(
      pool, event_id, callsign, rec.band, rec.mode, event.dupe_rule ?? 'EVENT', dt
    );
    is_dupe ? dupes++ : imported++;

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
        // A special event station has no contest exchange to stamp.
        isSes ? null : event.class,
        isSes ? null : event.arrl_section,
        isSes ? null : (rec.rcvd_class  || null),
        isSes ? null : (rec.rcvd_section || null),
        operator_call?.toUpperCase().trim() ?? null,
        station_number ?? 1,
        is_dupe,
      ]
    );
  }

  return NextResponse.json({
    imported,
    dupes,
    skipped,
    already_present: alreadyPresent,
    total: records.length,
  });
}
