import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { EXCLUSION_VIOLATION, RESERVATION_COLUMNS } from '@/lib/ses';

/**
 * Extend or release an existing checkout.
 *
 * `extend` is what keeps an operator working a pileup from being bumped when
 * their slot runs out. It pushes only the upper bound, so the same exclusion
 * constraint still rejects the extension if somebody else already holds the
 * window being extended into — which is the desired behaviour, not a bug.
 *
 * `release` frees the slot immediately rather than at its nominal end time.
 * The row is kept (status RELEASED) so the log of who had the call when
 * survives, and the upper bound is clamped to now so that record is honest.
 * GREATEST guards a not-yet-started slot being cancelled, where clamping to
 * NOW() alone would produce an inverted range.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { action, op_call, minutes } = await request.json();

  if (action !== 'extend' && action !== 'release') {
    return NextResponse.json({ error: 'action must be "extend" or "release"' }, { status: 400 });
  }
  if (!op_call) {
    return NextResponse.json({ error: 'op_call required' }, { status: 400 });
  }

  const pool = getPool();
  const { rows: existing } = await pool.query(
    'SELECT id, op_call, band, mode FROM ses_reservations WHERE id = $1',
    [id]
  );
  if (!existing[0]) return NextResponse.json({ error: 'Reservation not found' }, { status: 404 });

  // Same trust level as the rest of the app (operator identity is self-asserted
  // at join time) — but an operator still shouldn't be able to release a slot
  // that isn't theirs by guessing its id.
  if (existing[0].op_call !== op_call.toUpperCase().trim()) {
    return NextResponse.json(
      { error: `That slot belongs to ${existing[0].op_call}` },
      { status: 403 }
    );
  }

  if (action === 'release') {
    const { rows } = await pool.query(
      `UPDATE ses_reservations
       SET status = 'RELEASED',
           during = tstzrange(lower(during), GREATEST(lower(during), NOW()), '[)')
       WHERE id = $1
       RETURNING ${RESERVATION_COLUMNS}`,
      [id]
    );
    return NextResponse.json(rows[0]);
  }

  const addMinutes = Number(minutes) > 0 ? Number(minutes) : 15;
  try {
    const { rows } = await pool.query(
      `UPDATE ses_reservations
       SET during = tstzrange(lower(during), NOW() + ($2 || ' minutes')::interval, '[)')
       WHERE id = $1
       RETURNING ${RESERVATION_COLUMNS}`,
      [id, String(addMinutes)]
    );
    return NextResponse.json(rows[0]);
  } catch (err) {
    if ((err as { code?: string }).code === EXCLUSION_VIOLATION) {
      return NextResponse.json(
        { error: 'Cannot extend — another operator already holds the next slot on this band/mode' },
        { status: 409 }
      );
    }
    throw err;
  }
}
