#!/usr/bin/env node
// Unit tests for GOTA scoring (#23) — lib/scoring.ts and lib/bonuses.ts.
//
// Two rules decide everything here, and this feature's original plan had one
// of them backwards:
//
//   4.1.1.5 — "QSOs made by this station may be claimed for credit by its
//   primary Field Day operation. In addition, bonus points may be earned by
//   this station under rule 7.3.13."
//
//   7.3.13.1 — 5 points per GOTA contact, no cap, and no limit on how many a
//   single GOTA operator may make.
//
// So a GOTA contact counts TWICE: full QSO points AND the bonus. The plan
// proposed excluding them from qso_points, which would deflate a claimed
// score by a point per phone contact and two per CW or digital one. That is
// what the first block below pins down, in both directions.
//
// Both values are transcribed in docs/rules-reference.md; check a number
// against that, not against this file.

const { compile } = require('./_compile-ts.cjs');
const ts = compile(['lib/scoring.ts', 'lib/bonuses.ts']);
const { calculateScore } = ts.load('scoring');
const { bonusPoints, bonusRate, isDerivedFromLog, FD_BONUSES } = ts.load('bonuses');

let failures = 0;
const ok = m => console.log(`ok    ${m}`);
const no = (m, d) => { failures++; console.log(`FAIL  ${m}${d ? `  ${d}` : ''}`); };
const eq = (actual, expected, m) =>
  actual === expected ? ok(m) : no(m, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);

let n = 0;
const qso = (over = {}) => ({
  id: `q${n++}`, event_id: 'e', callsign: `W0T${n}`, band: '20m', mode: 'PH',
  datetime_utc: '2026-06-27T18:00:00Z', sent_class: '3A', sent_section: 'MN',
  rcvd_class: '2A', rcvd_section: 'WI', operator_call: 'W0AAA', station_number: 1,
  is_dupe: false, is_gota: false, created_at: '2026-06-27T18:00:00Z',
  rst_sent: null, rst_rcvd: null, rcvd_name: null, rcvd_qth: null,
  rcvd_grid: null, comment: null, adif_mode: null, freq_khz: null,
  ...over,
});
const FD = { eventType: 'FD', entryClass: '3A' };
const score = (qsos, bonuses = {}, power = 'HIGH', entry = FD) =>
  calculateScore(qsos, bonuses, power, entry);

console.log('── a GOTA contact counts twice ──');
{
  // One phone contact at GOTA: 1 QSO point, and 5 bonus points.
  const s = score([qso({ is_gota: true })]);
  eq(s.valid_qsos, 1, 'it is a valid QSO');
  eq(s.qso_points, 1, 'and earns its QSO point like any other (4.1.1.5)');
  eq(s.gota_qsos, 1, 'the log reports one GOTA contact');
  eq(s.bonus_points, 5, 'which claims 5 bonus points (7.3.13.1)');
  eq(s.claimed_score, 1 + 5, 'so the claimed score carries both');

  // The failure the original plan would have shipped, stated as a number.
  const withGota = score([qso({ is_gota: true }), qso({ is_gota: true, mode: 'CW' })]);
  eq(withGota.qso_points, 1 + 2, 'a CW GOTA contact still scores its two points');
  eq(withGota.bonus_points, 10, 'and both earn the bonus');
  // Excluding them from qso_points would give 0 here; that is the deflation.
  eq(withGota.qso_points > 0, true, 'excluding them from QSO points would zero this');
}

console.log('\n── the bonus is counted, not typed ──');
{
  const logged = [qso({ is_gota: true }), qso({ is_gota: true }), qso()];
  const s = score(logged);
  eq(s.gota_qsos, 2, 'two of the three are GOTA');
  eq(s.bonus_points, 10, 'and the bonus follows the log with nothing typed');

  // The whole point of deriving it: a typed number cannot drift from the log.
  // The two are never summed — a club that logs GOTA *and* types a total
  // would otherwise claim every contact twice.
  const alsoTyped = score(logged, { gota_qsos: 99 });
  eq(alsoTyped.bonus_points, 10, 'a typed number does not add to the logged one');

  // A club that logs GOTA elsewhere logs none here, and types instead.
  const typedOnly = score([qso(), qso()], { gota_qsos: 7 });
  eq(typedOnly.gota_qsos, 0, 'no GOTA contacts in the log');
  eq(typedOnly.bonus_points, 35, 'so the typed number is what is claimed');
}

