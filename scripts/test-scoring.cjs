#!/usr/bin/env node
// Unit tests for lib/scoring.ts — the ARRL Field Day scoring formula.
//
// This is the highest-consequence pure logic in the project: it decides the
// number a club submits to the ARRL. Until now it was only covered indirectly,
// through the Cabrillo CLAIMED-SCORE header in the end-to-end suite, which
// needs a database and a running server and still only exercises a couple of
// paths. Every bonus, every multiplier and every exclusion rule is asserted
// here instead, in a few milliseconds and with no services running.
//
// Several of these guard bugs this project has actually shipped:
//   * sections multiplying the score instead of the power multiplier
//   * a Worked All Sections bonus that the Field Day rules do not contain
//   * emergency power doubling the whole score instead of paying per transmitter
//
// The Field Day expectations below are transcribed from the official ARRL
// rules (Revised 4/2026); each carries its rule number so a reader can check
// the assertion against the source rather than against lib/scoring.ts.
//
// lib/scoring.ts is TypeScript; scripts/_compile-ts.cjs compiles it and hands
// back a require-able module. That keeps the suite dependency free — same as
// every other script here, plain `node`, no test runner.

const { compile } = require('./_compile-ts.cjs');
const ts = compile(['lib/scoring.ts', 'lib/bonuses.ts']);
const { calculateScore, calculateBonusPoints, powerMultiplier } = ts.load('scoring');
const { ARRL_SECTIONS } = ts.load('types');
const { FD_BONUSES, WFD_OBJECTIVES, WFD_MAX_MULTIPLIER, objectiveMultiplier, transmittersFromClass } = ts.load('bonuses');

let failures = 0;
const ok = m => console.log(`ok    ${m}`);
const no = (m, d) => { failures++; console.log(`FAIL  ${m}${d ? `  ${d}` : ''}`); };
const eq = (actual, expected, m) =>
  actual === expected ? ok(m) : no(m, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);

/** A QSO with only the fields scoring reads. */
const qso = (over = {}) => ({
  callsign: 'K1TEST', band: '20m', mode: 'PH',
  rcvd_section: 'EPA', is_dupe: false, ...over,
});

// ── Power multiplier ────────────────────────────────────────────────────
console.log('\n── power multiplier ──');
eq(powerMultiplier('HIGH'), 1, 'HIGH is x1');
eq(powerMultiplier('LOW'),  2, 'LOW is x2');
eq(powerMultiplier('QRP'),  5, 'QRP is x5');
eq(powerMultiplier('nonsense'), 1, 'an unknown power falls back to x1');

// ── QSO points by mode ──────────────────────────────────────────────────
console.log('\n── QSO points by mode ──');
eq(calculateScore([qso({ mode: 'PH' })]).qso_points,  1, 'phone is 1 point');
eq(calculateScore([qso({ mode: 'CW' })]).qso_points,  2, 'CW is 2 points');
eq(calculateScore([qso({ mode: 'DIG' })]).qso_points, 2, 'digital is 2 points');

{
  const s = calculateScore([qso({ mode: 'PH' }), qso({ mode: 'CW' }), qso({ mode: 'DIG' })]);
  eq(s.qso_points, 5, 'mixed modes add up');
  eq(s.phone_qsos, 1, 'phone QSOs are counted');
  eq(s.cw_qsos, 1, 'CW QSOs are counted');
  eq(s.digital_qsos, 1, 'digital QSOs are counted');
  eq(s.total_qsos, 3, 'total_qsos counts every row');
  eq(s.valid_qsos, 3, 'valid_qsos counts the non-dupes');
}

// ── Dupes ───────────────────────────────────────────────────────────────
console.log('\n── dupes ──');
{
  const s = calculateScore([qso(), qso({ is_dupe: true, rcvd_section: 'MDC' })]);
  eq(s.qso_points, 1, 'a dupe scores no points');
  eq(s.valid_qsos, 1, 'a dupe is excluded from valid_qsos');
  eq(s.total_qsos, 2, 'but is still counted in total_qsos');
  eq(s.sections_worked, 1, "a dupe's section does not count toward sections");
}

// ── The formula: QSO points x power, never x sections ───────────────────
console.log('\n── the formula ──');
{
  // 4 CW QSOs = 8 points, in 4 different sections, at QRP (x5).
  const secs = ['EPA', 'MDC', 'NNJ', 'WPA'];
  const s = calculateScore(secs.map(x => qso({ mode: 'CW', rcvd_section: x })), {}, 'QRP');
  eq(s.qso_points, 8, 'four CW QSOs are 8 points');
  eq(s.sections_worked, 4, 'four sections worked');
  eq(s.total_score, 40, 'score is QSO points x power multiplier (8 x 5)');
  // The bug this guards: 8 x 4 sections = 32, or 8 x 5 x 4 = 160.
  if (s.total_score !== 32 && s.total_score !== 160) {
    ok('sections do not multiply the score');
  } else {
    no('sections do not multiply the score', `total_score ${s.total_score} looks like a section multiply`);
  }
}

