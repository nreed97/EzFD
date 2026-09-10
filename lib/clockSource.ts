/**
 * How long since this machine's clock was last set by something trustworthy.
 *
 * The question deliberately is *not* "is NTP synchronised right now". On an
 * offline field server the answer to that is no, permanently and by design —
 * so a warning built on it fires hardest at the operator who fitted an RTC or
 * a GPS receiver and did everything right. That is how warnings get ignored,
 * and `ezfd-admin.sh` already had to be fixed for exactly this.
 *
 * "Last disciplined" reads correctly on every setup instead. A GPS-fed machine
 * is being disciplined continuously. An RTC-only machine was disciplined
 * whenever somebody last set it, and a DS3231 drifts a couple of minutes a
 * year from there — so the age of that event *is* the bound on the error. A
 * machine with neither has never been disciplined at all, which is the case
 * worth shouting about.
 *
 * Everything here degrades to `null`, meaning "nothing could tell us". A null
 * must never be rendered as a warning: not knowing is not the same as knowing
 * it is wrong, and conflating the two is the false-alarm failure again.
 */

/** What the server can say about its own clock. */
export interface ClockSource {
  /** Last time something disciplined this clock, or null if unknown. */
  lastSyncMs: number | null;
  /** What is holding the clock: 'ntp', 'chrony', 'timesyncd', 'rtc', null. */
  source: string | null;
  /** True when a source is actively disciplining right now. */
  synchronized: boolean | null;
  /** A hardware clock exists, so the time survives a power cut. Null when
   *  nothing could be asked — which is not the same as knowing there is none. */
  rtc: boolean | null;
}

/**
 * Past this, say so. A DS3231 holds a couple of minutes a year, so a month is
 * comfortably inside what Field Day cares about while still catching the
 * machine that has not been set since last season — which is the real case.
 * Contest log checking wants the log right to about a minute.
 */
export const CLOCK_STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Parse `chronyc tracking`. The field that matters is "Ref time", the last
 * update actually taken from a source — not "System time", which is only the
 * current offset estimate and keeps moving whether or not anything is feeding
 * it.
 *
 * Returns null rather than guessing on anything unparseable. chrony prints
 * "Ref time (UTC) : Thu Jan 01 00:00:00 1970" when it has never synchronised,
 * and that epoch date must read as "never", not as "1970".
 */
export function parseChronyTracking(out: string): { lastSyncMs: number | null; refId: string | null } {
  const refMatch = /^Reference ID\s*:\s*(\S+)/m.exec(out);
  const refId = refMatch ? refMatch[1] : null;

  const timeMatch = /^Ref time \(UTC\)\s*:\s*(.+)$/m.exec(out);
  if (!timeMatch) return { lastSyncMs: null, refId };

  const ms = Date.parse(`${timeMatch[1].trim()} UTC`);
  if (!Number.isFinite(ms)) return { lastSyncMs: null, refId };
  // chrony reports the epoch when it has never had a source. That is "never",
  // and treating it as a real timestamp would report the clock as 56 years
  // stale rather than as never set.
  if (ms <= 0) return { lastSyncMs: null, refId };
  return { lastSyncMs: ms, refId };
}

/**
 * Parse `timedatectl show`, which prints `Key=value` lines. Only two matter:
 * whether a network source has it now, and whether an RTC exists.
 */
export function parseTimedatectl(out: string): { synchronized: boolean | null; hasRtc: boolean | null } {
  const get = (k: string): string | null => {
    const m = new RegExp(`^${k}=(.*)$`, 'm').exec(out);
    return m ? m[1].trim() : null;
  };
  const ntp = get('NTPSynchronized');
  const rtc = get('RTCTimeUSec');
  return {
    synchronized: ntp === null ? null : ntp === 'yes',
    // A machine with no RTC reports 0; one with an RTC reports a real time.
    hasRtc: rtc === null ? null : rtc !== '0' && rtc !== '',
  };
}

/**
 * Decide what to report from whatever the probes managed to gather.
 *
 * Kept pure and separate from the reading so the precedence is testable: a
 * chrony reference beats timesyncd's marker file, because a machine running
 * chrony with a GPS is the setup this is most trying to get right, and its
 * marker file may be stale or absent entirely.
 */
export function summariseClock(input: {
  chronyRefTimeMs?: number | null;
  chronyRefId?: string | null;
  timesyncdMs?: number | null;
  ntpSynchronized?: boolean | null;
  hasRtc?: boolean | null;
}): ClockSource {
  const {
    chronyRefTimeMs = null, chronyRefId = null, timesyncdMs = null,
    ntpSynchronized = null, hasRtc = null,
  } = input;

  let lastSyncMs: number | null = null;
  let source: string | null = null;

  if (chronyRefTimeMs !== null) {
    lastSyncMs = chronyRefTimeMs;
    // chrony marks a reference clock — a GPS or other local hardware — with a
    // leading '#' in its sources listing, and reports the refid here. Naming
    // it matters: "GPS" is a different answer from "some server on the LAN"
    // to an operator deciding whether to trust the log's timestamps.
    source = chronyRefId && /^(GPS|PPS|SHM|NMEA|GNSS)/i.test(chronyRefId) ? 'gps' : 'chrony';
  } else if (timesyncdMs !== null) {
    lastSyncMs = timesyncdMs;
    source = 'timesyncd';
  } else if (hasRtc) {
    // An RTC holds the time but records no "when was this set". The clock is
    // being kept by something, which is worth reporting, but the age is
    // genuinely unknown rather than zero.
    source = 'rtc';
  }

  return {
    lastSyncMs,
    source,
    synchronized: ntpSynchronized,
    rtc: hasRtc,
  };
}

/**
 * How stale, in ms, or null when nothing can say. `now` is a parameter so this
 * stays pure and testable — reading the clock to judge the clock would be a
 * neat way to make a bug invisible.
 */
export function clockAgeMs(c: ClockSource, now: number): number | null {
  if (c.lastSyncMs === null) return null;
  const age = now - c.lastSyncMs;
  // A last-sync in the future means the clock has since been stepped backwards,
  // which is itself a reason to look — but it is not an *age*, so report zero
  // rather than a negative that would format as nonsense.
  return age < 0 ? 0 : age;
}

/**
 * Whether to warn. Deliberately conservative: unknown is not stale.
 *
 * A machine actively synchronised right now is never stale whatever the
 * recorded reference time says, because some setups only refresh that field
 * occasionally.
 */
export function clockIsStale(c: ClockSource, now: number, threshold = CLOCK_STALE_AFTER_MS): boolean {
  if (c.synchronized === true) return false;
  const age = clockAgeMs(c, now);
  if (age === null) return false;
  return age > threshold;
}

/**
 * True when nothing at all accounts for this clock — no NTP, no chrony or
 * timesyncd reference, and no RTC. On a machine switched off since the last
 * event, the time it is showing came from nowhere.
 *
 * This requires *positive evidence of absence* on every count, which is the
 * whole difference between this and the check it replaced. A container or a
 * stripped system with no `timedatectl` answers nothing at all, and reporting
 * that as "nothing is holding the clock" would be the same false alarm in new
 * clothes — an alarming, specific claim built out of not having looked.
 */
export function clockIsUnaccountedFor(c: ClockSource): boolean {
  return c.synchronized === false && c.lastSyncMs === null && c.rtc === false;
}
