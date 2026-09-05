import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { MERGE_WINDOW_SECONDS } from '@/lib/events';

/**
 * Bring a full-event JSON export into this instance.
 *
 * Two modes, and which one runs is the whole design:
 *
 * **Restore** (the default) creates a NEW event with a fresh join code. It
 * never overwrites or merges, so importing is safe to try and safe to try
 * twice. That is the same guarantee the admin console's restore has always
 * made, because it calls the same function.
 *
 * **Merge** (`?merge_into=CODE`) reconciles an export into an event that
 * already exists here. This is the field-server case: the same weekend ran on
 * a Pi at the site *and* on the hosted instance, both hold real contacts, and
 * they have to become one log. It is one-shot post-event reconciliation, not
 * replication — see `ezfd_merge_event` in `db/schema.sql` for what it refuses
 * to decide on its own, which is most of the interesting part.
 *
 * Both are gated by EZFD_ADMIN_KEY when it is set. Restore creates events, so
 * it follows the rule creating events does; merge rewrites an existing log,
 * which is if anything the more consequential of the two.
 */
export async function POST(request: Request) {
  let body: { payload?: unknown; admin_key?: string; allow_different_origin?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 });
  }

  const requiredKey = process.env.EZFD_ADMIN_KEY;
  if (requiredKey) {
    if (!body.admin_key || body.admin_key !== requiredKey) {
      return NextResponse.json({ error: 'Admin key required to import an event' }, { status: 403 });
    }
  }

  const payload = body.payload;
  if (payload === undefined || payload === null) {
    return NextResponse.json({ error: 'Missing payload' }, { status: 400 });
  }
  if (typeof payload !== 'object') {
    return NextResponse.json(
      { error: 'Payload must be an event object or an array of them' },
      { status: 400 },
    );
  }

  const mergeInto = new URL(request.url).searchParams.get('merge_into')?.trim().toUpperCase();
  const pool = getPool();

  try {
    if (mergeInto) {
      const { rows: evRows } = await pool.query(
        'SELECT id FROM events WHERE join_code = $1',
        [mergeInto],
      );
      if (!evRows[0]) {
        return NextResponse.json({ error: `No event here with join code ${mergeInto}` }, { status: 404 });
      }
      const { rows } = await pool.query(
        'SELECT ezfd_merge_event($1, $2::jsonb, $3, $4) AS report',
        [evRows[0].id, JSON.stringify(payload), MERGE_WINDOW_SECONDS,
         body.allow_different_origin === true],
      );
      // 200, not 201: a merge changes an event that already existed rather
      // than creating one. The report is the point — a merge that only said
      // "ok" would hide the contacts it declined to touch.
      return NextResponse.json({ merged: rows[0].report }, { status: 200 });
    }

    const { rows } = await pool.query(
      'SELECT orig_code, new_code, qso_count FROM ezfd_restore_events($1::jsonb)',
      [JSON.stringify(payload)],
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: 'The export contained no events' }, { status: 400 });
    }
    return NextResponse.json({ imported: rows }, { status: 201 });
  } catch (err) {
    // A malformed export, an export of a different activation, or a
    // whole-database dump aimed at a single event are all the caller's
    // problem rather than a server fault — the functions raise on each.
    const message = err instanceof Error ? err.message : 'Import failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