// ── Sections: recognised only, DX accepted but not counted ──────────────
console.log('\n── sections ──');
{
  const s = calculateScore([
    qso({ rcvd_section: 'EPA' }),
    qso({ rcvd_section: 'epa' }),        // case-insensitive, same section
    qso({ rcvd_section: 'DX' }),         // valid exchange, not a section
    qso({ rcvd_section: 'ZZQ' }),        // typo
    qso({ rcvd_section: '' }),           // nothing sent
  ]);
  eq(s.sections_worked, 1, 'sections are de-duplicated case-insensitively');
  eq(s.sections.join(','), 'EPA', 'only recognised sections land in score.sections');
  eq(s.unknown_sections.join(','), 'ZZQ', 'an unrecognised exchange is reported separately');
  if (!s.unknown_sections.includes('DX')) ok('DX is not flagged as an unknown section');
  else no('DX is not flagged as an unknown section');
  eq(s.qso_points, 5, 'every QSO still scores, whatever the exchange');
}

// ── Sections are tracked, but are not a bonus ───────────────────────────
// Field Day rule 7.3 runs 7.3.1 to 7.3.18 and none of them concerns sections.
// This app awarded 100 points for a clean sweep for several releases — points
// an entrant would have copied onto a summary sheet and not earned.
console.log('\n── sections are not a bonus ──');
{
  const all = ARRL_SECTIONS.map(x => qso({ rcvd_section: x }));
  const full = calculateScore(all);
  eq(full.sections_worked, ARRL_SECTIONS.length, `all ${ARRL_SECTIONS.length} sections worked`);
  eq(full.bonus_points, 0, 'a full sweep awards no bonus — there is no such rule');
  eq(full.claimed_score, full.total_score, 'and the claimed score is just the base');

  // The #34 bug: unrecognised exchanges must not inflate sections_worked.
  const withTypo = calculateScore([...all.slice(0, -1), qso({ rcvd_section: 'ZZQ' })]);
  eq(withTypo.sections_worked, ARRL_SECTIONS.length - 1, 'a typo is not a section');
  eq(withTypo.unknown_sections[0], 'ZZQ', 'and is surfaced as unrecognised');
  eq(withTypo.qso_points, ARRL_SECTIONS.length, 'though the QSO itself still scores');

  const withDx = calculateScore([...all.slice(0, -1), qso({ rcvd_section: 'DX' })]);
  eq(withDx.sections_worked, ARRL_SECTIONS.length - 1, 'nor is DX a section');
  eq(withDx.unknown_sections.length, 0, 'but DX is not a typo either');
}

// ── Field Day bonuses, rule 7.3 ─────────────────────────────────────────
const fd = (bonuses, ctx) => calculateBonusPoints(bonuses, 'FD', ctx);

console.log('\n── FD flat bonuses ──');
for (const [k, pts, rule] of [
  ['media_publicity',       100, '7.3.2'],
  ['public_location',       100, '7.3.3'],
  ['public_info_table',     100, '7.3.4'],
  ['message_to_sm',         100, '7.3.5'],
  ['satellite',             100, '7.3.7'],
  ['natural_power',         100, '7.3.8'],
  ['w1aw_bulletin',         100, '7.3.9'],
  ['educational',           100, '7.3.10'],
  ['elected_official',      100, '7.3.11'],
  ['served_agency',         100, '7.3.12'],
  ['gota_coach',            100, '7.3.13.2'],
  ['web_posting',            50, '7.3.14'],
  ['social_media',          100, '7.3.16'],
  ['safety_officer',        100, '7.3.17'],
  ['site_responsibilities',  50, '7.3.18'],
]) {
  eq(fd({ [k]: true }), pts, `${k} is ${pts} points (rule ${rule})`);
}

console.log('\n── FD emergency power is per transmitter, not a doubling (7.3.1) ──');
eq(fd({ emergency_power: true }, { transmitters: 1 }),  100, '1A claims 100');
eq(fd({ emergency_power: true }, { transmitters: 3 }),  300, '3A claims 300');
eq(fd({ emergency_power: true }, { transmitters: 20 }), 2000, '20A claims the 2,000 maximum');
eq(fd({ emergency_power: true }, { transmitters: 22 }), 2000, 'and 22A claims no more (7.3.1 caps at 20)');
// The shipped bug: a 5,000-point base used to add 5,000 here.
eq(fd({ emergency_power: true }, { transmitters: 3, baseScore: 5000 }), 300,
   'the base score does not enter into it');

