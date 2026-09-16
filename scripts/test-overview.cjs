#!/usr/bin/env node
// Unit tests for lib/overview.ts and the band ordering in lib/bands.ts — what
// the dashboard's site display says is running and what is free.
//
// The display is read by somebody standing in front of a screen deciding where
// to send the next operator, so a wrong answer here sends them to a band that
// is already occupied, or leaves a genuinely free band looking taken. The
// cases that matter:
//
//   * coverage outranks a claim — a band somebody is sitting on is not a gap,
//     however its paperwork looks
//   * a claim with nobody there is its own state, not "free" and not "covered"
//   * the band rows are the event's own bands in frequency order, so a special
//     event's 30m row exists and a contest's does not
//   * the counts add up to the grid, or the "N free" line on the display is
//     describing something other than what is drawn under it

const { compile } = require('./_compile-ts.cjs');
const ts = compile(['lib/overview.ts', 'lib/slotBoard.ts', 'lib/bands.ts']);
const { buildOverview, activeBands, countCoverage } = ts.load('overview');
const { buildSlotBoard } = ts.load('slotBoard');
const { BAND_ORDER, bandsFor, orderedBandsFor, MODES, BAND_GRID, EXTRA_BANDS, SES_EXTRA_BANDS } = ts.load('bands');

