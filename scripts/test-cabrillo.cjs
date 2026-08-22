#!/usr/bin/env node
// Unit tests for lib/cabrillo.ts — the ARRL contest submission format.
//
// This file produces the document a club actually sends to the ARRL, and it
// has been wrong twice:
//
//   #12  CLAIMED-SCORE was recomputed locally, multiplying QSO points by the
//        section count and dropping bonuses, so the submitted header
//        disagreed with the app's own dashboard.
//   #16  station_number was hardcoded, so every QSO in a multi-transmitter
//        log claimed transmitter 0.
//
// Both were header/field-level mistakes that an end-to-end substring check
// wouldn't notice, which is what these assertions are for.

const { compile } = require('./_compile-ts.cjs');
const ts = compile(['lib/cabrillo.ts']);
const { generateCabrillo } = ts.load('cabrillo');
const { calculateScore } = ts.load('scoring');

let failures = 0;
const ok = m => console.log(`ok    ${m}`);
const no = (m, d) => { failures++; console.log(`FAIL  ${m}${d ? `  ${d}` : ''}`); };
const eq = (a, e, m) => a === e ? ok(m) : no(m, `got ${JSON.stringify(a)}, expected ${JSON.stringify(e)}`);
const has = (hay, needle, m) => hay.includes(needle) ? ok(m) : no(m, `missing ${JSON.stringify(needle)}`);

const evt = (over = {}) => ({
  club_call: 'W0EZ', club_name: 'Test Club', event_type: 'FD',
  class: '3A', arrl_section: 'MN', power: 'LOW', bonuses: {}, ...over,
});
const qso = (over = {}) => ({
  callsign: 'K1ABC', band: '20m', mode: 'PH', datetime_utc: '2026-06-27T18:04:11.000Z',
  rcvd_class: '2A', rcvd_section: 'EPA', is_dupe: false, station_number: 1, ...over,
});
const headerValue = (out, key) =>
  (out.split('\n').find(l => l.startsWith(`${key}: `)) ?? '').slice(key.length + 2);
const qsoLines = out => out.split('\n').filter(l => l.startsWith('QSO: '));

// ── the pg Date-vs-string shape ─────────────────────────────────────────
console.log('\n── the pg Date-vs-string shape ──');
{
  const iso = '2026-06-27T18:04:11.000Z';
  const asString = generateCabrillo(evt(), [qso({ datetime_utc: iso })]);
  const asDate   = generateCabrillo(evt(), [qso({ datetime_utc: new Date(iso) })]);
  eq(asDate, asString, 'a Date and its ISO string produce byte-identical Cabrillo');
  has(asString, '2026-06-27 1804', 'the QSO line carries the Cabrillo date and time form');
}

// ── CLAIMED-SCORE agrees with the app (#12) ─────────────────────────────
console.log('\n── CLAIMED-SCORE (#12) ──');
{
  // 4 CW QSOs = 8 points, LOW power x2 = 16 base, in 4 sections.
  const secs = ['EPA', 'MDC', 'NNJ', 'WPA'];
  const qsos = secs.map(s => qso({ mode: 'CW', rcvd_section: s, callsign: `K1${s}` }));
  const e = evt({ power: 'LOW' });
  const out = generateCabrillo(e, qsos);
  const expected = calculateScore(qsos, e.bonuses, e.power).claimed_score;
  eq(headerValue(out, 'CLAIMED-SCORE'), String(expected), 'CLAIMED-SCORE is calculateScore()');
  eq(expected, 16, 'and is points x power, not points x sections');
}
{
  // Bonuses must reach the header — dropping them was half of #12.
  const e = evt({ bonuses: { emergency_power: true, w1aw_bulletin: true } });
  const qsos = [qso({ mode: 'CW' })];
  const out = generateCabrillo(e, qsos);
  const expected = calculateScore(qsos, e.bonuses, e.power).claimed_score;
  eq(headerValue(out, 'CLAIMED-SCORE'), String(expected), 'bonus points are included');
  eq(expected, 108, 'emergency power doubles the base and W1AW adds 100');
}

