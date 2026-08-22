import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

/**
 * Recreate an event from a full-event JSON export.
 *
 * Always creates a NEW event with a fresh join code — never overwrites or
 * merges into an existing one — so importing is safe to try, and safe to try
 * twice. That is the same guarantee the admin console's restore has always
 * made, because this calls the same function.
 *
 * Gated by EZFD_ADMIN_KEY when it is set, matching event creation: this
 * creates events, so it follows the rule that creating events does.
 */
export async function POST(request: Request) {
  let body: { payload?: unknown; admin_key?: string };
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

  try {
    const { rows } = await getPool().query(
      'SELECT orig_code, new_code, qso_count FROM ezfd_restore_events($1::jsonb)',
      [JSON.stringify(payload)],
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: 'The export contained no events' }, { status: 400 });
    }
    return NextResponse.json({ imported: rows }, { status: 201 });
  } catch (err) {
    // A malformed export is the caller's problem, not a server fault — the
    // restore function raises on a payload that isn't an object or array.
    const message = err instanceof Error ? err.message : 'Import failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
