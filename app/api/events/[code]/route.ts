import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { EVENT_COLUMNS } from '@/lib/events';

export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const pool = getPool();

  const { rows } = await pool.query(
    `SELECT ${EVENT_COLUMNS} FROM events WHERE join_code = $1`,
    [code.toUpperCase()]
  );

  if (!rows[0]) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  return NextResponse.json(rows[0]);
}
