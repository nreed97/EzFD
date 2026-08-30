#!/usr/bin/env node
// Unit tests for lib/lastPosition.ts — what the operating position picker
// opens on before the operator touches anything.
//
// The rule this encodes is that a *claim* outranks a *memory*: a checkout is
// somebody's statement about where an operator should be, while the last
// position is only a record of where a browser was. Getting that backwards
// would preselect the band a laptop happens to be sitting on over the one the
// schedule booked for this shift.
//
// The other half is validation. A remembered position is read back out of
// localStorage, which anybody can edit and which survives an event being
// recreated under the same join code, so it is checked against the bands the
// event actually offers rather than trusted. A 30m memory must not follow an
// operator into a contest that cannot score 30m.

const { compile } = require('./_compile-ts.cjs');
const ts = compile(['lib/lastPosition.ts', 'lib/slotBoard.ts', 'lib/bands.ts']);
const { positionKey, validPosition, suggestPosition, NO_POSITION } = ts.load('lastPosition');
const { buildSlotBoard } = ts.load('slotBoard');
const { bandsFor, MODES } = ts.load('bands');

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
  status: 'ACTIVE',
  starts_at: at(-30),
  ends_at: at(30),
  ...over,
});

/** A board for an event type, with whatever claims and presence are passed. */
const boardFor = (eventType, reservations = [], presence = [], opts = {}) =>
  buildSlotBoard(bandsFor(eventType), MODES, reservations, presence, NOW, opts);

// ── the storage key ──────────────────────────────────────────────────────────
// One club laptop is one radio. The band station 2 was last on says nothing
// about where station 1 should sit, so the key carries both.
console.log('── the storage key ──');
{
  eq(positionKey('ABC123', 1) === positionKey('ABC123', 2), false,
     'two stations at one event do not share a key');
  eq(positionKey('ABC123', 1) === positionKey('XYZ789', 1), false,
     'two events do not share a key');
  eq(positionKey('ABC123', 1), positionKey('ABC123', 1), 'and the key is stable');
}

// ── validating what came back out of storage ────────────────────────────────
console.log('\n── validating a remembered position ──');
{
  eq(validPosition(null, 'FD'), null, 'nothing remembered');
  eq(validPosition(undefined, 'FD'), null, 'undefined is not a position');
  eq(validPosition(NO_POSITION, 'FD'), null, 'the empty fallback is not a position');

  // Half a position is not worth preselecting. This differs on purpose from
  // the logger's URL parsing, which keeps a valid band even when the mode is
  // junk — there the two are independent requests, here they are one fact.
  eq(validPosition({ band: '20m' }, 'FD'), null, 'a band with no mode is not a position');
  eq(validPosition({ mode: 'CW' }, 'FD'), null, 'a mode with no band is not a position');

  eq(validPosition({ band: '99m', mode: 'CW' }, 'FD'), null, 'a band that does not exist');
  eq(validPosition({ band: '20m', mode: 'XX' }, 'FD'), null, 'a mode that does not exist');
  eq(validPosition({ band: 20, mode: 'CW' }, 'FD'), null, 'a band that is not a string');

  const good = validPosition({ band: '40m', mode: 'CW' }, 'FD');
  eq(good && good.band, '40m', 'a good position comes back');
  eq(good && good.mode, 'CW', 'with its mode');

  // The band list is per event type, and the WARC bands score nothing in
  // either contest. A memory from a special event must not survive into one.
  eq(validPosition({ band: '30m', mode: 'CW' }, 'SES') !== null, true,
     'a special event remembers 30m');
  eq(validPosition({ band: '30m', mode: 'CW' }, 'FD'), null,
     'but Field Day does not offer it, so the memory is dropped');
  eq(validPosition({ band: '30m', mode: 'CW' }, 'WFD'), null,
     'nor does Winter Field Day');
}

