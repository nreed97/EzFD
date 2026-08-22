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
// Two of these guard bugs this project has actually shipped:
//   * sections multiplying the score instead of the power multiplier
//   * the Worked All Sections bonus counting unrecognised exchanges
//
// lib/scoring.ts is TypeScript; scripts/_compile-ts.cjs compiles it and hands
// back a require-able module. That keeps the suite dependency free — same as
// every other script here, plain `node`, no test runner.

const { compile } = require('./_compile-ts.cjs');
const ts = compile(['lib/scoring.ts']);
const { calculateScore, calculateBonusPoints, powerMultiplier } = ts.load('scoring');
const { ARRL_SECTIONS } = ts.load('types');

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

// ── Worked All Sections ─────────────────────────────────────────────────
console.log('\n── Worked All Sections ──');
{
  const all = ARRL_SECTIONS.map(x => qso({ rcvd_section: x }));
  const full = calculateScore(all);
  eq(full.sections_worked, ARRL_SECTIONS.length, `all ${ARRL_SECTIONS.length} sections worked`);
  eq(full.bonus_points, 100, 'a full sweep awards the 100-point bonus');

  const oneShort = calculateScore(all.slice(0, -1));
  eq(oneShort.bonus_points, 0, 'one section short awards nothing');

  // The #34 bug: unrecognised exchanges must not reach the threshold.
  const withTypo = calculateScore([...all.slice(0, -1), qso({ rcvd_section: 'ZZQ' })]);
  eq(withTypo.bonus_points, 0, 'a typo cannot substitute for the last section');
  eq(withTypo.qso_points, ARRL_SECTIONS.length, 'though the QSO itself still scores');

  const withDx = calculateScore([...all.slice(0, -1), qso({ rcvd_section: 'DX' })]);
  eq(withDx.bonus_points, 0, 'nor can DX');
}

// ── Bonuses ─────────────────────────────────────────────────────────────
console.log('\n── bonuses ──');
eq(calculateBonusPoints({ emergency_power: true }, 500, 0), 500,
   'emergency power adds the base score again');

for (const k of ['w1aw_bulletin', 'satellite', 'natural_power', 'public_info_table',
                 'media_publicity', 'educational', 'message_to_sm', 'all_licensed']) {
  eq(calculateBonusPoints({ [k]: true }, 0, 0), 100, `${k} is 100 points`);
}
for (const k of ['elected_official', 'web_posting', 'social_media']) {
  eq(calculateBonusPoints({ [k]: true }, 0, 0), 50, `${k} is 50 points`);
}
eq(calculateBonusPoints({ safety_officer: true }, 0, 0), 25, 'safety_officer is 25 points');

console.log('\n── variable bonuses and their caps ──');
eq(calculateBonusPoints({ youth_ops: 3 }, 0, 0), 60, 'youth operators are 20 points each');
eq(calculateBonusPoints({ gota_qsos: 50 }, 0, 0), 500, 'GOTA QSOs are 10 points each');
eq(calculateBonusPoints({ gota_qsos: 500 }, 0, 0), 1000, 'GOTA is capped at 1000');
eq(calculateBonusPoints({ served_agency: 5 }, 0, 0), 50, 'served agency reps are 10 points each');
eq(calculateBonusPoints({ served_agency: 50 }, 0, 0), 100, 'served agency is capped at 100');
eq(calculateBonusPoints({ nts_traffic: 5 }, 0, 0), 50, 'NTS messages are 10 points each');
eq(calculateBonusPoints({ nts_traffic: 50 }, 0, 0), 100, 'NTS is capped at 100');
eq(calculateBonusPoints({}, 1000, 0), 0, 'no bonuses claimed is zero, not the base score');

// ── Claimed score ───────────────────────────────────────────────────────
console.log('\n── claimed score ──');
{
  // 2 CW QSOs = 4 points, LOW power x2 = 8 base.
  // Emergency power (+8) and W1AW (+100) = 108 bonus.
  const s = calculateScore(
    [qso({ mode: 'CW' }), qso({ mode: 'CW', rcvd_section: 'MDC' })],
    { emergency_power: true, w1aw_bulletin: true },
    'LOW',
  );
  eq(s.total_score, 8, 'base score is points x power');
  eq(s.bonus_points, 108, 'emergency power doubles the base, plus the flat bonus');
  eq(s.claimed_score, 116, 'claimed score is base plus bonuses');
  eq(s.claimed_score, s.total_score + s.bonus_points, 'claimed score reconciles with its parts');
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
