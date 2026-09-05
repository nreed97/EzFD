#!/usr/bin/env node
// Unit tests for lib/opStats.ts — the per-operator table on the dashboard.
//
// The whole module exists to answer "who worked what" off data already in the
// log, and the ways that goes wrong are all quiet ones: a number that looks
// plausible and is not. So the assertions here are mostly about agreement
// rather than about any single figure.
//
//   * The rows must sum to the log. Contacts with no operator and duplicate
//     contacts are the two things that would otherwise vanish, and a table
//     totalling less than the scoreboard beside it gives the reader no way to
//     tell which of the two is wrong. reconcile() is checked against every
//     fixture here, not just the one written for it.
//   * A dupe must earn nothing — not points, not a band, not a section —
//     while still being counted. It is the same split the scorer makes, and
//     making it twice in two places is how they come to disagree.
//   * A section belongs to whoever reached it first, which means the log has
//     to be read in time order. It does not arrive that way: SSE puts new
//     contacts at the front and an ADIF import can carry contacts older than
//     everything already logged.
//   * Rate is a best hour. An average over the shift is a different number
//     and the two must not be confused for each other, so both are asserted
//     on the same fixture with deliberately different answers.
//   * Nothing here may be multiplied. Per-operator points are QSO points; the
//     power multiplier belongs to the entry and a bonus belongs to the club.

const { compile } = require('./_compile-ts.cjs');
const ts = compile(['lib/opStats.ts', 'lib/scoring.ts']);
const {
  operatorStats, sortOpStats, bestHourOf, reconcile, qsoTime, UNATTRIBUTED,
} = ts.load('opStats');
const { calculateScore } = ts.load('scoring');