// ── what to suggest ─────────────────────────────────────────────────────────
console.log('\n── choosing a suggestion ──');
{
  // Nothing known: the operator picks for themselves, exactly as before.
  eq(suggestPosition(boardFor('FD'), null), null, 'no claim and no memory suggests nothing');

  // A memory alone.
  const s1 = suggestPosition(boardFor('FD'), { band: '40m', mode: 'CW' });
  eq(s1 && s1.band, '40m', 'a remembered band is suggested');
  eq(s1 && s1.mode, 'CW', 'with its mode');
  eq(s1 && s1.reason, 'last', 'and says it came from the memory');

  // A memory for a slot this event does not have must not be suggested — the
  // picker would highlight a button that is not on screen.
  eq(suggestPosition(boardFor('FD'), { band: '30m', mode: 'CW' }), null,
     'a remembered band the event does not offer suggests nothing');

  // A claim of your own outranks the memory.
  const mine = [claim({ band: '15m', mode: 'PH', station_number: 2 })];
  const s2 = suggestPosition(boardFor('FD', mine, [], { myStation: 2, isSes: false }),
                             { band: '40m', mode: 'CW' });
  eq(s2 && s2.band, '15m', 'a slot you hold beats the remembered one');
  eq(s2 && s2.reason, 'held', 'and says so');

  // Somebody else's claim is not a suggestion — that is the band to avoid.
  const theirs = [claim({ band: '15m', mode: 'PH', station_number: 3 })];
  eq(suggestPosition(boardFor('FD', theirs, [], { myStation: 2, isSes: false }), null), null,
     "another station's claim is not suggested");

  // Nor does a memory of it survive somebody else booking it since. The
  // operator can still pick it — a contact that happened has to be logged —
  // but a preselection is a nudge, and it must not nudge into a collision.
  eq(suggestPosition(boardFor('FD', theirs, [], { myStation: 2, isSes: false }),
                     { band: '15m', mode: 'PH' }), null,
     'a remembered band somebody else has booked is dropped');

  // Presence is different: a slot reads as busy from the operator's own row
  // left behind by a previous window as readily as from anyone else's, so
  // suppressing the memory there would break signing back in where you were.
  const busyHere = [{ op_call: 'W0AAA', station: 2, band: '15m', mode: 'PH' }];
  const sBusy = suggestPosition(boardFor('FD', [], busyHere, { myStation: 2, isSes: false }),
                                { band: '15m', mode: 'PH' });
  eq(sBusy && sBusy.band, '15m', 'but a remembered band that is merely busy is still offered');
  eq(sBusy && sBusy.reason, 'last', 'as a memory');

  // Neither is somebody merely being on air there.
  const busy = [{ op_call: 'W0BBB', station: 3, band: '15m', mode: 'PH' }];
  eq(suggestPosition(boardFor('FD', [], busy, { myStation: 2, isSes: false }), null), null,
     'somebody on air without a claim is not suggested');

  // Attribution follows the event type, the same split checkSlot uses: a
  // contest claim belongs to a station, a special event claim to an operator.
  // Get this wrong and the picker suggests a band held by somebody else.
  const sesClaim = [claim({ band: '80m', mode: 'DIG', op_call: 'W0AAA', station_number: null })];
  const sesMine = suggestPosition(
    boardFor('SES', sesClaim, [], { myCall: 'W0AAA', myStation: null, isSes: true }), null);
  eq(sesMine && sesMine.band, '80m', 'your own special event claim is suggested');
  eq(suggestPosition(
       boardFor('SES', sesClaim, [], { myCall: 'W0ZZZ', myStation: null, isSes: true }), null), null,
     "but not somebody else's");

  // An expired or released claim is not a claim, so it must not pull an
  // operator back onto a band their shift ended on.
  const over = [claim({ band: '15m', mode: 'PH', station_number: 2, ends_at: at(-1) })];
  eq(suggestPosition(boardFor('FD', over, [], { myStation: 2, isSes: false }), null), null,
     'an expired claim of yours suggests nothing');
  const released = [claim({ band: '15m', mode: 'PH', station_number: 2, status: 'RELEASED' })];
  eq(suggestPosition(boardFor('FD', released, [], { myStation: 2, isSes: false }), null), null,
     'nor does a released one');

  // Holding two slots has to give one deterministic answer, or the highlight
  // moves under the operator between renders.
  const two = [
    claim({ band: '10m', mode: 'CW', station_number: 2 }),
    claim({ band: '80m', mode: 'PH', station_number: 2 }),
  ];
  const b = boardFor('FD', two, [], { myStation: 2, isSes: false });
  const first = suggestPosition(b, null);
  eq(first.band, suggestPosition(b, null).band, 'two claims give a stable answer');
  eq(['10m', '80m'].includes(first.band), true, 'and it is one of the two held');
}

console.log(failures === 0 ? '\nAll last-position tests passed.' : `\n${failures} failure(s).`);
ts.cleanup();
process.exit(failures === 0 ? 0 : 1);
