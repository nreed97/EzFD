#!/usr/bin/env node
// Unit tests for lib/adif.ts — ADIF parsing and export.
//
// ADIF is how a log leaves this app for LoTW, eQSL and every other logger, and
// how an operator who logged offline in N1MM merges back in. It was covered
// only by substring assertions in the end-to-end suite, which need a database
// and a server and can't reach the shapes that actually go wrong.
//
// The first case below is the one AGENTS.md leads with: `pg` hands back
// TIMESTAMPTZ as a JS Date, not a string, so every date path has to accept
// both. A route that formats a Date correctly and a string incorrectly (or the
// reverse) still passes an end-to-end test, because only one shape ever
// reaches it there.

const { compile } = require('./_compile-ts.cjs');
const ts = compile(['lib/adif.ts']);
const { adifModeToEzfd, parseAdif, generateADIF } = ts.load('adif');

let failures = 0;
const ok = m => console.log(`ok    ${m}`);
const no = (m, d) => { failures++; console.log(`FAIL  ${m}${d ? `  ${d}` : ''}`); };
const eq = (a, e, m) => a === e ? ok(m) : no(m, `got ${JSON.stringify(a)}, expected ${JSON.stringify(e)}`);
const has = (hay, needle, m) => hay.includes(needle) ? ok(m) : no(m, `missing ${JSON.stringify(needle)}`);
const lacks = (hay, needle, m) => !hay.includes(needle) ? ok(m) : no(m, `unexpectedly present: ${JSON.stringify(needle)}`);

const evt = (over = {}) => ({
  club_call: 'W0EZ', club_name: 'Test Club', event_type: 'FD',
  class: '3A', arrl_section: 'MN', power: 'LOW', bonuses: {}, ...over,
});
const qso = (over = {}) => ({
  callsign: 'K1ABC', band: '20m', mode: 'PH', datetime_utc: '2026-06-27T18:04:11.000Z',
  rcvd_class: '2A', rcvd_section: 'EPA', is_dupe: false, operator_call: 'W0AAA', ...over,
});

// ── mode mapping ────────────────────────────────────────────────────────
console.log('\n── mode mapping ──');
eq(adifModeToEzfd('CW'), 'CW', 'CW maps to CW');
for (const m of ['SSB', 'USB', 'LSB', 'FM', 'AM', 'PH']) {
  eq(adifModeToEzfd(m), 'PH', `${m} maps to PH`);
}
for (const m of ['FT8', 'FT4', 'RTTY', 'PSK31', 'JS8', 'MSK144']) {
  eq(adifModeToEzfd(m), 'DIG', `${m} maps to DIG`);
}
eq(adifModeToEzfd('  ssb  '), 'PH', 'mode matching is case- and space-insensitive');

// ── TIMESTAMPTZ arrives as a Date, not a string ─────────────────────────
console.log('\n── the pg Date-vs-string shape ──');
{
  const iso = '2026-06-27T18:04:11.000Z';
  const asString = generateADIF(evt(), [qso({ datetime_utc: iso })]);
  const asDate   = generateADIF(evt(), [qso({ datetime_utc: new Date(iso) })]);
  eq(asDate, asString, 'a Date and its ISO string produce byte-identical ADIF');
  has(asString, '<QSO_DATE:8>20260627', 'QSO_DATE is the ADIF yyyymmdd form');
  has(asString, '<TIME_ON:4>1804', 'TIME_ON is hhmm');
}

