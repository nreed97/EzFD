import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

/** Who claimed to be acting, from the query string or body. Self-asserted —
 *  operator identity here is a callsign typed at join time, not a verified
 *  login — so this records who *said* they did it, which is still the useful
 *  thing when two operators disagree about a contact after the event. */
function actor(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.toUpperCase().trim() : null;
}

/**
 * Soft delete. The row stays, marked, so the log can answer "what happened to
 * that QSO?" — previously a delete removed it outright and a contact missing
 * from the log was indistinguishable from one never logged.
 *
 * Every read path filters `deleted_at IS NULL`, so this disappears from the
 * logger, the dashboard, scoring, dupe checking and the ADIF/Cabrillo exports
 * exactly as a hard delete did. The full-event backup keeps it.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const by = actor(new URL(req.url).searchParams.get('operator_call'));

  const { rows } = await getPool().query(
    `UPDATE qsos SET deleted_at = NOW(), deleted_by = $2
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING id`,
    [id, by],
  );
  // Already deleted is success, not an error: two operators pressing delete on
  // the same contact should both see it gone.
  return NextResponse.json({ ok: true, deleted: rows.length > 0 });
}

/** Undo a soft delete. The recovery path that a hard delete never had. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { operator_call?: string } = {};
  try { body = await req.json(); } catch { /* no body is fine */ }
  const by = actor(body.operator_call);

  const pool = getPool();
  const { rows } = await pool.query(
    `UPDATE qsos
     SET deleted_at = NULL, deleted_by = NULL, updated_at = NOW(), updated_by = $2
     WHERE id = $1 AND deleted_at IS NOT NULL
     RETURNING *`,
    [id, by],
  );
  if (!rows[0]) return NextResponse.json({ error: 'Not found, or not deleted' }, { status: 404 });
  return NextResponse.json(rows[0]);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { callsign, band, mode, rcvd_class, rcvd_section, operator_call } = await req.json();

  if (!callsign || !band || !mode) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const pool = getPool();
  const { rows: cur } = await pool.query(
    'SELECT event_id FROM qsos WHERE id=$1 AND deleted_at IS NULL', [id]);
  if (!cur[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Re-evaluate dupe status after edit. A deleted QSO must not make the edited
  // one a dupe — it isn't in the log any more.
  const { rows: dupeRows } = await pool.query(
    `SELECT id FROM qsos
     WHERE event_id=$1 AND callsign=$2 AND band=$3 AND mode=$4 AND is_dupe=false AND id!=$5
       AND deleted_at IS NULL
     LIMIT 1`,
    [cur[0].event_id, callsign.toUpperCase().trim(), band, mode, id]
  );
  const is_dupe = dupeRows.length > 0;

  const { rows } = await pool.query(
    `UPDATE qsos
     SET callsign=$1, band=$2, mode=$3, rcvd_class=$4, rcvd_section=$5, is_dupe=$6,
         updated_at=NOW(), updated_by=$8
     WHERE id=$7 RETURNING *`,
    [
      callsign.toUpperCase().trim(), band, mode,
      rcvd_class?.toUpperCase().trim() ?? null,
      rcvd_section?.toUpperCase().trim() ?? null,
      is_dupe, id, actor(operator_call),
    ]
  );

  return NextResponse.json(rows[0]);
}