// ── transmitter numbering (#16) ─────────────────────────────────────────
console.log('\n── transmitter number (#16) ──');
{
  const out = generateCabrillo(evt({ class: '3A' }), [
    qso({ callsign: 'K1AAA', station_number: 1 }),
    qso({ callsign: 'K2BBB', station_number: 2 }),
    qso({ callsign: 'K3CCC', station_number: 3 }),
    qso({ callsign: 'K4DDD', station_number: null }),
  ]);
  const t = call => (qsoLines(out).find(l => l.includes(call)) ?? '').trim().split(/\s+/).pop();
  eq(t('K1AAA'), '0', 'station 1 is transmitter 0 (Cabrillo is 0-based)');
  eq(t('K2BBB'), '1', 'station 2 is transmitter 1');
  eq(t('K3CCC'), '2', 'station 3 is transmitter 2');
  eq(t('K4DDD'), '0', 'a null station number falls back to transmitter 0');
  eq(headerValue(out, 'CATEGORY-TRANSMITTER'), '3', 'CATEGORY-TRANSMITTER comes from the class');
}

// ── header ──────────────────────────────────────────────────────────────
console.log('\n── header ──');
{
  const out = generateCabrillo(evt(), [qso()]);
  has(out, 'START-OF-LOG: 3.0', 'declares the Cabrillo version');
  eq(headerValue(out, 'CALLSIGN'), 'W0EZ', 'CALLSIGN is the club call');
  eq(headerValue(out, 'CONTEST'), 'ARRL-FD', 'Field Day declares ARRL-FD');
  eq(headerValue(out, 'ARRL-SECTION'), 'MN', "ARRL-SECTION is the event's own section");
  eq(headerValue(out, 'CATEGORY-POWER'), 'LOW', 'power category is carried through');
  eq(headerValue(out, 'CLUB'), 'Test Club', 'club name is carried through');
  has(out, 'END-OF-LOG:', 'the log is terminated');
}
eq(headerValue(generateCabrillo(evt({ event_type: 'WFD' }), [qso()]), 'CONTEST'), 'WFD',
   'Winter Field Day declares WFD');

// ── QSO lines ───────────────────────────────────────────────────────────
console.log('\n── QSO lines ──');
{
  const out = generateCabrillo(evt(), [
    qso({ callsign: 'K9DUP', is_dupe: true }),
    qso({ callsign: 'K1ABC' }),
  ]);
  eq(qsoLines(out).length, 1, 'dupes are excluded from the submission');
  has(out, 'K1ABC', 'the valid contact is present');
}
{
  // Out-of-order input must come out chronological — log checking depends on it.
  const out = generateCabrillo(evt(), [
    qso({ callsign: 'K3LATE',  datetime_utc: '2026-06-27T20:00:00.000Z' }),
    qso({ callsign: 'K1EARLY', datetime_utc: '2026-06-27T18:00:00.000Z' }),
    qso({ callsign: 'K2MID',   datetime_utc: '2026-06-27T19:00:00.000Z' }),
  ]);
  const order = qsoLines(out).map(l => ['K1EARLY','K2MID','K3LATE'].find(c => l.includes(c)));
  eq(order.join(','), 'K1EARLY,K2MID,K3LATE', 'QSOs are sorted chronologically');
}
{
  const out = generateCabrillo(evt(), [qso({ mode: 'PH' }), qso({ mode: 'CW' }), qso({ mode: 'DIG' })]);
  const modes = qsoLines(out).map(l => l.trim().split(/\s+/)[2]);
  eq(modes.sort().join(','), 'CW,DG,PH', 'modes map to the Cabrillo PH/CW/DG set');
}
{
  const out = generateCabrillo(evt(), [qso({ rcvd_class: null, rcvd_section: null })]);
  has(out, '?', 'a missing exchange is marked rather than left blank');
}

// ── a mis-typed SES must not throw ──────────────────────────────────────
console.log('\n── null class/section ──');
{
  // The export route refuses Cabrillo for SES; these fallbacks exist so a
  // mis-typed event produces a file instead of a 500.
  const out = generateCabrillo(evt({ event_type: 'SES', class: null, arrl_section: null }), [qso()]);
  ok('a null class and section export without throwing');
  eq(headerValue(out, 'ARRL-SECTION'), '', 'a null section becomes empty, not the string "null"');
  eq(headerValue(out, 'CATEGORY-TRANSMITTER'), '1', 'a null class falls back to a single transmitter');
}

ts.cleanup();
console.log('');
if (failures) { console.log(`${failures} Cabrillo check(s) failed`); process.exit(1); }
console.log('All Cabrillo tests passed.');