let failures = 0;
const ok = m => console.log(`ok    ${m}`);
const no = (m, d) => { failures++; console.log(`FAIL  ${m}${d ? `  ${d}` : ''}`); };
const eq = (actual, expected, m) =>
  actual === expected ? ok(m) : no(m, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
const deep = (actual, expected, m) =>
  JSON.stringify(actual) === JSON.stringify(expected)
    ? ok(m)
    : no(m, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
const truthy = (v, m) => (v ? ok(m) : no(m));

const T0 = Date.parse('2026-06-27T18:00:00Z');
const at = mins => new Date(T0 + mins * 60_000).toISOString();

let seq = 0;
const qso = (over = {}) => ({
  id: `id-${seq++}`,
  event_id: 'ev',
  callsign: 'K1ABC',
  band: '20m',
  mode: 'PH',
  datetime_utc: at(0),
  sent_class: '3A',
  sent_section: 'MN',
  rcvd_class: '2A',
  rcvd_section: 'EPA',
  operator_call: 'W0AAA',
  station_number: 1,
  is_dupe: false,
  is_gota: false,
  deleted_at: null,
  created_at: at(0),
  rst_sent: null, rst_rcvd: null, rcvd_name: null, rcvd_qth: null,
  rcvd_grid: null, comment: null, adif_mode: null, freq_khz: null,
  ...over,
});

const rowFor = (table, call) => table.rows.find(r => r.call === call);

// Every fixture built in this file gets reconciled, so a future column that
// silently drops contacts fails here rather than on a dashboard at an event.
const reconciled = [];
function statsOf(qsos, eventType = 'FD') {
  const table = operatorStats(qsos, eventType);
  reconciled.push({ table, qsos });
  return table;
}

console.log('\n-- the rows add up to the log --');
{
  const log = [
    qso({ operator_call: 'W0AAA' }),
    qso({ operator_call: 'W0AAA', datetime_utc: at(5) }),
    qso({ operator_call: 'K9BBB', datetime_utc: at(10) }),
    // An ADIF import: no operator recorded anywhere in the file.
    qso({ operator_call: null, datetime_utc: at(15) }),
    qso({ operator_call: '', datetime_utc: at(16) }),
    // A dupe still belongs to whoever logged it.
    qso({ operator_call: 'K9BBB', datetime_utc: at(20), is_dupe: true }),
  ];
  const t = statsOf(log);

  eq(t.totals.qsos, 5, 'scoring contacts total 5');
  eq(t.totals.dupes, 1, 'the dupe is counted, not dropped');
  eq(t.totals.operators, 2, 'two operators — the unattributed bucket is not a person');
  truthy(t.hasUnattributed, 'the unattributed row is flagged for the UI');
  eq(t.rows.length, 3, 'three rows: two operators and the bucket');

  // The one number a reader will actually cross-check.
  const score = calculateScore(log, {}, 'HIGH', { eventType: 'FD', entryClass: '3A' });
  eq(t.totals.qsos, score.valid_qsos, 'the table agrees with calculateScore on valid QSOs');
  eq(t.totals.qsoPoints, score.qso_points, 'the points column agrees with calculateScore');

  const bucket = rowFor(t, UNATTRIBUTED);
  truthy(bucket, 'a row exists for contacts with no operator');
  eq(bucket.qsos, 2, 'null and empty-string operators land in the same bucket');
}

console.log('\n-- the unattributed bucket sorts last, whichever way the table is sorted --');
{
  const log = [
    qso({ operator_call: 'W0AAA', datetime_utc: at(0) }),
    ...Array.from({ length: 20 }, (_, i) => qso({ operator_call: null, datetime_utc: at(i) })),
  ];
  const t = statsOf(log);
  eq(t.rows[t.rows.length - 1].call, UNATTRIBUTED, 'largest row still sorts last by QSOs desc');
  const asc = sortOpStats(t.rows, 'qsos', 'asc');
  eq(asc[asc.length - 1].call, UNATTRIBUTED, 'and last ascending too, not first');
  const byCall = sortOpStats(t.rows, 'call', 'asc');
  eq(byCall[byCall.length - 1].call, UNATTRIBUTED, 'and last sorted by callsign');
}

console.log('\n-- a dupe earns nothing but is still counted --');
{
  const log = [
    qso({ operator_call: 'W0AAA', band: '20m', mode: 'PH', rcvd_section: 'EPA' }),
    // Same station again on a band and mode the operator has not otherwise
    // worked, carrying a section nobody has: if a dupe leaked into any of the
    // derived columns, this is the contact that would show it.
    qso({
      operator_call: 'W0AAA', band: '40m', mode: 'CW', rcvd_section: 'STX',
      datetime_utc: at(30), is_dupe: true, station_number: 7,
    }),
  ];
  const t = statsOf(log);
  const r = rowFor(t, 'W0AAA');
  eq(r.qsos, 1, 'the dupe is not a scoring contact');
  eq(r.dupes, 1, 'but it is counted as a dupe');
  eq(r.qsoPoints, 1, 'the dupe earns no points');
  deep(r.bands, ['20m'], 'the dupe does not add a band');
  deep(r.modes, ['PH'], 'the dupe does not add a mode');
  deep(r.stations, [1], 'the dupe does not add a station');
  eq(r.sections, 1, 'the dupe does not add a section');
  deep(r.firstSections, ['EPA'], 'and cannot claim one first');
  eq(r.bestHour, 1, 'the dupe is not in the rate');
}

console.log('\n-- sections go to whoever reached them first, in time order --');
{
  // Deliberately out of order in the array, the way the dashboard holds it:
  // SSE unshifts new contacts, and an import can be older than all of them.
  const log = [
    qso({ operator_call: 'K9BBB', rcvd_section: 'EPA', datetime_utc: at(50) }),
    qso({ operator_call: 'W0AAA', rcvd_section: 'EPA', datetime_utc: at(10) }),
    qso({ operator_call: 'K9BBB', rcvd_section: 'STX', datetime_utc: at(20) }),
  ];
  const t = statsOf(log);
  deep(rowFor(t, 'W0AAA').firstSections, ['EPA'], 'W0AAA got EPA first despite being later in the array');
  deep(rowFor(t, 'K9BBB').firstSections, ['STX'], 'K9BBB gets only the one nobody had');
  eq(rowFor(t, 'K9BBB').sections, 2, 'but still counts EPA among the sections worked');

  const firsts = t.rows.reduce((n, r) => n + r.firstSections.length, 0);
  const score = calculateScore(log, {}, 'HIGH', { eventType: 'FD', entryClass: '3A' });
  eq(firsts, score.sections.length, 'every section worked is first-worked by exactly one operator');
}

console.log('\n-- DX and MX are exchanges, not sections --');
{
  const log = [
    qso({ operator_call: 'W0AAA', rcvd_section: 'DX', datetime_utc: at(0) }),
    qso({ operator_call: 'W0AAA', rcvd_section: 'MX', datetime_utc: at(1) }),
    qso({ operator_call: 'W0AAA', rcvd_section: 'ZZZ', datetime_utc: at(2) }),
    qso({ operator_call: 'W0AAA', rcvd_section: 'EPA', datetime_utc: at(3) }),
  ];
  const t = statsOf(log, 'WFD');
  eq(rowFor(t, 'W0AAA').sections, 1, 'only EPA counts — DX, MX and a typo do not');
  deep(rowFor(t, 'W0AAA').firstSections, ['EPA'], 'and none of the three can be first-worked');
  eq(rowFor(t, 'W0AAA').qsos, 4, 'all four are still scoring contacts');
}

console.log('\n-- a special event has no sections to count --');
{
  const log = [qso({ operator_call: 'W0AAA', rcvd_section: 'EPA' })];
  const t = statsOf(log, 'SES');
  eq(t.showsSections, false, 'the sections columns are off for an SES');
  eq(rowFor(t, 'W0AAA').sections, 0, 'and nothing is counted even if the column carries a value');
}

console.log('\n-- best hour is a rolling window, not a clock hour --');
{
  // 30 contacts from 18:45 to 19:14 — 30 inside one rolling hour, but split
  // 15/15 by the 19:00 boundary. A clock-hour count reports 15.
  const log = Array.from({ length: 30 }, (_, i) =>
    qso({ operator_call: 'W0AAA', datetime_utc: at(45 + i) }));
  const t = statsOf(log);
  eq(rowFor(t, 'W0AAA').bestHour, 30, 'a run straddling the clock hour is not cut in half');
  eq(rowFor(t, 'W0AAA').bestHourAt, at(45), 'and the window is reported from where it starts');
}

console.log('\n-- best hour and span rate answer different questions --');
{
  // 60 contacts in the first hour, then one four hours later. Best hour is
  // the run; the span average is 61 over five hours.
  const log = [
    ...Array.from({ length: 60 }, (_, i) => qso({ operator_call: 'W0AAA', datetime_utc: at(i) })),
    qso({ operator_call: 'W0AAA', datetime_utc: at(300) }),
  ];
  const t = statsOf(log);
  const r = rowFor(t, 'W0AAA');
  eq(r.bestHour, 60, 'the run is reported as 60');
  eq(Math.round(r.spanRate), 12, 'the span average is 12/hr — a different number, deliberately');
  truthy(r.bestHour !== Math.round(r.spanRate), 'the two figures are not interchangeable');
}

console.log('\n-- a window boundary is half-open --');
{
  deep(bestHourOf([0, 3_600_000]), { count: 1, startMs: 0 },
    'a contact exactly an hour later starts a new window');
  deep(bestHourOf([0, 3_599_999]), { count: 2, startMs: 0 },
    'a millisecond under still shares one');
  deep(bestHourOf([]), { count: 0, startMs: null }, 'no contacts, no window');
  deep(bestHourOf([5, 1, 3]), { count: 3, startMs: 1 }, 'unsorted input is handled');
}

console.log('\n-- a rate per hour needs an hour to average over --');
{
  const one = statsOf([qso({ operator_call: 'W0AAA' })]);
  eq(rowFor(one, 'W0AAA').spanRate, null, 'a single contact has no span rate');
  eq(rowFor(one, 'W0AAA').bestHour, 1, 'but it is still one contact in an hour');

  const same = statsOf([
    qso({ operator_call: 'W0AAA', datetime_utc: at(0) }),
    qso({ operator_call: 'W0AAA', datetime_utc: at(0), band: '40m' }),
  ]);
  eq(rowFor(same, 'W0AAA').spanRate, null, 'two contacts in the same instant do not divide by zero');

  // The case the unit test above misses and a real log hits immediately: the
  // server stamps each contact with NOW(), so a burst of entry lands
  // milliseconds apart rather than identically. Dividing by that span
  // projects a fraction of a second out to a full hour, and two contacts two
  // seconds apart came out on screen as 720,000/hr.
  const burst = statsOf([
    qso({ operator_call: 'W0AAA', datetime_utc: new Date(T0).toISOString() }),
    qso({ operator_call: 'W0AAA', datetime_utc: new Date(T0 + 2_000).toISOString(), band: '40m' }),
  ]);
  eq(rowFor(burst, 'W0AAA').spanRate, null, 'two contacts two seconds apart are not 3,600/hr');
  eq(rowFor(burst, 'W0AAA').bestHour, 2, 'best hour still reports them, by counting');

  const halfShift = statsOf(
    Array.from({ length: 30 }, (_, i) => qso({ operator_call: 'W0AAA', datetime_utc: at(i) })));
  eq(rowFor(halfShift, 'W0AAA').spanRate, null, 'a 29-minute shift has no per-hour average either');
  eq(rowFor(halfShift, 'W0AAA').bestHour, 30, 'and best hour is the figure that describes it');

  const anHour = statsOf([
    qso({ operator_call: 'W0AAA', datetime_utc: at(0) }),
    qso({ operator_call: 'W0AAA', datetime_utc: at(60), band: '40m' }),
  ]);
  eq(rowFor(anHour, 'W0AAA').spanRate, 2, 'a span of exactly an hour does get one');

  // And it must sort below a real rate rather than above it.
  const rows = sortOpStats(
    [
      { call: 'A', spanRate: null, qsos: 1, dupes: 0, qsoPoints: 1, ph: 1, cw: 0, dig: 0, gota: 0, bands: [], modes: [], stations: [], sections: 0, firstSections: [], bestHour: 1, bestHourAt: null, first: null, last: null },
      { call: 'B', spanRate: 0.5, qsos: 2, dupes: 0, qsoPoints: 2, ph: 2, cw: 0, dig: 0, gota: 0, bands: [], modes: [], stations: [], sections: 0, firstSections: [], bestHour: 1, bestHourAt: null, first: null, last: null },
    ],
    'spanRate', 'desc',
  );
  eq(rows[0].call, 'B', 'a real rate outranks a missing one');
}

console.log('\n-- points are QSO points, before any multiplier --');
{
  const log = [
    qso({ operator_call: 'W0AAA', mode: 'PH' }),
    qso({ operator_call: 'W0AAA', mode: 'CW', datetime_utc: at(1) }),
    qso({ operator_call: 'W0AAA', mode: 'DIG', datetime_utc: at(2) }),
  ];
  const t = statsOf(log);
  eq(rowFor(t, 'W0AAA').qsoPoints, 5, 'PH 1 + CW 2 + DIG 2 = 5');

  // The same log at QRP scores 25 with the multiplier. Per-operator points
  // must not follow it: a column that did would sum to a number the entry
  // never claimed, on a screen right beside the one that claims it.
  const qrp = calculateScore(log, {}, 'QRP', { eventType: 'FD', entryClass: '3A' });
  eq(qrp.total_score, 25, 'the entry scores 25 at QRP');
  eq(operatorStats(log).totals.qsoPoints, 5, 'the operator column stays at 5');

  // And a bonus is never divided among people either.
  const withBonus = calculateScore(log, { emergency_power: 3 }, 'HIGH', { eventType: 'FD', entryClass: '3A' });
  truthy(withBonus.bonus_points > 0, 'the entry claims a bonus');
  eq(operatorStats(log).totals.qsoPoints, 5, 'no part of it reaches any operator row');
}

console.log('\n-- one operator, two radios --');
{
  const log = [
    qso({ operator_call: 'W0AAA', station_number: 1, band: '20m', datetime_utc: at(0) }),
    qso({ operator_call: 'W0AAA', station_number: 2, band: '40m', datetime_utc: at(1) }),
    qso({ operator_call: 'W0AAA', station_number: 1, band: '20m', datetime_utc: at(2) }),
  ];
  const t = statsOf(log);
  const r = rowFor(t, 'W0AAA');
  deep(r.stations, [1, 2], 'both radios are listed, once each');
  deep(r.bands, ['40m', '20m'], 'bands come back in band order, not log order');
  eq(t.rows.length, 1, 'and it is still one operator, not two');
}

console.log('\n-- callsigns are normalised --');
{
  const log = [
    qso({ operator_call: 'w0aaa', datetime_utc: at(0) }),
    qso({ operator_call: 'W0AAA ', datetime_utc: at(1) }),
    qso({ operator_call: ' W0AAA', datetime_utc: at(2) }),
  ];
  const t = statsOf(log);
  eq(t.rows.length, 1, 'case and whitespace do not split one shift into three');
  eq(rowFor(t, 'W0AAA').qsos, 3, 'all three contacts land on the one operator');
}

console.log('\n-- GOTA contacts are attributed to the operator, not moved out --');
{
  const log = [
    qso({ operator_call: 'W0AAA', is_gota: true, datetime_utc: at(0) }),
    qso({ operator_call: 'W0AAA', is_gota: false, datetime_utc: at(1) }),
  ];
  const t = statsOf(log);
  const r = rowFor(t, 'W0AAA');
  eq(r.qsos, 2, 'a GOTA contact is still one of the operator\'s contacts (rule 4.1.1.5)');
  eq(r.gota, 1, 'and is identified as one');
  eq(r.qsoPoints, 2, 'earning its normal QSO points');
  truthy(t.hasGota, 'the column is shown when the log has one');
  eq(statsOf([qso({ operator_call: 'W0AAA' })]).hasGota, false, 'and hidden when it does not');
}

console.log('\n-- soft-deleted contacts belong to nobody --');
{
  const log = [
    qso({ operator_call: 'W0AAA', datetime_utc: at(0) }),
    qso({ operator_call: 'W0AAA', datetime_utc: at(1), deleted_at: at(2), deleted_by: 'W0AAA' }),
  ];
  const t = statsOf(log);
  eq(rowFor(t, 'W0AAA').qsos, 1, 'a deleted contact is not in the total');
  eq(t.totals.qsoPoints, 1, 'nor in the points');
}

console.log('\n-- an empty log is a table, not a crash --');
{
  const t = statsOf([]);
  eq(t.rows.length, 0, 'no rows');
  eq(t.totals.qsos, 0, 'no contacts');
  eq(t.totals.operators, 0, 'no operators');
  eq(t.hasUnattributed, false, 'and nothing to explain');
}

console.log('\n-- sorting is stable and ties break on callsign --');
{
  const log = [
    qso({ operator_call: 'K9BBB', datetime_utc: at(0) }),
    qso({ operator_call: 'W0AAA', datetime_utc: at(1) }),
    qso({ operator_call: 'N3CCC', datetime_utc: at(2) }),
  ];
  const t = statsOf(log);
  deep(t.rows.map(r => r.call), ['K9BBB', 'N3CCC', 'W0AAA'],
    'three operators level on one QSO each come back in callsign order');
  const again = sortOpStats(t.rows, 'qsos', 'desc');
  deep(again.map(r => r.call), t.rows.map(r => r.call), 'and re-sorting does not reshuffle them');
}

console.log('\n-- pg hands back Date objects, the API hands back strings --');
{
  const asDate = statsOf([
    qso({ operator_call: 'W0AAA', datetime_utc: new Date(T0) }),
    qso({ operator_call: 'W0AAA', datetime_utc: new Date(T0 + 60_000) }),
  ]);
  eq(rowFor(asDate, 'W0AAA').bestHour, 2, 'Date timestamps are read');
  eq(rowFor(asDate, 'W0AAA').first, at(0), 'and normalised to ISO on the way out');
  eq(qsoTime(new Date(T0)), qsoTime(at(0)), 'both shapes give the same instant');
}

console.log('\n-- every fixture in this file reconciles with its log --');
{
  let bad = 0;
  for (const { table, qsos } of reconciled) {
    const r = reconcile(table, qsos);
    if (!r.ok) { bad++; no('reconcile', r.detail); }
  }
  if (bad === 0) ok(`${reconciled.length} tables account for every contact in their log`);
}

console.log('\n-- reconcile actually fails when a row is dropped --');
{
  const log = [qso({ operator_call: 'W0AAA' }), qso({ operator_call: null, datetime_utc: at(1) })];
  const t = operatorStats(log);
  const short = { ...t, rows: t.rows.filter(r => r.call !== UNATTRIBUTED) };
  short.totals = { ...t.totals, qsos: t.totals.qsos - 1, ph: t.totals.ph - 1 };
  eq(reconcile(short, log).ok, false, 'dropping the unattributed bucket is caught');
  eq(reconcile(t, log).ok, true, 'and the real table passes');
}

console.log('');
if (failures > 0) {
  console.error(`${failures} failure(s)`);
  process.exit(1);
}
console.log('All per-operator statistics tests passed.');