console.log('\n── FD counted bonuses and their caps ──');
eq(fd({ nts_traffic: 5 }),   50,  'formal messages are 10 each (7.3.6)');
eq(fd({ nts_traffic: 50 }),  100, 'and cap at 100');
eq(fd({ gota_qsos: 50 }),    250, 'GOTA contacts are 5 points each (7.3.13.1)');
eq(fd({ gota_qsos: 5000 }),  25000, 'with no cap — 7.3.13.1 sets no limit');
eq(fd({ youth_ops: 3 }),     60,  'youth participants are 20 each (7.3.15)');
eq(fd({ youth_ops: 50 }),    100, 'and cap at 100');

console.log('\n── bonuses Field Day does not have ──');
eq(fd({ all_licensed: true }), 0, 'there is no all-licensed bonus in the FD rules');
eq(fd({}), 0, 'nothing claimed is zero, not the base score');
// A count stored before 7.3.12 was corrected from a tally to a single bonus.
eq(fd({ served_agency: 3 }), 100, 'a legacy served-agency count still claims the one bonus');

console.log('\n── the FD table matches the rules it cites ──');
{
  const rules = FD_BONUSES.map(d => d.rule);
  eq(new Set(rules).size, rules.length, 'no rule number is claimed twice');
  eq(rules.every(r => /^7\.3\.\d+(\.\d+)?$/.test(r)), true, 'every FD bonus cites a 7.3.x rule');
  eq(FD_BONUSES.some(d => d.key === 'all_licensed'), false, 'and all_licensed is not among them');
}

console.log('\n── transmitters come from the entry class (rule 4) ──');
eq(transmittersFromClass('3A'),  3, '"3A" is three transmitters');
eq(transmittersFromClass('20A'), 20, 'and "20A" is twenty');
eq(transmittersFromClass('1D'),  1, 'a class D home station is one');
// Rule 4: "the minimum number of transmitters that must be claimed is one".
eq(transmittersFromClass(null),  1, 'a null class floors at one, not zero');
eq(transmittersFromClass(''),    1, 'and so does an empty one');

// ── Winter Field Day, a different scoring model ─────────────────────────
// WFD has no bonus points and no power multiplier. Objectives each carry an
// Objective Multiplier; the completed ones are summed, one is added, and that
// multiplies the QSO points:  score = QSO points × (OM + 1).
console.log('\n── WFD scores by objective multiplier, not bonuses ──');
eq(calculateBonusPoints({ wfd_qrp: true, wfd_alt_power: true }, 'WFD'), 0,
   'WFD awards no bonus points at all');
eq(calculateBonusPoints({ emergency_power: true, safety_officer: true }, 'WFD'), 0,
   'and a Field Day bonus claimed on a WFD event is worth nothing');

console.log('\n── the OM sums, and always has 1 added ──');
eq(objectiveMultiplier({}), 1, 'no objectives completed is ×1, so QSOs still score');
eq(objectiveMultiplier({ wfd_alt_power: true }), 2, 'alternative power is OM 1 → ×2');
eq(objectiveMultiplier({ wfd_qrp: true }), 5, 'QRP is OM 4 → ×5');
eq(objectiveMultiplier({ wfd_six_bands: true }), 7, 'six bands is OM 6 → ×7');
eq(objectiveMultiplier({ wfd_six_bands: true, wfd_twelve_bands: true }), 13,
   'six and twelve bands both count — twelve does not replace six');
eq(objectiveMultiplier({ wfd_qrp: true, wfd_away_from_home: true, wfd_multi_mode: true }), 10,
   'OM values add: 4 + 3 + 2 = 9, +1');
{
  const all = Object.fromEntries(WFD_OBJECTIVES.map(o => [o.key, true]));
  eq(objectiveMultiplier(all), WFD_MAX_MULTIPLIER, 'every objective gives the maximum multiplier');
  eq(WFD_MAX_MULTIPLIER, 33, 'which is 32 OM + 1');
}

console.log('\n── the WFD formula end to end ──');
{
  // 3 CW QSOs = 6 QSO points. QRP (OM 4) + six bands (OM 6) = OM 10, ×11.
  const qsos = [qso({ mode: 'CW' }), qso({ mode: 'CW', callsign: 'K2B' }), qso({ mode: 'CW', callsign: 'K3C' })];
  const s = calculateScore(qsos, { wfd_qrp: true, wfd_six_bands: true }, 'HIGH',
                           { eventType: 'WFD', entryClass: '2O' });
  eq(s.qso_points, 6, 'QSO points are the same table as Field Day');
  eq(s.objective_multiplier, 11, 'the objective multiplier is OM + 1');
  eq(s.total_score, 66, 'score is QSO points × (OM + 1)');
  eq(s.bonus_points, 0, 'with no bonus points');
  eq(s.claimed_score, 66, 'so the claimed score is just the product');
}

