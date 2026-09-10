import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { probeClockSource } from '@/lib/clockProbe';
import { clockAgeMs, clockIsStale, clockIsUnaccountedFor } from '@/lib/clockSource';
import {
  type SkewObservation, computeQuorum, pruneObservations,
} from '@/lib/clockQuorum';

export const dynamic = 'force-dynamic';

/**
 * The server's idea of the current time, what is holding its clock, and what
 * the connected operators' devices make of it.
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

/**
 * Observations live in memory, deliberately.
 *
 * A clock reading is worthless within the quarter hour and meaningless after a
 * restart — the admin console may have fixed the clock in between, and a
 * verdict citing pre-fix readings would send an operator to re-fix something
 * already right. Persisting it would buy nothing and cost a migration, so this
 * is a plain array pruned on every write. EzFD runs as one `node server.js`
 * process, which is what makes that sound; if it ever runs as several, this
 * needs to move rather than be quietly wrong.
 */
let observations: SkewObservation[] = [];

/** Bounded regardless of TTL, so a misbehaving client cannot grow it. */
const MAX_OBSERVATIONS = 500;

async function clockReport(now: number) {
  const source = await probeClockSource(now);
  return {
    source: source.source,
    synchronized: source.synchronized,
    last_sync: source.lastSyncMs === null ? null : new Date(source.lastSyncMs).toISOString(),
    age_ms: clockAgeMs(source, now),
    stale: clockIsStale(source, now),
    unaccounted_for: clockIsUnaccountedFor(source),
    rtc: source.rtc,
  };
}

async function body(now: number) {
  const appTime = new Date(now);

  let dbTime: string | null = null;
  try {
    const { rows } = await getPool().query('SELECT NOW() AS now');
    dbTime = new Date(rows[0].now).toISOString();
  } catch {
    // A clock check is not worth failing on. The client falls back to
    // comparing against the app clock alone.
  }

  const quorum = computeQuorum(observations, now);

  return {
    app_time: appTime.toISOString(),
    db_time: dbTime,
    clock: await clockReport(now),
    quorum: {
      devices: quorum.devices,
      agreeing: quorum.agreeing,
      median_skew_ms: quorum.medianSkewMs,
      server_is_wrong: quorum.serverIsWrong,
    },
  };
}

export async function GET() {
  return NextResponse.json(await body(Date.now()), {
    headers: { 'Cache-Control': 'no-store' },
  });
}

/**
 * A device reporting what it measured, and reading back the aggregate.
 *
 * The client sends its *computed* skew rather than its raw clock, because only
 * the client can halve the round trip — the server has no way to separate
 * network latency from a clock difference in a timestamp it is handed.
 *
 * There is no authentication anywhere in EzFD; anyone with the join code can
 * already delete any contact. A client feeding this deliberate rubbish is
 * inside that same trust boundary, and the quorum's majority-of-distinct-
 * devices rule is what keeps one of them from deciding anything on its own.
 */
export async function POST(req: Request) {
  const now = Date.now();

  try {
    const input = await req.json();
    const skewMs = Number(input?.skew_ms);
    const deviceId = String(input?.device_id ?? '').slice(0, 64);

    // A skew beyond a day is a device with no clock at all rather than
    // evidence about the server, and letting it into the median would drag a
    // real verdict into nonsense.
    if (deviceId && Number.isFinite(skewMs) && Math.abs(skewMs) < 24 * 60 * 60 * 1000) {
      observations = pruneObservations(observations, now);
      observations.push({ skewMs, atMs: now, deviceId });
      if (observations.length > MAX_OBSERVATIONS) {
        observations = observations.slice(-MAX_OBSERVATIONS);
      }
    }
  } catch {
    // A malformed report is not worth an error response: the caller wants the
    // time, and the observation is the optional half of the exchange.
  }

  return NextResponse.json(await body(now), {
    headers: { 'Cache-Control': 'no-store' },
  });
}
