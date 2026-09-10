import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import {
  type ClockSource, parseChronyTracking, parseTimedatectl, summariseClock,
} from './clockSource';

const run = promisify(execFile);

/**
 * Server-side reading of what is holding this machine's clock.
 *
 * Kept apart from `lib/clockSource.ts` on purpose: everything that decides
 * anything lives there and is pure, so it can be unit tested without a Linux
 * box, a chronyd or a subprocess. This file only gathers, and every gather is
 * allowed to fail into a null.
 *
 * Nothing here is fatal. A field server may have no chrony, no timedatectl and
 * no timesyncd, and the correct outcome then is a quiet "unknown" rather than
 * an error — the endpoint's job is reporting the clock, not depending on it.
 */

/** systemd-timesyncd touches this when it synchronises. */
const TIMESYNCD_CLOCK = '/var/lib/systemd/timesync/clock';

/**
 * Probing shells out, so the answer is cached. Every connected browser hits
 * `/api/time` every five minutes; without this a twelve-operator event would
 * fork `chronyc` a few hundred times an hour to re-read a value that changes
 * on the order of days.
 */
const CACHE_MS = 60_000;
let cached: { at: number; value: ClockSource } | null = null;

/**
 * A probe that cannot hang. `chronyc` talks to a daemon over a socket and
 * `timedatectl` to systemd over D-Bus, and either can sit there indefinitely
 * if the other end is wedged — which would turn a clock report into a stalled
 * request on the page every operator has open.
 */
async function tryRun(cmd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await run(cmd, args, { timeout: 2000, encoding: 'utf8' });
    return stdout;
  } catch {
    return null;
  }
}

async function timesyncdMarker(): Promise<number | null> {
  try {
    // The file's mtime is when timesyncd last wrote it, which it does on
    // synchronising. Its contents are empty and carry nothing.
    const s = await stat(TIMESYNCD_CLOCK);
    const ms = s.mtimeMs;
    return Number.isFinite(ms) && ms > 0 ? ms : null;
  } catch {
    return null;
  }
}

/** Read the clock's provenance, cached. */
export async function probeClockSource(now = Date.now()): Promise<ClockSource> {
  if (cached && now - cached.at < CACHE_MS) return cached.value;

  const [chronyOut, tdOut, marker] = await Promise.all([
    tryRun('chronyc', ['-n', 'tracking']),
    tryRun('timedatectl', ['show', '--property=NTPSynchronized', '--property=RTCTimeUSec']),
    timesyncdMarker(),
  ]);

  const chrony = chronyOut ? parseChronyTracking(chronyOut) : { lastSyncMs: null, refId: null };
  const td = tdOut ? parseTimedatectl(tdOut) : { synchronized: null, hasRtc: null };

  const value = summariseClock({
    chronyRefTimeMs: chrony.lastSyncMs,
    chronyRefId: chrony.refId,
    timesyncdMs: marker,
    ntpSynchronized: td.synchronized,
    hasRtc: td.hasRtc,
  });

  cached = { at: now, value };
  return value;
}

/** Drop the cache. Used after the admin console sets the clock. */
export function resetClockProbeCache(): void {
  cached = null;
}
