import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const pool = getPool();

  const { rows } = await pool.query(
    `SELECT id, join_code, club_name, club_call, event_year, class, arrl_section,
            location, qrz_username, bonuses, created_at
     FROM events WHERE join_code = $1`,
    [code.toUpperCase()]
  );

  if (!rows[0]) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  return NextResponse.json(rows[0]);
}