let failures = 0;
const ok = m => console.log(`ok    ${m}`);
const no = (m, d) => { failures++; console.log(`FAIL  ${m}${d ? `  ${d}` : ''}`); };
const eq = (actual, expected, m) =>
  actual === expected ? ok(m) : no(m, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
const truthy = (v, m) => (v ? ok(m) : no(m));
const same = (a, b, m) =>
  JSON.stringify(a) === JSON.stringify(b) ? ok(m) : no(m, `got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);

const NOW = Date.parse('2026-06-27T20:00:00Z');
const at = mins => new Date(NOW + mins * 60_000).toISOString();

let seq = 0;
const claim = (over = {}) => ({
  id: `r${seq++}`,
  op_call: 'W0AAA',
  band: '20m',
  mode: 'PH',
  station_number: null,
  starts_at: at(-30),
  ends_at: at(90),
  status: 'RESERVED',
  ...over,
});
const here = (op, band, mode, station = 1) => ({ op_call: op, station, band, mode });

const BANDS = ['80m', '40m', '20m'];
// The event's real mode list, not a copy of it.
const MODES3 = MODES;

const overview = (reservations, presence, byBand = {}, opts = {}) =>
  buildOverview(
    BANDS, MODES3,
    buildSlotBoard(BANDS, MODES3, reservations, presence, NOW, opts),
    byBand,
  );

const slotOf = (ov, band, mode) =>
  ov.bands.find(b => b.band === band).slots.find(s => s.mode === mode);

// ── the ordering is one list, and it covers every band ───────────────────────
console.log('\n-- band rows are the event\'s own bands, in frequency order --');
{
  // BAND_GRID is a keyboard layout and BAND_ORDER a frequency list. They are
  // two arrangements of one set; drifting apart is how BandBreakdown came to
  // silently drop four bands.
  const grid = new Set([...BAND_GRID.flat(), ...EXTRA_BANDS, ...SES_EXTRA_BANDS]);
  const order = new Set(BAND_ORDER);
  const missing = [...grid].filter(b => !order.has(b));
  const extra = [...order].filter(b => !grid.has(b));
  if (missing.length === 0 && extra.length === 0) ok('BAND_ORDER holds exactly the bands the grid offers');
  else no('BAND_ORDER holds exactly the bands the grid offers',
    `missing ${missing.join(', ') || '(none)'}; extra ${extra.join(', ') || '(none)'}`);

  eq(BAND_ORDER.length, new Set(BAND_ORDER).size, 'and lists each of them once');

  // The four bands only a special event can log. These were the ones missing
  // from the copy this replaced.
  const ses = orderedBandsFor('SES');
  const fd = orderedBandsFor('FD');
  for (const b of ['60m', '30m', '17m', '12m']) {
    truthy(ses.includes(b) && !fd.includes(b), `${b} is a special event band and a contest has no row for it`);
  }

  // Frequency order, so a reader scans down the bands the way a radio tunes.
  eq(ses.indexOf('160m') < ses.indexOf('80m') && ses.indexOf('80m') < ses.indexOf('40m')
     && ses.indexOf('40m') < ses.indexOf('20m') && ses.indexOf('20m') < ses.indexOf('10m'),
     true, 'rows run from the lowest band to the highest');

  // Same membership as bandsFor, just reordered -- not a second band list.
  same([...orderedBandsFor('SES')].sort(), [...bandsFor('SES')].sort(),
    'ordering an event\'s bands changes the order and nothing else');
}

// ── coverage outranks a claim ───────────────────────────────────────────────
console.log('\n-- somebody on the band beats the paperwork --');
{
  // Claimed by W0AAA and W0BBB is actually sitting on it. The display must not
  // call this "claimed": the question it answers is where the gaps are, and
  // this is not a gap.
  const ov = overview(
    [claim({ band: '20m', mode: 'PH', op_call: 'W0AAA' })],
    [here('W0BBB', '20m', 'PH')],
    {}, { isSes: true },
  );
  const s = slotOf(ov, '20m', 'PH');
  eq(s.coverage, 'covered', 'a claimed band with somebody on it reads as covered');
  same(s.onAir, ['W0BBB'], 'and names who is actually there');
  eq(s.heldBy, 'W0AAA', 'while still saying who holds it');
}
{
  const ov = overview([claim({ band: '20m', mode: 'PH' })], [], {}, { isSes: true });
  const s = slotOf(ov, '20m', 'PH');
  eq(s.coverage, 'claimed', 'a claim with nobody there is claimed, not covered');
  same(s.onAir, [], 'and lists nobody on air');
  eq(s.until, at(90), 'and carries when it ends');
}
{
  const ov = overview([], [here('W0CCC', '40m', 'CW')], {});
  eq(slotOf(ov, '40m', 'CW').coverage, 'covered',
    'presence with no claim is covered — the normal case on a contest');
  eq(slotOf(ov, '40m', 'PH').coverage, 'free', 'and the other modes on that band stay free');
}
{
  const ov = overview([], [], {});
  eq(slotOf(ov, '20m', 'PH').coverage, 'free', 'nothing claimed and nobody there is free');
}

// ── a claim that is not running now must not read as held ───────────────────
console.log('\n-- an expired or released claim is not coverage --');
{
  const ov = overview([claim({ ends_at: at(-1) })], [], {}, { isSes: true });
  eq(slotOf(ov, '20m', 'PH').coverage, 'free', 'a claim that has ended frees the band');
}
{
  const ov = overview([claim({ status: 'RELEASED' })], [], {}, { isSes: true });
  eq(slotOf(ov, '20m', 'PH').coverage, 'free', 'a released claim frees the band');
}
{
  const ov = overview([claim({ starts_at: at(60), ends_at: at(120) })], [], {}, { isSes: true });
  eq(slotOf(ov, '20m', 'PH').coverage, 'free', 'a claim that starts later does not hold it yet');
}

// ── the display has no "me" ─────────────────────────────────────────────────
console.log('\n-- a wall display has no "me" --');
{
  // The picker splits a claim into `mine` and `claimed` because one operator is
  // asking whether they may sit down. Nobody is signed in to a site display, so
  // both must read the same -- otherwise whichever browser happens to have a
  // callsign in sessionStorage shows a different board from the one beside it.
  const withMe = overview([claim({ op_call: 'W0AAA' })], [], {}, { isSes: true, myCall: 'W0AAA' });
  const without = overview([claim({ op_call: 'W0AAA' })], [], {}, { isSes: true });
  eq(withMe.bands.find(b => b.band === '20m').slots.find(s => s.mode === 'PH').coverage,
     'claimed', 'a claim held by the viewer still reads as claimed');
  same(withMe, without, 'and the whole board is identical either way');
}

// ── attribution follows the event type ──────────────────────────────────────
console.log('-- a claim is named the way the event names it --');
{
  const ses = overview([claim({ op_call: 'W0AAA' })], [], {}, { isSes: true });
  eq(slotOf(ses, '20m', 'PH').heldBy, 'W0AAA', 'a special event claim is held by a callsign');

  const contest = overview([claim({ op_call: 'W0AAA', station_number: 2 })], [], {});
  eq(slotOf(contest, '20m', 'PH').heldBy, 'Station 2', 'a contest claim is held by a transmitter');
}

// ── the counts describe the grid they sit above ─────────────────────────────
console.log('\n-- the summary adds up to what is drawn --');
{
  const ov = overview(
    [claim({ band: '80m', mode: 'CW' }), claim({ band: '20m', mode: 'PH' })],
    [here('W0BBB', '20m', 'PH'), here('W0CCC', '40m', 'DIG')],
    {}, { isSes: true },
  );
  eq(ov.covered + ov.claimed + ov.free, BANDS.length * MODES3.length,
    'covered + claimed + free is every slot on the board');
  eq(ov.covered, 2, 'two slots have somebody on them');
  eq(ov.claimed, 1, 'one is booked with nobody there');
  same(ov.onAir, ['W0BBB', 'W0CCC'], 'and everyone on air is listed once, sorted');
}
{
  // The same operator in two logging windows is one person, twice. The band
  // panel should say so once.
  const ov = overview([], [here('W0BBB', '20m', 'PH', 1), here('W0BBB', '40m', 'CW', 2)], {});
  same(ov.onAir, ['W0BBB'], 'one operator running two radios is named once');
  eq(ov.covered, 2, 'but both of their bands count as covered');
}

// ── per-band contact counts come from the scorer ────────────────────────────
console.log('\n-- contacts per band are the scorer\'s figures --');
{
  const ov = overview([], [], { '20m': { ph: 10, cw: 4, dig: 1 }, '40m': { ph: 3, cw: 0, dig: 0 } });
  eq(ov.bands.find(b => b.band === '20m').qsos, 15, 'a band totals its three modes');
  eq(ov.bands.find(b => b.band === '40m').qsos, 3, 'and another does the same');
  eq(ov.bands.find(b => b.band === '80m').qsos, 0, 'a band with no contacts reads zero, not blank');
}

// ── the printed summary describes the printed grid ──────────────────────────
console.log('\n-- the summary counts the rows it is printed above --');
{
  // The board's own totals cover every band the event offers. Printed straight
  // above a filtered grid they describe something the reader cannot see: the
  // first render said "29 free" over five visible rows holding nine free
  // cells. So the display counts the drawn rows, and this is that count.
  const ov = overview([], [here('W0BBB', '40m', 'CW')], { '20m': { ph: 5, cw: 0, dig: 0 } });
  const rows = activeBands(ov, 0);
  const n = countCoverage(rows);
  eq(n.covered + n.claimed + n.free, rows.length * MODES3.length,
    'the counts add up to exactly the cells drawn');
  eq(n.covered, 1, 'one drawn cell has somebody on it');
  eq(n.free, 5, 'and five of the six drawn cells are free');
  truthy(n.free < ov.free, 'which is fewer than the whole board has, because rows were dropped');
}
{
  // With nothing filtered out the two must agree, or one of them is wrong.
  const ov = overview([claim({ band: '80m', mode: 'PH' })], [here('W0BBB', '40m', 'CW')], {}, { isSes: true });
  const n = countCoverage(ov.bands);
  same([n.covered, n.claimed, n.free], [ov.covered, ov.claimed, ov.free],
    'counting every row reproduces the board\'s own totals');
}

// ── which rows are worth drawing ────────────────────────────────────────────
console.log('\n-- the display drops rows that say nothing --');
{
  const ov = overview([], [here('W0BBB', '40m', 'CW')], { '20m': { ph: 5, cw: 0, dig: 0 } });
  const rows = activeBands(ov, 0).map(b => b.band);
  same(rows, ['40m', '20m'], 'a band earns a row by having contacts or somebody on it');
}
{
  const ov = overview([claim({ band: '80m', mode: 'PH' })], [], {}, { isSes: true });
  same(activeBands(ov, 0).map(b => b.band), ['80m'], 'a booked band earns one too, before anyone sits down');
}
{
  // At the start of an event nothing qualifies, and a board that collapses to
  // nothing looks broken rather than empty.
  const ov = overview([], [], {});
  eq(activeBands(ov, 3).length, 3, 'an event that has not started yet still draws a floor of rows');
  same(activeBands(ov, 3).map(b => b.band), BANDS, 'and they are the first rows in band order');
}
{
  const ov = overview([], [here('W0BBB', '40m', 'CW')], {});
  const rows = activeBands(ov, 3).map(b => b.band);
  eq(rows.length, 3, 'topping up to the floor keeps the rows that earned their place');
  truthy(rows.includes('40m'), 'including the one somebody is on');
  same(rows, BANDS, 'and the result stays in band order rather than active-first');
}

console.log('');
if (failures) {
  console.log(`\x1b[31m${failures} check(s) failed\x1b[0m`);
  process.exit(1);
}
console.log('\x1b[32mAll overview tests passed\x1b[0m');
