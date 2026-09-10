#!/usr/bin/env node
// Unit tests for lib/clockSource.ts and lib/clockQuorum.ts — what the server
// says about its own clock, and what the operators' devices say about it.
//
// Both exist because of the same failure, approached from two sides. QSOs are
// stamped by the server, so a wrong server clock silently corrupts every
// contact's time, and it cannot be repaired after the event. The old warning
// asked `timedatectl` whether NTP was synchronised — which on an offline field
// server is "no" permanently and by design, so it fired hardest at the
// operator who had fitted an RTC and done everything right.
//
// The two rules that follow from that, and that these tests exist to hold:
//
//   * not knowing is not the same as knowing it is wrong. Every unknown here
//     must produce a quiet null, never a warning.
//   * a verdict needs evidence. One device disagreeing with the server is a
//     disagreement; several agreeing with each other is a verdict.

const { compile } = require('./_compile-ts.cjs');
const ts = compile(['lib/clockSource.ts', 'lib/clockQuorum.ts']);
const {
  parseChronyTracking, parseTimedatectl, summariseClock,
  clockAgeMs, clockIsStale, clockIsUnaccountedFor, CLOCK_STALE_AFTER_MS,
} = ts.load('clockSource');
const {
  computeQuorum, pruneObservations, QUORUM_MIN_DEVICES, OBSERVATION_TTL_MS,
} = ts.load('clockQuorum');

let failures = 0;
const ok = m => console.log(`ok    ${m}`);
const no = (m, d) => { failures++; console.log(`FAIL  ${m}${d ? `  ${d}` : ''}`); };
const eq = (a, e, m) =>
  JSON.stringify(a) === JSON.stringify(e) ? ok(m) : no(m, `got ${JSON.stringify(a)}, expected ${JSON.stringify(e)}`);

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 5, 27, 18, 0, 0);

// ── chronyc tracking ─────────────────────────────────────────────────────────
console.log('\n── parsing chronyc tracking ──');

// Real output shape, from a machine disciplined by a GPS receiver over SHM.
const CHRONY_GPS = `Reference ID    : 47505300 (GPS)
Stratum         : 1
Ref time (UTC)  : Sat Jun 27 17:59:42 2026
System time     : 0.000000031 seconds fast of NTP time
Last offset     : +0.000000012 seconds
RMS offset      : 0.000000107 seconds
Frequency       : 12.345 ppm slow
Skew            : 0.004 ppm
Root delay      : 0.000000001 seconds
Root dispersion : 0.000010739 seconds
Update interval : 16.0 seconds
Leap status     : Normal`;

const gps = parseChronyTracking(CHRONY_GPS);
eq(gps.refId, '47505300', 'the reference id is read');
eq(gps.lastSyncMs, Date.UTC(2026, 5, 27, 17, 59, 42), 'Ref time parses as UTC');

// A chronyd that has never reached a source prints the epoch. Reading that as
// a real timestamp would report the clock as decades stale instead of never
// set — a wrong answer that looks specific, which is worse than "unknown".
const CHRONY_NEVER = `Reference ID    : 00000000 ()
Stratum         : 0
Ref time (UTC)  : Thu Jan 01 00:00:00 1970
System time     : 0.000000000 seconds fast of NTP time
Leap status     : Not synchronised`;
eq(parseChronyTracking(CHRONY_NEVER).lastSyncMs, null,
   'the epoch reference time reads as never, not as 1970');

eq(parseChronyTracking('').lastSyncMs, null, 'empty output yields null, not a guess');
eq(parseChronyTracking('command not found').lastSyncMs, null, 'junk output yields null');

// ── timedatectl ──────────────────────────────────────────────────────────────
console.log('\n── parsing timedatectl show ──');

const TD_SYNCED = `Timezone=UTC
LocalRTC=no
CanNTP=yes
NTP=yes
NTPSynchronized=yes
TimeUSec=Sat 2026-06-27 18:00:00 UTC
RTCTimeUSec=Sat 2026-06-27 18:00:00 UTC`;
eq(parseTimedatectl(TD_SYNCED), { synchronized: true, hasRtc: true },
   'a synchronised machine with an RTC');

// The offline field server: no NTP by definition, but an RTC holding the time.
const TD_RTC_ONLY = `NTPSynchronized=no
RTCTimeUSec=Sat 2026-06-27 18:00:00 UTC`;
eq(parseTimedatectl(TD_RTC_ONLY), { synchronized: false, hasRtc: true },
   'an offline machine with an RTC is not synchronised but has a clock');

