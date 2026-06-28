import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await getPool().query('DELETE FROM qsos WHERE id=$1', [id]);
  return NextResponse.json({ ok: true });
}
