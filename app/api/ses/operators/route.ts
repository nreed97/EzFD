import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

/**
 * The SES operator roster — each operator's own station location.
 *
 * This exists because a distributed SES has one location per operator, not
 * one per event. LoTW signs by station callsign *and* location, so these
 * values feed the ADIF MY_GRIDSQUARE / MY_STATE / MY_CNTY fields per QSO.
 * Taking them from events.location would stamp every operator's contacts
 * with the same (wrong) location and produce a log that doesn't upload.
 */
export async function GET(request: Request) {
  const eventId = new URL(request.url).searchParams.get('event_id');
  if (!eventId) return NextResponse.json({ error: 'event_id required' }, { status: 400 });

  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT event_id, op_call, op_name, grid, state, county, dxcc, approved, created_at
     FROM ses_operators WHERE event_id = $1 ORDER BY op_call ASC`,
    [eventId]
  );
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const { event_id, op_call, op_name, grid, state, county, dxcc } = await request.json();
  if (!event_id || !op_call) {
    return NextResponse.json({ error: 'event_id and op_call required' }, { status: 400 });
  }

  const pool = getPool();
  const { rows: evRows } = await pool.query(
    'SELECT id, require_operator_approval FROM events WHERE id = $1', [event_id]);
  if (!evRows[0]) return NextResponse.json({ error: 'Event not found' }, { status: 404 });

  // On a gated event a newly-seen operator starts unapproved and can't log
  // until a coordinator approves them. Existing rows keep whatever approval
  // state they already have — re-saving your grid must never silently
  // re-approve you, nor un-approve you.
  const approved = !evRows[0].require_operator_approval;

  // COALESCE on update so an operator saving just their grid doesn't blank
  // out the name/state they entered earlier.
  const { rows } = await pool.query(
    `INSERT INTO ses_operators (event_id, op_call, op_name, grid, state, county, dxcc, approved)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (event_id, op_call) DO UPDATE SET
       op_name = COALESCE(EXCLUDED.op_name, ses_operators.op_name),
       grid    = COALESCE(EXCLUDED.grid,    ses_operators.grid),
       state   = COALESCE(EXCLUDED.state,   ses_operators.state),
       county  = COALESCE(EXCLUDED.county,  ses_operators.county),
       dxcc    = COALESCE(EXCLUDED.dxcc,    ses_operators.dxcc)
     RETURNING event_id, op_call, op_name, grid, state, county, dxcc, approved, created_at`,
    [
      event_id,
      op_call.toUpperCase().trim(),
      op_name?.trim() || null,
      grid?.toUpperCase().trim() || null,
      state?.toUpperCase().trim() || null,
      county?.trim() || null,
      Number.isFinite(Number(dxcc)) && dxcc !== null && dxcc !== '' ? Number(dxcc) : null,
      approved,
    ]
  );
  return NextResponse.json(rows[0]);
}
