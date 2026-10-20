import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { badRequest, callsign as asCallsign, isBand, isMode, isUuid, jsonBody, text } from '@/lib/validate';

/** Settle the dupe flags for one (call, band, mode) group, under the event's
 *  own rule. Deleting the first of two contacts must promote the second, and
 *  an edit that moves a contact out of a group must release whichever one it
 *  had been duplicating; a flag set per row could only ever be set. */
async function settleDupes(
  db: { query: (sql: string, params: unknown[]) => Promise<unknown> },
  q: { event_id: string; callsign: string; band: string; mode: string },
) {
  await db.query('SELECT ezfd_recompute_dupes($1, $2, $3, $4)', [q.event_id, q.callsign, q.band, q.mode]);
}

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
  if (!isUuid(id)) return badRequest('Not a valid contact id');
  const by = actor(new URL(req.url).searchParams.get('operator_call'));

  const pool = getPool();
  const { rows } = await pool.query(
    `UPDATE qsos SET deleted_at = NOW(), deleted_by = $2
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING event_id, callsign, band, mode`,
    [id, by],
  );
  if (rows[0]) await settleDupes(pool, rows[0]);
  // Already deleted is success, not an error: two operators pressing delete on
  // the same contact should both see it gone.
  return NextResponse.json({ ok: true, deleted: rows.length > 0 });
}

/** Undo a soft delete. The recovery path that a hard delete never had. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return badRequest('Not a valid contact id');
  const body = (await jsonBody(req)) ?? {};
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
  // A restored contact may be the earlier of two again, or a dupe of one
  // logged while it was gone.
  await settleDupes(pool, rows[0]);
  const { rows: [now] } = await pool.query('SELECT * FROM qsos WHERE id = $1', [id]);
  return NextResponse.json(now);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return badRequest('Not a valid contact id');
  const body = await jsonBody(req);
  if (!body) return badRequest('Body must be a JSON object');
  const { band, mode, rcvd_class, rcvd_section, operator_call } = body;

  if (!body.callsign || !band || !mode) return badRequest('Missing required fields');
  const call = asCallsign(body.callsign);
  if (!call) return badRequest(`${String(body.callsign).slice(0, 20)} is not a callsign`);
  if (!isBand(band)) return badRequest(`Unknown band ${String(band).slice(0, 10)}`);
  if (!isMode(mode)) return badRequest('Mode must be PH, CW or DIG');

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: cur } = await client.query(
      'SELECT event_id, callsign, band, mode FROM qsos WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',
      [id]);
    if (!cur[0]) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    await client.query(
      `UPDATE qsos
       SET callsign=$1, band=$2, mode=$3, rcvd_class=$4, rcvd_section=$5,
           updated_at=NOW(), updated_by=$7
       WHERE id=$6`,
      [
        call, band, mode,
        text(rcvd_class, { upper: true, max: 4 }),
        text(rcvd_section, { upper: true, max: 5 }),
        id, actor(operator_call),
      ]
    );

    // Both groups: the one the contact left (whatever it was duplicating, or
    // was duplicated by, is settled without it) and the one it joined.
    await settleDupes(client, cur[0]);
    await settleDupes(client, { event_id: cur[0].event_id, callsign: call, band, mode });
    const { rows } = await client.query('SELECT * FROM qsos WHERE id = $1', [id]);
    await client.query('COMMIT');
    return NextResponse.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
