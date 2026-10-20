import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { badRequest, jsonBody } from '@/lib/validate';

export async function PATCH(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const bonuses = await jsonBody(request);
  // The bonus claims are a flat object of numbers and flags; anything else
  // (or anything large) is not a bonus sheet, and this row is read by every
  // score on every screen.
  if (!bonuses) return badRequest('Body must be a JSON object');
  if (JSON.stringify(bonuses).length > 10_000) return badRequest('Bonus claims are too large');

  const pool = getPool();
  const { rows } = await pool.query(
    `UPDATE events SET bonuses = $1 WHERE join_code = $2 RETURNING bonuses`,
    [JSON.stringify(bonuses), code.toUpperCase()]
  );

  if (!rows[0]) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  return NextResponse.json(rows[0].bonuses);
}