console.log('\n── WFD has no power multiplier ──');
{
  // Every WFD station is capped at 100 W PEP; running QRP is an objective
  // worth OM 4, not a ×5 multiplier. Passing a power here must change nothing.
  const qsos = [qso({ mode: 'CW' })];
  const entry = { eventType: 'WFD', entryClass: '1H' };
  const hi  = calculateScore(qsos, {}, 'HIGH', entry);
  const qrp = calculateScore(qsos, {}, 'QRP', entry);
  eq(hi.power_multiplier, 1, 'power multiplier is 1 on WFD');
  eq(qrp.power_multiplier, 1, 'whatever power is recorded');
  eq(hi.total_score, qrp.total_score, 'so power cannot change a WFD score');
  eq(qrp.total_score, 2, 'and the score is just the QSO points');
}

console.log('\n── Field Day is unaffected by the objective multiplier ──');
{
  const s = calculateScore([qso({ mode: 'CW' })], { wfd_qrp: true }, 'QRP',
                           { eventType: 'FD', entryClass: '1A' });
  eq(s.objective_multiplier, 1, 'objective multiplier is 1 on Field Day');
  eq(s.total_score, 10, 'and the power multiplier still applies (2 pts × 5)');
}

console.log('\n── a special event has no bonuses at all ──');
eq(calculateBonusPoints({ emergency_power: true, w1aw_bulletin: true }, 'SES', { transmitters: 3 }), 0,
   'an SES scores nothing, however much is ticked');
eq(calculateScore([qso({ mode: 'CW' })], { wfd_qrp: true }, 'QRP', { eventType: 'SES' }).objective_multiplier, 1,
   'and an SES has no objective multiplier either');

// ── Claimed score ───────────────────────────────────────────────────────
console.log('\n── claimed score ──');
{
  // 2 CW QSOs = 4 points, LOW power x2 = 8 base.
  // A 3A entry on emergency power claims 3 x 100, plus W1AW's 100 = 400.
  const s = calculateScore(
    [qso({ mode: 'CW' }), qso({ mode: 'CW', rcvd_section: 'MDC' })],
    { emergency_power: true, w1aw_bulletin: true },
    'LOW',
    { eventType: 'FD', entryClass: '3A' },
  );
  eq(s.total_score, 8, 'base score is points x power');
  eq(s.bonus_points, 400, 'emergency power pays per transmitter, plus the flat bonus');
  eq(s.claimed_score, 408, 'claimed score is base plus bonuses');
  eq(s.claimed_score, s.total_score + s.bonus_points, 'claimed score reconciles with its parts');

  // Bonuses are added after the multiplier (rule 7.3): a QRP entry's bonuses
  // are worth exactly the same as a high-power entry's.
  const qrp = calculateScore(
    [qso({ mode: 'CW' }), qso({ mode: 'CW', rcvd_section: 'MDC' })],
    { emergency_power: true, w1aw_bulletin: true },
    'QRP',
    { eventType: 'FD', entryClass: '3A' },
  );
  eq(qrp.bonus_points, 400, 'the power multiplier does not touch bonus points');
  eq(qrp.total_score, 20, 'though it does multiply the QSO points');
}

// ── Per-band breakdown ──────────────────────────────────────────────────
console.log('\n── by band ──');
{
  const s = calculateScore([
    qso({ band: '20m', mode: 'PH' }),
    qso({ band: '20m', mode: 'CW' }),
    qso({ band: '40m', mode: 'DIG' }),
    qso({ band: '40m', mode: 'PH', is_dupe: true }),
  ]);
  eq(s.by_band['20m'].ph, 1, '20m phone counted');
  eq(s.by_band['20m'].cw, 1, '20m CW counted');
  eq(s.by_band['40m'].dig, 1, '40m digital counted');
  eq(s.by_band['40m'].ph, 0, 'a dupe is not counted in the band breakdown');
}

// ── Empty log ───────────────────────────────────────────────────────────
console.log('\n── empty log ──');
{
  const s = calculateScore([]);
  eq(s.qso_points, 0, 'no QSOs is zero points');
  eq(s.total_score, 0, 'and zero score');
  eq(s.claimed_score, 0, 'and zero claimed');
  eq(s.sections_worked, 0, 'and no sections');
  eq(s.unknown_sections.length, 0, 'and nothing unrecognised');
}

ts.cleanup();

console.log('');
if (failures) {
  console.log(`${failures} scoring check(s) failed`);
  process.exit(1);
}
console.log('All scoring tests passed.');