// A Pi 4 with nothing fitted reports 0 for the RTC.
eq(parseTimedatectl('NTPSynchronized=no\nRTCTimeUSec=0'),
   { synchronized: false, hasRtc: false }, 'RTCTimeUSec=0 means no hardware clock');

eq(parseTimedatectl(''), { synchronized: null, hasRtc: null },
   'no timedatectl output yields nulls, never false');

// ── the summary, and its precedence ──────────────────────────────────────────
console.log('\n── what is holding the clock ──');

eq(summariseClock({ chronyRefTimeMs: NOW - 60_000, chronyRefId: 'GPS' }).source, 'gps',
   'a GPS reference is named as GPS');
eq(summariseClock({ chronyRefTimeMs: NOW - 60_000, chronyRefId: '192.168.1.1' }).source, 'chrony',
   'an ordinary network peer is chrony, not GPS');
eq(summariseClock({ timesyncdMs: NOW - 60_000 }).source, 'timesyncd',
   'timesyncd is used when chrony says nothing');
eq(summariseClock({ chronyRefTimeMs: NOW - 1000, chronyRefId: 'GPS', timesyncdMs: NOW - 99999 }).lastSyncMs,
   NOW - 1000, 'chrony outranks timesyncd');
eq(summariseClock({ hasRtc: true }).source, 'rtc',
   'an RTC alone is still something holding the clock');
eq(summariseClock({ hasRtc: true }).lastSyncMs, null,
   'an RTC records no when — the age is unknown, not zero');
eq(summariseClock({}).source, null, 'nothing detected yields a null source');

// ── staleness, and the refusal to guess ──────────────────────────────────────
console.log('\n── deciding whether to warn ──');

const rtcSetLongAgo = summariseClock({ timesyncdMs: NOW - 200 * DAY, hasRtc: true, ntpSynchronized: false });
eq(clockIsStale(rtcSetLongAgo, NOW), true, 'a clock last set 200 days ago is stale');

const rtcSetRecently = summariseClock({ timesyncdMs: NOW - 2 * DAY, hasRtc: true, ntpSynchronized: false });
eq(clockIsStale(rtcSetRecently, NOW), false, 'a clock set two days ago is not stale');

// The whole point. An offline field server with a GPS answers "no" to
// NTPSynchronized, and must not be warned about.
const gpsOffline = summariseClock({ chronyRefTimeMs: NOW - 30_000, chronyRefId: 'GPS', ntpSynchronized: false });
eq(clockIsStale(gpsOffline, NOW), false,
   'a GPS-disciplined offline server is not stale despite NTPSynchronized=no');
eq(clockIsUnaccountedFor(gpsOffline), false, 'and its clock is accounted for');

// Unknown must stay quiet. This is the false-alarm rule.
const nothingKnown = summariseClock({});
eq(clockIsStale(nothingKnown, NOW), false, 'an unknown clock is not reported as stale');
eq(clockAgeMs(nothingKnown, NOW), null, 'an unknown clock has a null age, not zero');

// But a machine where nothing accounts for the time is exactly the case to
// surface: the time it shows came from nowhere.
const bareMachine = summariseClock({ ntpSynchronized: false, hasRtc: false });
eq(clockIsUnaccountedFor(bareMachine), true, 'a bare machine with no RTC and no NTP is unaccounted for');
eq(clockIsUnaccountedFor(summariseClock({ ntpSynchronized: true })), false,
   'a synchronised machine is accounted for');

// "Nothing answered" is not "nothing is there", and this is the distinction the
// whole design turns on. A container or a stripped system has no timedatectl,
// so every probe comes back null -- and reporting that as "nothing is holding
// this clock" would be the original false alarm wearing a new hat. It was
// caught by running the real endpoint, which reported unaccounted_for on a
// machine that had simply not been asked.
eq(clockIsUnaccountedFor(summariseClock({})), false,
   'a machine where nothing could be probed is not reported as unaccounted for');
eq(clockIsUnaccountedFor(summariseClock({ ntpSynchronized: false })), false,
   'no NTP alone is not enough — the RTC question must have been answered too');
eq(clockIsUnaccountedFor(summariseClock({ hasRtc: false })), false,
   'no RTC alone is not enough — the NTP question must have been answered too');