// ── parseAdif ───────────────────────────────────────────────────────────
console.log('\n── parseAdif ──');
{
  const text = [
    'Some header text that must be ignored <CALL:5>NOPE0',
    '<EOH>',
    '<CALL:5>K1ABC<BAND:3>20m<MODE:3>SSB<CLASS:2>2A<ARRL_SECT:3>EPA<QSO_DATE:8>20260627<TIME_ON:6>180411<EOR>',
    '<CALL:5>K2DEF<FREQ:6>14.030<MODE:2>CW<SRX_STRING:6>1A MDC<EOR>',
    '<BAND:3>40m<MODE:3>SSB<EOR>',
  ].join('\n');
  const recs = parseAdif(text);
  eq(recs.length, 2, 'header is skipped and a record without CALL is dropped');
  eq(recs[0].callsign, 'K1ABC', 'callsign parsed');
  eq(recs[0].band, '20m', 'band from the BAND field');
  eq(recs[0].mode, 'PH', 'mode mapped through adifModeToEzfd');
  eq(recs[0].rcvd_class, '2A', 'class from the CLASS field');
  eq(recs[0].rcvd_section, 'EPA', 'section from ARRL_SECT');
  eq(recs[0].datetime_utc, '2026-06-27T18:04:11Z', 'datetime assembled from QSO_DATE and TIME_ON');
  eq(recs[1].band, '20m', 'band falls back to FREQ in MHz when BAND is absent');
  eq(recs[1].rcvd_class, '1A', 'class falls back to SRX_STRING');
  eq(recs[1].rcvd_section, 'MDC', 'section falls back to SRX_STRING');
}
{
  // Length-prefixed values are authoritative — a value containing '<' or a
  // stray delimiter must still be read by its declared length.
  const recs = parseAdif('<EOH>\n<CALL:5>K1ABC<COMMENT:7>a<b>c d<BAND:3>20m<EOR>');
  eq(recs[0].callsign, 'K1ABC', 'a value containing < does not derail the parser');
  eq(recs[0].band, '20m', 'the field after an awkward value still parses');
}
{
  const recs = parseAdif('<EOH>\n<CALL:5>K1ABC<BAND:3>20m<MODE:3>SSB<STATE:2>MN<EOR>');
  eq(recs[0].rcvd_section, 'MN', 'STATE is accepted as a section fallback');
}
{
  // QSO_DATE_OFF/TIME_OFF win over the ON pair.
  const recs = parseAdif(
    '<EOH>\n<CALL:5>K1ABC<BAND:3>20m<QSO_DATE:8>20260627<TIME_ON:6>180411' +
    '<QSO_DATE_OFF:8>20260628<TIME_OFF:6>190000<EOR>');
  eq(recs[0].datetime_utc, '2026-06-28T19:00:00Z', 'the OFF time is preferred over ON');
}
{
  const recs = parseAdif('<EOH>\n<CALL:5>K1ABC<BAND:3>20m<QSO_DATE:8>notadate<TIME_ON:4>2500<EOR>');
  eq(recs[0].datetime_utc, undefined, 'an unparseable date is left undefined rather than invented');
}

