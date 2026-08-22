import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * The server's idea of the current time, so a client can tell when the two
 * disagree.
 *
 * QSOs are timestamped by the database (`NOW()` in the insert), not by the
 * browser — one authoritative clock, no trusting operator laptops. That is the
 * right call for a hosted instance and the wrong failure mode on a field
 * server: a Raspberry Pi has no battery-backed RTC, so with no NTP it comes up
 * holding the time of its last shutdown, or an epoch date. Every QSO then gets
 * a plausible-looking but wrong `datetime_utc`, which corrupts the log's
 * chronology, the Cabrillo output, and the ±2-minute window ADIF import uses
 * to skip already-imported contacts.
 *
 * Nothing surfaced that. This endpoint doesn't change who is authoritative —
 * it just lets the client notice, and say so.
 *
 * Both clocks are reported because they can differ: the app process and
 * PostgreSQL are usually on one host but need not be, and it's the database's
 * clock that actually stamps the QSOs.
 */
export async function GET() {
  const appTime = new Date();

  let dbTime: string | null = null;
  try {
    const { rows } = await getPool().query('SELECT NOW() AS now');
    dbTime = new Date(rows[0].now).toISOString();
  } catch {
    // A clock check is not worth failing on. The client falls back to
    // comparing against the app clock alone.
  }

  return NextResponse.json(
    { app_time: appTime.toISOString(), db_time: dbTime },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
