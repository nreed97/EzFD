import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { badRequest, callsign as asCallsign, isBand, isMode, isUuid, jsonBody } from '@/lib/validate';

const STALE_SECONDS = 90;

export async function POST(request: Request) {
  const body = await jsonBody(request);
  if (!body) return badRequest('Body must be a JSON object');
  const { event_id, station, band, mode } = body;
  if (!event_id || !body.op_call || !band || !mode) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  }
  const op_call = asCallsign(body.op_call);
  if (!isUuid(event_id) || !op_call || !isBand(band) || !isMode(mode)) {
    return badRequest('Not a valid event, callsign, band or mode');
  }

  const pool = getPool();
  // Rows nobody has refreshed in a day are windows closed without a QRT
  // (a lid shut, a battery gone). Every read already ignores them; this keeps
  // the table from growing all weekend. Cheap enough to do on each heartbeat:
  // the table holds one row per open window.
  await pool.query(`DELETE FROM presence WHERE updated_at < NOW() - INTERVAL '1 day'`);
  await pool.query(
    `INSERT INTO presence (event_id, op_call, station, band, mode, updated_at)
     VALUES ($1,$2,$3,$4,$5,NOW())
     ON CONFLICT (event_id, op_call, station)
     DO UPDATE SET band=$4, mode=$5, updated_at=NOW()`,
    [event_id, op_call, Math.max(1, Math.round(Number(station)) || 1), band, mode]
  );

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const body = await jsonBody(request);
  if (!body) return badRequest('Body must be a JSON object');
  const { event_id, station } = body;
  const op_call = asCallsign(body.op_call);
  if (!event_id || !op_call) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  }
  if (!isUuid(event_id)) return badRequest('event_id is not a valid id');
  const pool = getPool();
  // Going QRT is per radio, not per person: an operator running two rigs who
  // shuts one down is still on the air on the other. Without the station term
  // this cleared every window they had open.
  await pool.query(
    `DELETE FROM presence WHERE event_id=$1 AND op_call=$2 AND station=$3`,
    [event_id, op_call, Math.max(1, Math.round(Number(station)) || 1)]
  );
  return NextResponse.json({ ok: true });
}

export async function GET(request: Request) {
  const eventId = new URL(request.url).searchParams.get('event_id');
  if (!eventId) return NextResponse.json({ error: 'event_id required' }, { status: 400 });
  if (!isUuid(eventId)) return badRequest('event_id is not a valid id');

  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT op_call, station, band, mode, updated_at
     FROM presence
     WHERE event_id=$1
       AND updated_at > NOW() - INTERVAL '${STALE_SECONDS} seconds'
     ORDER BY station ASC`,
    [eventId]
  );

  return NextResponse.json(rows);
}
