import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

const STALE_SECONDS = 90;

export async function POST(request: Request) {
  const { event_id, op_call, station, band, mode } = await request.json();
  if (!event_id || !op_call || !band || !mode) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  }

  const pool = getPool();
  await pool.query(
    `INSERT INTO presence (event_id, op_call, station, band, mode, updated_at)
     VALUES ($1,$2,$3,$4,$5,NOW())
     ON CONFLICT (event_id, op_call)
     DO UPDATE SET station=$3, band=$4, mode=$5, updated_at=NOW()`,
    [event_id, op_call.toUpperCase().trim(), station ?? 1, band, mode]
  );

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const { event_id, op_call } = await request.json();
  if (!event_id || !op_call) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  }
  const pool = getPool();
  await pool.query(
    `DELETE FROM presence WHERE event_id=$1 AND op_call=$2`,
    [event_id, op_call.toUpperCase().trim()]
  );
  return NextResponse.json({ ok: true });
}

export async function GET(request: Request) {
  const eventId = new URL(request.url).searchParams.get('event_id');
  if (!eventId) return NextResponse.json({ error: 'event_id required' }, { status: 400 });

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
