import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

export async function PATCH(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const bonuses = await request.json();

  const pool = getPool();
  const { rows } = await pool.query(
    `UPDATE events SET bonuses = $1 WHERE join_code = $2 RETURNING bonuses`,
    [JSON.stringify(bonuses), code.toUpperCase()]
  );

  if (!rows[0]) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  return NextResponse.json(rows[0].bonuses);
}
