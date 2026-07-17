import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { isKnownMasterCallsign } from '@/lib/masterCallsigns';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const callsign = url.searchParams.get('callsign');
  const eventId = url.searchParams.get('event_id');

  if (!callsign || !eventId) {
    return NextResponse.json({ error: 'callsign and event_id required' }, { status: 400 });
  }

  const upper = callsign.toUpperCase();
  const pool = getPool();

  const { rows } = await pool.query(
    `SELECT e.use_call_history, e.use_master_callsign_file, c.sent_class, c.section, c.name, c.user_text
     FROM events e
     LEFT JOIN call_history_entries c ON c.event_id = e.id AND c.callsign = $2
     WHERE e.id = $1`,
    [eventId, upper]
  );
  const row = rows[0];
  if (!row) {
    return NextResponse.json({ callsign: upper, sent_class: null, section: null, name: null, user_text: null, known_master: false });
  }

  let known_master = false;
  if (row.use_master_callsign_file) {
    try {
      known_master = await isKnownMasterCallsign(upper);
    } catch (err) {
      console.error('Master callsign lookup error:', err);
    }
  }

  return NextResponse.json({
    callsign: upper,
    sent_class: row.use_call_history ? row.sent_class ?? null : null,
    section: row.use_call_history ? row.section ?? null : null,
    name: row.use_call_history ? row.name ?? null : null,
    user_text: row.use_call_history ? row.user_text ?? null : null,
    known_master,
  });
}
