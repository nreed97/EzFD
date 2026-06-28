import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await getPool().query('DELETE FROM qsos WHERE id=$1', [id]);
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { callsign, band, mode, rcvd_class, rcvd_section } = await req.json();

  if (!callsign || !band || !mode) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const pool = getPool();
  const { rows: cur } = await pool.query('SELECT event_id FROM qsos WHERE id=$1', [id]);
  if (!cur[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Re-evaluate dupe status after edit
  const { rows: dupeRows } = await pool.query(
    `SELECT id FROM qsos
     WHERE event_id=$1 AND callsign=$2 AND band=$3 AND mode=$4 AND is_dupe=false AND id!=$5
     LIMIT 1`,
    [cur[0].event_id, callsign.toUpperCase().trim(), band, mode, id]
  );
  const is_dupe = dupeRows.length > 0;

  const { rows } = await pool.query(
    `UPDATE qsos
     SET callsign=$1, band=$2, mode=$3, rcvd_class=$4, rcvd_section=$5, is_dupe=$6
     WHERE id=$7 RETURNING *`,
    [
      callsign.toUpperCase().trim(), band, mode,
      rcvd_class?.toUpperCase().trim() ?? null,
      rcvd_section?.toUpperCase().trim() ?? null,
      is_dupe, id,
    ]
  );

  return NextResponse.json(rows[0]);
}