// Actively synchronised beats a stale recorded reference: some setups only
// refresh that field occasionally, and warning through a live sync would be
// the false alarm again.
const syncedButOldRef = summariseClock({ timesyncdMs: NOW - 400 * DAY, ntpSynchronized: true });
eq(clockIsStale(syncedButOldRef, NOW), false, 'an actively synchronised clock is never stale');

// A reference time in the future means the clock was stepped backwards since.
const stepped = summariseClock({ timesyncdMs: NOW + 5 * DAY, ntpSynchronized: false });
eq(clockAgeMs(stepped, NOW), 0, 'a future reference time reports zero age, not a negative');

eq(CLOCK_STALE_AFTER_MS, 30 * DAY, 'the staleness threshold is 30 days');

// ── the quorum ───────────────────────────────────────────────────────────────
console.log('\n── the devices\' verdict ──');

const obs = (deviceId, skewMs, ageMs = 0) => ({ deviceId, skewMs, atMs: NOW - ageMs });

eq(computeQuorum([], NOW), { devices: 0, agreeing: 0, medianSkewMs: null, serverIsWrong: false },
   'no observations is no verdict');

// One operator disagreeing is a disagreement, not a verdict. This is the case
// the banner already handled and must keep handling the old way.
const one = computeQuorum([obs('a', -240_000)], NOW);
eq(one.serverIsWrong, false, 'a single device does not convict the server');
eq(one.devices, 1, 'but it is counted');

// Two is still not enough: one wrong laptop is half the sample.
eq(computeQuorum([obs('a', -240_000), obs('b', -238_000)], NOW).serverIsWrong, false,
   'two agreeing devices are still not a quorum');

// Three agreeing is.
const three = computeQuorum([obs('a', -240_000), obs('b', -238_000), obs('c', -242_000)], NOW);
eq(three.serverIsWrong, true, 'three agreeing devices convict the server');
eq(three.agreeing, 3, 'all three are counted as agreeing');
eq(three.medianSkewMs, -240_000, 'the median of the agreeing devices is reported');

// A device whose own clock is wrong must not break the verdict.
const withOutlier = computeQuorum(
  [obs('a', -240_000), obs('b', -238_000), obs('c', -242_000), obs('d', 3_600_000)], NOW);
eq(withOutlier.serverIsWrong, true, 'one operator with a wrong laptop does not overturn three');
eq(withOutlier.agreeing, 3, 'and is not counted among the agreeing');

// Devices split either side of the server are not a server problem.
const split = computeQuorum(
  [obs('a', -240_000), obs('b', 240_000), obs('c', -238_000), obs('d', 242_000)], NOW);
eq(split.serverIsWrong, false, 'devices disagreeing in both directions do not convict the server');

// Everyone agreeing the clock is *fine* is the normal case and no verdict.
const allFine = computeQuorum([obs('a', 120), obs('b', -300), obs('c', 80), obs('d', 40)], NOW);
eq(allFine.serverIsWrong, false, 'small differences are latency, not a broken clock');
eq(allFine.agreeing, 0, 'and nobody is counted as agreeing');

// One browser left open overnight polls every five minutes. Without
// last-observation-per-device it would outvote the whole field.
const chatty = computeQuorum([
  obs('a', -240_000, 60_000), obs('a', -240_000, 120_000), obs('a', -240_000, 180_000),
  obs('a', -240_000, 240_000), obs('a', -240_000, 300_000),
], NOW);
eq(chatty.devices, 1, 'repeat observations from one device count once');
eq(chatty.serverIsWrong, false, 'and cannot form a quorum alone');

// A device that has since been fixed must not keep voting.
const stale = computeQuorum([
  obs('a', -240_000, OBSERVATION_TTL_MS + 1000),
  obs('b', -240_000, OBSERVATION_TTL_MS + 1000),
  obs('c', -240_000, OBSERVATION_TTL_MS + 1000),
], NOW);
eq(stale.devices, 0, 'observations past the TTL are ignored');

eq(pruneObservations([obs('a', 1, OBSERVATION_TTL_MS + 1), obs('b', 1, 1000)], NOW).length, 1,
   'pruning drops only what is past the TTL');
eq(QUORUM_MIN_DEVICES, 3, 'the minimum quorum is three devices');

console.log(failures === 0 ? '\nAll clock tests passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
