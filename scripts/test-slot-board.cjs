#!/usr/bin/env node
// Unit tests for lib/slotBoard.ts and lib/bands.ts — what the operating
// position picker shows before an operator sits down.
//
// Both are pure: the board is a function of (bands, modes, reservations,
// presence, now), with the clock passed in rather than read. That is what
// makes the time-window cases testable at all.
//
// The cases that matter are the ones where a wrong answer sends an operator
// to a band somebody else is already signing the callsign on:
//   * a released or expired claim must not read as held
//   * a claim must be attributed to the right person — by operator on an SES,
//     by station on a contest, matching what checkSlot enforces
//   * presence without a claim is its own state, not "open" and not "claimed"

const { compile } = require('./_compile-ts.cjs');
const ts = compile(['lib/slotBoard.ts', 'lib/bands.ts', 'lib/slotWords.ts']);
const { buildSlotBoard, countOpen, slotKey } = ts.load('slotBoard');
const { bandsFor, extraBandsFor, BAND_GRID, MODES } = ts.load('bands');
const { slotWords } = ts.load('slotWords');

let failures = 0;
const ok = m => console.log(`ok    ${m}`);
const no = (m, d) => { failures++; console.log(`FAIL  ${m}${d ? `  ${d}` : ''}`); };
const eq = (actual, expected, m) =>
  actual === expected ? ok(m) : no(m, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);

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
const at_ = (op, band, mode, station = 1) => ({ op_call: op, station, band, mode });

const BANDS = ['20m', '40m'];
const board = (res = [], pres = [], opts = {}) =>
  buildSlotBoard(BANDS, ['PH', 'CW'], res, pres, NOW, opts);
const slot = (b, band = '20m', mode = 'PH') => b.get(slotKey(band, mode));

// ── nothing claimed, nobody present ─────────────────────────────────────
console.log('\n── an empty event ──');
{
  const b = board();
  eq(b.size, 4, 'every band and mode combination gets an entry');
  eq(slot(b).state, 'open', 'and they are open');
  eq(slot(b).onAir.length, 0, 'with nobody on air');
  const { open, total } = countOpen(b);
  eq(`${open}/${total}`, '4/4', 'the count agrees');
}

// ── a claim makes a slot held, and only that slot ───────────────────────
console.log('\n── one claim ──');
{
  const b = board([claim({ band: '20m', mode: 'PH', op_call: 'W0AAA' })], [], { isSes: true, myCall: 'W1BBB' });
  eq(slot(b, '20m', 'PH').state, 'claimed', '20m phone is claimed');
  eq(slot(b, '20m', 'PH').heldBy, 'W0AAA', 'and names the holder');
  eq(slot(b, '20m', 'CW').state, 'open', 'but 20m CW is untouched');
  eq(slot(b, '40m', 'PH').state, 'open', 'and so is 40m phone');
  eq(countOpen(b).open, 3, 'three of four remain open');
}

// ── whose claim is it: operator on an SES, station on a contest ─────────
// The same split checkSlot uses. Getting it backwards would show an operator
// their own booking as somebody else's, or worse, the reverse.
console.log('\n── attribution ──');
{
  const c = [claim({ op_call: 'W0AAA', station_number: null })];
  eq(slot(board(c, [], { isSes: true, myCall: 'W0AAA' })).state, 'mine',
     'an SES claim is mine when the callsign matches');
  eq(slot(board(c, [], { isSes: true, myCall: 'W1BBB' })).state, 'claimed',
     'and someone else\'s when it does not');
}
{
  const c = [claim({ op_call: 'W0AAA', station_number: 2 })];
  eq(slot(board(c, [], { isSes: false, myStation: 2 })).state, 'mine',
     'a contest claim is mine when the station matches');
  eq(slot(board(c, [], { isSes: false, myStation: 1 })).state, 'claimed',
     'and not when a different station holds it');
  eq(slot(board(c, [], { isSes: false, myStation: 1 })).heldBy, 'Station 2',
     'a contest holder is named by station, not callsign');
  eq(slot(board(c, [], { isSes: true, myCall: 'W0AAA' })).heldBy, 'W0AAA',
     'and an SES holder by callsign');
}

// ── claims that should not count ────────────────────────────────────────
console.log('\n── released and expired claims ──');
{
  eq(slot(board([claim({ status: 'RELEASED' })])).state, 'open',
     'a released claim does not hold the slot');
  eq(slot(board([claim({ starts_at: at(-180), ends_at: at(-60) })])).state, 'open',
     'nor does one that already ended');
  eq(slot(board([claim({ starts_at: at(60), ends_at: at(120) })])).state, 'open',
     'nor one that has not started yet');
  eq(slot(board([claim({ ends_at: null })])).state, 'claimed',
     'but an open-ended claim does hold it');
  // Hiding a real claim is worse than showing one too many: it sends someone
  // to a band that is already spoken for.
  eq(slot(board([claim({ starts_at: 'nonsense' })])).state, 'claimed',
     'and an unparseable start is kept rather than dropped');
}