// ── generateADIF: identity fields ───────────────────────────────────────
console.log('\n── generateADIF ──');
{
  const out = generateADIF(evt(), [qso(), qso({ callsign: 'K9DUP', is_dupe: true })]);
  has(out, '<EOH>', 'a header is emitted');
  has(out, '<CALL:5>K1ABC', 'the contact is exported');
  lacks(out, 'K9DUP', 'a dupe is excluded from the export');
  has(out, '<STATION_CALLSIGN:4>W0EZ', 'STATION_CALLSIGN is the club/event call');
  has(out, '<OPERATOR:5>W0AAA', 'OPERATOR is the individual at the key');
}
{
  // MY_* come from the per-operator roster, never from the event.
  const locs = {
    W0AAA: { grid: 'EN34', state: 'MN', county: 'Hennepin' },
    W0BBB: { grid: 'EM48', state: 'MO' },
  };
  const out = generateADIF(evt({ location: 'Club Field' }), [
    qso({ operator_call: 'W0AAA' }),
    qso({ callsign: 'K2XYZ', operator_call: 'W0BBB' }),
    qso({ callsign: 'K3XYZ', operator_call: 'W0CCC' }),
  ], locs);
  has(out, '<MY_GRIDSQUARE:4>EN34', "the first operator's own grid is used");
  has(out, '<MY_GRIDSQUARE:4>EM48', "the second operator's own grid is used");
  has(out, '<MY_CNTY:8>Hennepin', 'county is exported when the roster has it');
  const thirdRecord = out.split('\n').find(l => l.includes('K3XYZ'));
  lacks(thirdRecord, 'MY_GRIDSQUARE', 'an operator missing from the roster gets no MY_* rather than a wrong one');
  lacks(out, 'Club Field', "the event's own location never becomes a MY_ field");
}
{
  // adif_mode carries the real submode; the PH/CW/DIG bucket is for scoring.
  const rtty = generateADIF(evt(), [qso({ mode: 'DIG', adif_mode: 'RTTY' })]);
  has(rtty, '<MODE:4>RTTY', 'adif_mode is preferred when present');
  // Without it the DIG bucket falls back to FT8, the commonest FD digital mode.
  const plain = generateADIF(evt(), [qso({ mode: 'DIG' })]);
  has(plain, '<MODE:3>FT8', 'a bare DIG QSO falls back to FT8');
  lacks(plain, 'RTTY', 'and does not carry a submode it was never given');
}
{
  const out = generateADIF(evt(), [qso({ freq_khz: 14030 })]);
  has(out, '<FREQ:7>14.0300', 'a logged frequency wins over the band default');
}

// ── SES vs contest ──────────────────────────────────────────────────────
console.log('\n── SES has no contest exchange ──');
{
  const ses = generateADIF(
    evt({ event_type: 'SES', class: null, arrl_section: 'MN' }),
    [qso({ rcvd_class: null, rst_sent: '59', rst_rcvd: '57', rcvd_name: 'Dave' })],
  );
  lacks(ses, 'STX_STRING', 'no sent exchange on an SES');
  lacks(ses, 'SRX_STRING', 'no received exchange on an SES');
  has(ses, '<MY_ARRL_SECT:2>MN', 'but the optional SES section is still exported');
  has(ses, '<RST_SENT:2>59', 'signal reports are exported');
  has(ses, '<NAME:4>Dave', 'the name is exported');

  const fd = generateADIF(evt(), [qso()]);
  has(fd, '<STX_STRING:5>3A MN', 'a contest event carries the sent exchange');
  has(fd, '<SRX_STRING:6>2A EPA', 'and the received exchange');
}
{
  // The event type is what suppresses the exchange, not merely the class
  // being NULL. Real SES rows do have a NULL class — the insert path forces
  // it — so a fixture relying on that can't tell the two apart. Give the SES
  // a stray class (imported data, or an upstream bug) and the export must
  // still refuse to emit a contest exchange for it.
  const strays = generateADIF(
    evt({ event_type: 'SES', class: '3A', arrl_section: 'MN' }),
    [qso({ rcvd_class: '2A', rcvd_section: 'EPA' })],
  );
  lacks(strays, 'SRX_STRING', 'a stray class on an SES is still not exported as an exchange');
  lacks(strays, 'STX_STRING', 'and neither is a stray event class');
  has(strays, '<ARRL_SECT:3>EPA', 'though the section itself is still recorded');
}
{
  // events.class and arrl_section are NULL for every SES row.
  const out = generateADIF(evt({ event_type: 'SES', class: null, arrl_section: null }),
                           [qso({ rcvd_class: null, rcvd_section: null })]);
  ok('a fully null SES event exports without throwing');
  lacks(out, 'null', 'and never writes the string "null" into a field');
}

// ── field length prefixes ───────────────────────────────────────────────
console.log('\n── field encoding ──');
{
  const out = generateADIF(evt(), [qso({ callsign: 'DL1ABC/P' })]);
  has(out, '<CALL:8>DL1ABC/P', 'the length prefix matches the value length');
}

ts.cleanup();
console.log('');
if (failures) { console.log(`${failures} ADIF check(s) failed`); process.exit(1); }
console.log('All ADIF tests passed.');