console.log('\n── no cap, and no per-operator limit ──');
{
  // 7.3.13.1 removed both. The app used to apply a 1,000-point cap that was
  // never in the rules — at 5 points each that would bite at 200 contacts.
  const many = Array.from({ length: 300 }, () => qso({ is_gota: true }));
  const s = score(many);
  eq(s.gota_qsos, 300, 'three hundred GOTA contacts');
  eq(s.bonus_points, 1500, 'earn 1500 — the invented 1,000 cap is gone');

  // One operator making all of them is explicitly allowed.
  const oneOp = Array.from({ length: 250 }, () => qso({ is_gota: true, operator_call: 'W0BBB' }));
  eq(score(oneOp).bonus_points, 1250, 'and one operator may make them all');
}

console.log('\n── dupes and deletions ──');
{
  // A duplicate is not a valid contact, so it earns neither QSO points nor a
  // bonus — the same set feeds both, which is what keeps them consistent.
  const s = score([qso({ is_gota: true }), qso({ is_gota: true, is_dupe: true })]);
  eq(s.valid_qsos, 1, 'the dupe is not a valid QSO');
  eq(s.gota_qsos, 1, 'and is not counted for the bonus either');
  eq(s.bonus_points, 5, 'so the bonus follows the valid contacts');
}

console.log('\n── bonuses are never multiplied ──');
{
  // 7.3.13.1 says so explicitly for GOTA, and it holds for every bonus.
  const s = score([qso({ is_gota: true })], {}, 'QRP');
  eq(s.power_multiplier, 5, 'QRP multiplies QSO points by five');
  eq(s.qso_points, 1, 'one QSO point');
  eq(s.total_score, 5, 'so the base score is five');
  eq(s.bonus_points, 5, 'and the bonus stays five, unmultiplied');
  eq(s.claimed_score, 10, 'making ten, not thirty');
}

console.log('\n── Winter Field Day has no GOTA ──');
{
  // WFD has no bonus points at all, so a stray flag must not invent any.
  const s = score([qso({ is_gota: true })], { gota_qsos: 50 }, 'HIGH',
                  { eventType: 'WFD', entryClass: '1O' });
  eq(s.bonus_points, 0, 'no bonus points exist in WFD');
  eq(s.qso_points, 1, 'but the contact still scores');
}

console.log('\n── what the operator is shown ──');
{
  const def = FD_BONUSES.find(d => d.key === 'gota_qsos');
  eq(!!def, true, 'the GOTA bonus is in the schedule');
  eq(def.rule, '7.3.13.1', 'carrying its rule number');
  eq(def.points, 5, 'at 5 points');
  eq(def.max, null, 'with no cap');

  eq(isDerivedFromLog(def, { gotaQsos: 3 }), true, 'the log answers when it has contacts');
  eq(isDerivedFromLog(def, { gotaQsos: 0 }), false, 'and not when it has none');
  const coach = FD_BONUSES.find(d => d.key === 'gota_coach');
  eq(isDerivedFromLog(coach, { gotaQsos: 3 }), false, 'the coach bonus is still a checkbox');

  eq(bonusPoints(def, {}, { gotaQsos: 4 }), 20, 'points come from the log with nothing ticked');
  eq(typeof bonusRate(def, { gotaQsos: 4 }), 'string', 'and the rate renders');
}

console.log(failures === 0 ? '\nAll GOTA tests passed.' : `\n${failures} failure(s).`);
ts.cleanup();
process.exit(failures === 0 ? 0 : 1);