// ── presence is its own state ───────────────────────────────────────────
console.log('\n── on air without a claim ──');
{
  const b = board([], [at_('W0AAA', '20m', 'PH')]);
  eq(slot(b).state, 'busy', 'somebody logging there is busy, not open');
  eq(slot(b).onAir.join(','), 'W0AAA', 'and they are named');
  eq(countOpen(b).open, 3, 'a busy slot does not count as free');
}
{
  // A claim and presence together still reads as claimed — the claim is the
  // stronger statement, and the operator is listed either way.
  const b = board([claim({ op_call: 'W0AAA' })], [at_('W0AAA', '20m', 'PH')], { isSes: true, myCall: 'W1BBB' });
  eq(slot(b).state, 'claimed', 'a claim outranks presence');
  eq(slot(b).onAir.join(','), 'W0AAA', 'and presence is still reported');
}
{
  const b = board([], [at_('W0AAA', '20m', 'PH'), at_('W1BBB', '20m', 'PH', 2)]);
  eq(slot(b).onAir.join(','), 'W0AAA,W1BBB', 'two operators on one slot are both listed');
  const dup = board([], [at_('W0AAA', '20m', 'PH', 1), at_('W0AAA', '20m', 'PH', 2)]);
  eq(slot(dup).onAir.join(','), 'W0AAA', 'and one operator on two radios is listed once');
}

// ── the band list ───────────────────────────────────────────────────────
// A contest must not offer 60m or the WARC bands: they score nothing in
// Field Day or Winter Field Day.
console.log('\n── bands offered ──');
{
  const fd = bandsFor('FD');
  const ses = bandsFor('SES');
  for (const warc of ['60m', '30m', '17m', '12m']) {
    eq(fd.includes(warc), false, `Field Day does not offer ${warc}`);
    eq(ses.includes(warc), true, `but a special event does`);
  }
  eq(bandsFor('WFD').includes('30m'), false, 'Winter Field Day excludes them too');
  eq(fd.includes('20m') && fd.includes('SAT'), true, 'the common bands are there');
  eq(new Set(ses).size, ses.length, 'no band is offered twice');
  eq(BAND_GRID.flat().every(b => fd.includes(b)), true, 'every grid band is offered');
  eq(extraBandsFor('FD').includes('70cm'), true, 'a contest still gets UHF');
  eq(MODES.join(','), 'PH,CW,DIG', 'and the three scoring modes');
}

// ── the two vocabularies ────────────────────────────────────────────────
// The database does the same thing for every event type, but what it means to
// the operator does not. A special event checks out the shared *callsign*; a
// contest coordinates the *transmitter* on a band and mode, and nothing about
// the call is in question — every station sends the club's call all weekend.
//
// The logging panel called itself "Call Checkout" and said "Nobody has the
// call checked out" on a Field Day screen, while the position picker two steps
// earlier had the contest wording right: the same failure as the section list
// in two components. The table is one place now, and this is what keeps a
// contest string from quietly acquiring SES words again.
console.log('\n── slot vocabulary ──');
{
  const fd = slotWords('FD');
  const wfd = slotWords('WFD');
  const ses = slotWords('SES');
  const B = '20m', M = 'PH';

  // Everything a contest operator reads, flattened.
  const contestText = [
    fd.title, fd.blurb, fd.claim(B, M), fd.nowHeading, fd.noneHeld ?? '',
    fd.nobodyHolds(B, M), fd.pickHint, fd.overrideHint,
    fd.claimAndStart, fd.claiming, fd.startWithout, fd.claimFailed,
  ].join(' ').toLowerCase();

  // "Call" is the word that makes a contest string wrong: there is no callsign
  // question on Field Day. "Checkout"/"check out" is the SES metaphor for
  // holding it, and reads as a permission a contest operator does not need.
  for (const word of ['call', 'checkout', 'check out', 'checked out']) {
    eq(contestText.includes(word), false, `no contest string says "${word}"`);
  }
  eq(contestText.includes('band and mode'), true,
    'and a contest string does name the band and mode');

  eq(JSON.stringify(fd) === JSON.stringify(wfd), true,
    'Winter Field Day reads exactly as Field Day — same one-signal rule, same words');
  eq(fd.title === ses.title, false, 'the two are not the same panel heading');
  eq(ses.title.toLowerCase().includes('call'), true,
    'and a special event does say call, because the call is what is held');

  // Null is the deliberate value, not a missing string: on a contest an
  // unclaimed band is normal and the Operators panel already answers it.
  eq(fd.noneHeld, null, 'a contest has no empty-list line');
  eq(typeof ses.noneHeld, 'string', 'a special event does — an unheld call is news');

  // Every field is populated for both, so a new one cannot ship half-written.
  for (const [name, w] of [['FD', fd], ['SES', ses]]) {
    for (const key of ['title', 'blurb', 'nowHeading', 'pickHint', 'overrideHint',
                       'claimAndStart', 'claiming', 'startWithout', 'claimFailed']) {
      eq(typeof w[key] === 'string' && w[key].length > 0, true, `${name}.${key} is set`);
    }
    for (const key of ['claim', 'nobodyHolds']) {
      eq(w[key](B, M).includes(B) && w[key](B, M).includes(M), true,
        `${name}.${key}() names the band and the mode`);
    }
  }
}

console.log(failures === 0 ? '\nAll slot board tests passed.' : `\n${failures} failure(s).`);
ts.cleanup();
process.exit(failures === 0 ? 0 : 1);
