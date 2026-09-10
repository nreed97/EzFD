/**
 * Turning "these two clocks disagree" into "which one is wrong".
 *
 * `ClockSkewBanner` could only ever say the server and *this* device differ,
 * and deliberately did not claim which was right — because from one device it
 * genuinely cannot know. That is honest but not very useful: the operator is
 * left to work out whether to fix the server or their own laptop, at the
 * moment they are least able to.
 *
 * With several operators connected there is a much better signal available.
 * Twelve phones and laptops, most of them synchronised by a carrier or a home
 * network within the last day, are collectively a far better authority than a
 * field server asking itself. If nine of them independently report the server
 * running four minutes behind, the server is running four minutes behind.
 *
 * The aggregation is pure and lives here so it can be tested without a server,
 * a database or a browser. The route only keeps the observations.
 */

/** One device's opinion, as it computed it — round trip already halved. */
export interface SkewObservation {
  /** Server clock minus device clock, in ms. Positive: server ahead. */
  skewMs: number;
  /** When the server recorded it, for ageing observations out. */
  atMs: number;
  /** Distinguishes devices. Two windows on one machine are one opinion. */
  deviceId: string;
}

export interface ClockQuorum {
  /** Distinct devices with a recent opinion. */
  devices: number;
  /** How many of them agree the server is off, in the same direction. */
  agreeing: number;
  /** The agreeing devices' median skew, or null when there is no verdict. */
  medianSkewMs: number | null;
  /** True only when enough devices agree to call it. */
  serverIsWrong: boolean;
}

/** Below this a difference is latency and jitter, not a broken clock. */
export const QUORUM_THRESHOLD_MS = 60_000;

/**
 * Observations older than this are dropped. A clock reading from an hour ago
 * says nothing about now — the admin console may have fixed it since, and a
 * banner still citing the old reading would send an operator to re-fix
 * something that is already right.
 */
export const OBSERVATION_TTL_MS = 15 * 60_000;

/**
 * Fewer devices than this and there is no verdict, only a disagreement.
 *
 * Three is the smallest number where "they agree with each other and not with
 * the server" means anything: with two, a single wrong laptop is half the
 * sample. This is why the banner keeps its old both-ways wording as the
 * fallback rather than escalating on thin evidence — a confident wrong verdict
 * would be worse than the honest hedge it replaces.
 */
export const QUORUM_MIN_DEVICES = 3;

/** The share of devices that must agree before the server is named. */
export const QUORUM_MAJORITY = 2 / 3;

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/**
 * Reduce the recorded observations to a verdict.
 *
 * Only the most recent observation from each device counts. Without that a
 * single browser left open overnight, checking every five minutes, would
 * outvote every other operator in the field.
 */
export function computeQuorum(
  observations: SkewObservation[],
  now: number,
  opts: { thresholdMs?: number; ttlMs?: number; minDevices?: number } = {},
): ClockQuorum {
  const {
    thresholdMs = QUORUM_THRESHOLD_MS,
    ttlMs = OBSERVATION_TTL_MS,
    minDevices = QUORUM_MIN_DEVICES,
  } = opts;

  const latest = new Map<string, SkewObservation>();
  for (const o of observations) {
    if (now - o.atMs > ttlMs) continue;
    const prev = latest.get(o.deviceId);
    if (!prev || o.atMs > prev.atMs) latest.set(o.deviceId, o);
  }

  const devices = [...latest.values()];
  if (devices.length === 0) {
    return { devices: 0, agreeing: 0, medianSkewMs: null, serverIsWrong: false };
  }

  // Agreement is per direction. Devices split either side of the server cancel
  // out rather than summing into a majority, because that is not a server
  // problem — it is two operators' own clocks being wrong in opposite ways.
  const ahead = devices.filter(d => d.skewMs > thresholdMs);
  const behind = devices.filter(d => d.skewMs < -thresholdMs);
  const winner = ahead.length >= behind.length ? ahead : behind;

  const enough = devices.length >= minDevices
    && winner.length >= Math.ceil(devices.length * QUORUM_MAJORITY)
    && winner.length > 0;

  return {
    devices: devices.length,
    agreeing: winner.length,
    medianSkewMs: winner.length > 0 ? median(winner.map(d => d.skewMs)) : null,
    serverIsWrong: enough,
  };
}

/**
 * Drop what is too old to matter, so the store cannot grow without bound on a
 * server left running all weekend.
 */
export function pruneObservations(
  observations: SkewObservation[],
  now: number,
  ttlMs = OBSERVATION_TTL_MS,
): SkewObservation[] {
  return observations.filter(o => now - o.atMs <= ttlMs);
}
