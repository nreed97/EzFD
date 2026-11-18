import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { parseAdif, type AdifQSO } from '@/lib/adif';
import { MERGE_WINDOW_SECONDS } from '@/lib/events';
import { badRequest, callsign as asCallsign, isUuid, jsonBody, text } from '@/lib/validate';

/** Larger than any real contest log, and small enough that a stray upload of
 *  something else cannot hold the server's memory. */
const MAX_ADIF_BYTES = 20 * 1024 * 1024;

export async function POST(request: Request) {
  if (Number(request.headers.get('content-length')) > MAX_ADIF_BYTES) {
    return NextResponse.json({ error: 'ADIF file is too large' }, { status: 413 });
  }
  const body = await jsonBody(request);
  if (!body) return badRequest('Body must be a JSON object');

  const { event_id, adif, operator_call, station_number } = body;
  if (!event_id || !adif) return badRequest('Missing event_id or adif');
  if (!isUuid(event_id)) return badRequest('event_id is not a valid id');
  if (typeof adif !== 'string') return badRequest('adif must be text');

  const pool = getPool();
  const { rows: evRows } = await pool.query(
    'SELECT id, class, arrl_section, event_type, dupe_rule FROM events WHERE id = $1',
    [event_id]
  );
  if (!evRows[0]) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  const event = evRows[0];
  const isSes = event.event_type === 'SES';
  const opCall = asCallsign(operator_call);
  const station = Math.max(1, Math.round(Number(station_number)) || 1);

  const records = parseAdif(adif);
  let skipped = 0;

  // The same contact twice in one file is collapsed here. The old loop caught
  // it by accident, inserting one row and then finding it on the next pass;
  // the batched insert below checks against what was already in the log, so
  // the file has to be consistent with itself first.
  const now = Date.now();
  const kept: (AdifQSO & { at: Date; call: string })[] = [];
  for (const rec of records) {
    const call = asCallsign(rec.callsign);
    if (!rec.band || !call) { skipped++; continue; }
    const at = rec.datetime_utc ? new Date(rec.datetime_utc) : new Date(now);
    const twin = kept.find(k =>
      k.call === call && k.band === rec.band && k.mode === rec.mode
      && Math.abs(k.at.getTime() - at.getTime()) <= MERGE_WINDOW_SECONDS * 1000);
    if (twin) continue;
    kept.push({ ...rec, call, at });
  }

  // One transaction, one INSERT. This used to be two queries per record
  // outside any transaction, so a large file took thousands of round trips
  // and a failure partway left half of it in the log.
  //
  // Idempotency is the NOT EXISTS: importing is how an operator who logged
  // offline in N1MM or N3FJP merges into the central log, and re-importing the
  // same file — or two operators importing an overlapping export — must not
  // double the log. That is distinct from the dupe *rule*, which flags a
  // contact worked twice on the air.
  //
  // A soft-deleted contact counts as absent, so re-importing a file brings it
  // back. Deleting removes a mistake from the log; deliberately importing a
  // file that contains it is a second, explicit act, and a silent no-op the
  // operator couldn't explain would be worse.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: inserted } = await client.query(
      `INSERT INTO qsos
         (event_id, callsign, band, mode, datetime_utc, sent_class, sent_section,
          rcvd_class, rcvd_section, operator_call, station_number, is_dupe,
          adif_mode, freq_khz)
       SELECT $1, r.callsign, r.band, r.mode, r.at, $2, $3,
              NULLIF(r.rcvd_class, ''), NULLIF(r.rcvd_section, ''), $4, $5, false,
              r.adif_mode, r.freq_khz
         FROM unnest($6::text[], $7::text[], $8::text[], $9::timestamptz[],
                     $10::text[], $11::text[], $12::text[], $13::int[])
              AS r(callsign, band, mode, at, rcvd_class, rcvd_section, adif_mode, freq_khz)
        WHERE NOT EXISTS (
          SELECT 1 FROM qsos q
           WHERE q.event_id = $1 AND q.callsign = r.callsign AND q.band = r.band
             AND q.mode = r.mode AND q.deleted_at IS NULL
             AND ABS(EXTRACT(EPOCH FROM (q.datetime_utc - r.at))) <= $14)
       RETURNING id`,
      [
        event.id,
        // A special event station has no contest exchange to stamp.
        isSes ? null : event.class,
        isSes ? null : event.arrl_section,
        opCall,
        station,
        kept.map(r => r.call),
        kept.map(r => r.band),
        kept.map(r => r.mode),
        kept.map(r => r.at),
        kept.map(r => (isSes ? '' : text(r.rcvd_class, { upper: true, max: 4 }) ?? '')),
        kept.map(r => (isSes ? '' : text(r.rcvd_section, { upper: true, max: 5 }) ?? '')),
        kept.map(r => r.adif_mode ?? null),
        kept.map(r => r.freq_khz ?? null),
        MERGE_WINDOW_SECONDS,
      ]
    );

    // Imported contacts can land anywhere in time, including before ones
    // already logged, so the dupe flags are settled over the whole event once
    // rather than guessed per row against a log still being written.
    await client.query('SELECT ezfd_recompute_dupes($1)', [event.id]);
    const ids = inserted.map(r => r.id);
    const { rows: [{ dupes }] } = await client.query(
      'SELECT count(*)::int AS dupes FROM qsos WHERE id = ANY($1::uuid[]) AND is_dupe',
      [ids]
    );
    await client.query('COMMIT');

    return NextResponse.json({
      imported: ids.length - dupes,
      dupes,
      skipped,
      already_present: records.length - skipped - ids.length,
      total: records.length,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
