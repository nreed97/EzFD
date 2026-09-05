#!/usr/bin/env node
// Unit tests for lib/preflight.ts — the read of a log before it is submitted.
//
// Two things are being defended here.
//
// The first is that the report stays QUIET on a clean log. Every finding costs
// an operator attention at the moment they are trying to submit, and a report
// that cries wolf gets skimmed — which costs them the findings that matter.
// The deliberately-absent check is "this callsign is not in MASTER.SCP": that
// file is fetched best-effort, so an offline field server has an empty table
// and would flag the entire log, and it is built from contest logs while Field
// Day exists to bring out people who never enter contests. Absence from it is
// not evidence.
//
// The second is the class-eligibility column of rule 7.3, which the app has
// always let an operator tick past. Those values are transcribed in
// docs/rules-reference.md, and the last block reads them back out of it and
// fails if lib/bonuses.ts has drifted — AGENTS.md's rule is to check a value
// against that document, not against the code.

const { compile } = require('./_compile-ts.cjs');
const fs = require('fs');
const path = require('path');

const ts = compile(['lib/preflight.ts', 'lib/scoring.ts', 'lib/bonuses.ts']);
const { preflight, NOT_CHECKED } = ts.load('preflight');
const { calculateScore } = ts.load('scoring');
const { FD_BONUSES, ALL_CLASSES } = ts.load('bonuses');

let failures = 0;
const ok = m => console.log(`ok    ${m}`);
const no = (m, d) => { failures++; console.log(`FAIL  ${m}${d ? `  ${d}` : ''}`); };
const eq = (actual, expected, m) =>
  actual === expected ? ok(m) : no(m, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);

let n = 0;
const qso = (over = {}) => ({
  id: `q${n++}`, event_id: 'e', callsign: `W0AB${n}`, band: '20m', mode: 'PH',
  datetime_utc: '2026-06-27T18:00:00Z', sent_class: '3A', sent_section: 'MN',
  rcvd_class: '2A', rcvd_section: 'WI', operator_call: 'W0AAA', station_number: 1,
  is_dupe: false, is_gota: false, created_at: '2026-06-27T18:00:00Z',
  rst_sent: null, rst_rcvd: null, rcvd_name: null, rcvd_qth: null,
  rcvd_grid: null, comment: null, adif_mode: null, freq_khz: null, ...over,
});
const event = (over = {}) => ({
  id: 'e', join_code: 'AAAAAA', club_name: 'Test', club_call: 'W0T', event_year: 2026,
  event_type: 'FD', power: 'LOW', class: '3A', arrl_section: 'MN', location: null,
  gota_call: null, qrz_username: null, use_call_history: false,
  use_master_callsign_file: false, bonuses: {}, created_at: '', starts_at: null,
  ends_at: null, ses_description: null, ses_qsl_info: null, slot_enforcement: 'SOFT',
  slot_minutes: 120, dupe_rule: 'EVENT', require_operator_approval: false, ...over,
});
const run = (qsos, ev = event(), bonuses = {}) =>
  preflight(qsos, ev, calculateScore(qsos, bonuses, ev.power,
    { eventType: ev.event_type, entryClass: ev.class }), bonuses);

console.log('── a clean log says nothing ──');
{
  const clean = [qso(), qso({ band: '40m', mode: 'CW' }), qso({ rcvd_section: 'EPA' })];
  eq(run(clean).length, 0, 'no findings on a tidy Field Day log');

  // The check that is deliberately absent. These calls are perfectly good and
  // would not be in a contest-derived list.
  const obscure = [qso({ callsign: 'KD9XYZ' }), qso({ callsign: 'W0NEW' }), qso({ callsign: 'AG7GN' })];
  eq(run(obscure).length, 0, 'unfamiliar callsigns are not findings');
  eq(NOT_CHECKED.some(t => /Super Check Partial/.test(t)), true,
     'and the report says so rather than implying it checked');
}

console.log('\n── what the log contradicts ──');
{
  const conflict = [
    qso({ callsign: 'W1XYZ', rcvd_class: '2A', rcvd_section: 'EPA' }),
    qso({ callsign: 'W1XYZ', rcvd_class: '2A', rcvd_section: 'EMA', band: '40m' }),
  ];
  const f = run(conflict).find(x => x.id === 'exchange-conflict');
  eq(!!f, true, 'the same station sending two exchanges is reported');
  eq(f.examples[0].includes('W1XYZ'), true, 'naming the station');
  eq(f.examples[0].includes('EPA') && f.examples[0].includes('EMA'), true, 'and both exchanges');

  // The same station on two bands with the SAME exchange is normal.
  const fine = [
    qso({ callsign: 'W1XYZ', rcvd_section: 'EPA' }),
    qso({ callsign: 'W1XYZ', rcvd_section: 'EPA', band: '40m' }),
  ];
  eq(run(fine).length, 0, 'but working a station twice is not');
}

console.log('\n── shapes ──');
{
  const f = run([qso({ callsign: 'ABCDE' }), qso({ callsign: 'K1ABC' })])
    .find(x => x.id === 'callsign-shape');
  eq(!!f, true, 'a callsign with no digit is reported');
  eq(f.examples.includes('ABCDE'), true, 'by example');
  eq(f.examples.includes('K1ABC'), false, 'and a real one is left alone');

  eq(run([qso({ callsign: 'K1ABC/P' })]).length, 0, 'a portable suffix is fine');
  eq(run([qso({ callsign: 'VE3ABC' })]).length, 0, 'so is a two-letter prefix');

  const c = run([qso({ rcvd_class: '2Z' })]).find(x => x.id === 'class-shape');
  eq(!!c, true, 'a Field Day class outside A-F is reported');
  eq(run([qso({ rcvd_class: '12E' })]).length, 0, 'and a two-digit class is fine');

  // Winter Field Day has its own letters, including M for mobile.
  const wfdEv = event({ event_type: 'WFD', class: '1O' });
  eq(run([qso({ rcvd_class: '1M' })], wfdEv).length, 0, 'WFD accepts M for mobile');
  eq(!!run([qso({ rcvd_class: '2A' })], wfdEv).find(x => x.id === 'class-shape'), true,
     'but not a Field Day class letter');
}

console.log('\n── sections ──');
{
  const f = run([qso({ rcvd_section: 'ZZZ' })]).find(x => x.id === 'unknown-sections');
  eq(!!f, true, 'an unrecognised section is reported');
  eq(f.examples.includes('ZZZ'), true, 'by value');
  eq(run([qso({ rcvd_section: 'DX' })]).length, 0, 'DX is a legal exchange, not a mistake');
  const wfdEv = event({ event_type: 'WFD', class: '1O' });
  eq(run([qso({ rcvd_section: 'MX', rcvd_class: '1O' })], wfdEv).length, 0,
     'and MX is legal in Winter Field Day');
}

console.log('\n── bonus eligibility, rule 7.3 ──');
{
  // 7.3.17 is class A only. A 2F entry claiming it is claiming 100 points the
  // rule does not offer, and the app has always let the box be ticked.
  const f = run([qso()], event({ class: '2F' }), { safety_officer: true })
    .find(x => x.id === 'bonus-class-safety_officer');
  eq(!!f, true, 'a safety officer bonus on class F is reported');
  eq(f.title.includes('7.3.17'), true, 'citing the rule');
  eq(f.title.includes('class F'), true, 'and the class');

  eq(run([qso()], event({ class: '3A' }), { safety_officer: true }).length, 0,
     'and class A may claim it');

  // 7.3.18 is everything except A.
  eq(!!run([qso()], event({ class: '3A' }), { site_responsibilities: true })
        .find(x => x.id === 'bonus-class-site_responsibilities'), true,
     'site responsibilities is not for class A');
  eq(run([qso()], event({ class: '1D' }), { site_responsibilities: true }).length, 0,
     'but is for class D');

  // A bonus listed for every class never reports.
  eq(run([qso()], event({ class: '1D' }), { media_publicity: true }).length, 0,
     'a bonus open to all classes is never reported');
}

console.log('\n── claims the log can settle ──');
{
  const coach = run([qso()], event(), { gota_coach: true })
    .find(x => x.id === 'gota-coach-no-contacts');
  eq(!!coach, true, 'a GOTA coach with no GOTA contacts is reported');
  eq(run([qso({ is_gota: true })], event(), { gota_coach: true })
       .find(x => x.id === 'gota-coach-no-contacts'), undefined,
     'and not once GOTA contacts exist');

  const tx = run([qso({ station_number: 1 }), qso({ station_number: 2 })],
                 event({ class: '3A' }), { emergency_power: true })
    .find(x => x.id === 'transmitters-vs-log');
  eq(!!tx, true, 'a class claiming more transmitters than the log shows is reported');
  eq(tx.severity, 'check', 'as a check — a quiet transmitter is legitimate');
  eq(tx.detail.includes('300') && tx.detail.includes('200'), true,
     'saying what the difference is worth');
  eq(run([qso({ station_number: 1 }), qso({ station_number: 2 }), qso({ station_number: 3 })],
         event({ class: '3A' }), { emergency_power: true }).length, 0,
     'and silent when the log shows them all');
}

console.log('\n── Winter Field Day objectives multiply ──');
{
  const wfd = (over = {}) => event({ event_type: 'WFD', class: '1O', ...over });
  const onBand = (band, count) => Array.from({ length: count }, () => qso({ band, rcvd_class: '1O', rcvd_section: 'WI' }));
  const fiveBands = ['160m','80m','40m','20m','15m'].flatMap(b => onBand(b, 3));

  const f = run(fiveBands, wfd(), { wfd_six_bands: true }).find(x => x.id === 'wfd-wfd_six_bands');
  eq(!!f, true, 'six bands claimed on a five-band log is reported');
  eq(f.severity, 'fix', 'as a fix — the claimed score is wrong, not questionable');
  eq(f.detail.includes('OM 6'), true, 'saying what the objective is worth');
  eq(f.detail.includes('multiplies'), true, 'and that it multiplies rather than adds');

  const sixBands = [...fiveBands, ...onBand('10m', 3)];
  eq(run(sixBands, wfd(), { wfd_six_bands: true }).length, 0, 'and silent once six bands have three each');

  // Three contacts, not one: two on a band does not make the objective.
  const twoOnSixth = [...fiveBands, ...onBand('10m', 2)];
  eq(!!run(twoOnSixth, wfd(), { wfd_six_bands: true }).find(x => x.id === 'wfd-wfd_six_bands'), true,
     'two contacts on the sixth band is not three');

  const oneMode = run(onBand('20m', 3), wfd(), { wfd_multi_mode: true })
    .find(x => x.id === 'wfd-multi-mode');
  eq(!!oneMode, true, 'multiple modes claimed on a single-mode log is reported');
  const twoModes = [...onBand('20m', 2), qso({ band: '20m', mode: 'CW', rcvd_class: '1O', rcvd_section: 'WI' })];
  eq(run(twoModes, wfd(), { wfd_multi_mode: true }).length, 0, 'and silent with two modes');

  const sat = run(onBand('20m', 3), wfd(), { wfd_sat_fm: true }).find(x => x.id === 'wfd-wfd_sat_fm');
  eq(!!sat, true, 'a satellite objective with no SAT contact is reported');
  eq(run(onBand('SAT', 1), wfd(), { wfd_sat_fm: true }).length, 0, 'and silent with one');

  // Six continuous hours needs a judgement about what a break is, so only the
  // case the log flatly contradicts is reported.
  const short = [
    qso({ datetime_utc: '2026-01-24T18:00:00Z', rcvd_class: '1O', rcvd_section: 'WI' }),
    qso({ datetime_utc: '2026-01-24T20:00:00Z', rcvd_class: '1O', rcvd_section: 'WI', band: '40m' }),
  ];
  eq(!!run(short, wfd(), { wfd_six_hours: true }).find(x => x.id === 'wfd-six-hours'), true,
     'a two-hour log cannot contain six continuous hours');
  const long = [
    qso({ datetime_utc: '2026-01-24T18:00:00Z', rcvd_class: '1O', rcvd_section: 'WI' }),
    qso({ datetime_utc: '2026-01-25T02:00:00Z', rcvd_class: '1O', rcvd_section: 'WI', band: '40m' }),
  ];
  eq(run(long, wfd(), { wfd_six_hours: true }).length, 0, 'an eight-hour span is not contradicted');

  // WFD has no bonus points, so no eligibility finding can apply to it.
  eq(run(onBand('20m', 1), wfd(), { safety_officer: true }).length, 0,
     'a Field Day bonus ticked on a WFD entry reports nothing — WFD has no bonuses');
}

console.log('\n── ordering and dupes ──');
{
  const mixed = run(
    ['160m','80m','40m','20m','15m'].flatMap(b => Array.from({ length: 3 }, () =>
      qso({ band: b, rcvd_class: '1O', rcvd_section: 'ZZZ' }))),
    event({ event_type: 'WFD', class: '1O' }), { wfd_six_bands: true });
  eq(mixed[0].severity, 'fix', 'a fix is listed before a check');
  eq(mixed.some(f => f.severity === 'check'), true, 'with the checks after it');

  // A dupe is already out of the score, so it is not re-reported as a problem.
  eq(run([qso(), qso({ is_dupe: true, callsign: 'ZZZZZ' })]).length, 0,
     'a duplicate contact is not a finding');
  eq(NOT_CHECKED.some(t => /[Dd]uplicate/.test(t)), true, 'and the report says why');
}

console.log('\n── the class column matches docs/rules-reference.md ──');
{
  // AGENTS.md: check a rule value against the transcription, never against the
  // code. This reads the table back out and compares it row by row.
  const ref = fs.readFileSync(path.join(__dirname, '..', 'docs', 'rules-reference.md'), 'utf8');
  const rows = [...ref.matchAll(/^\|\s*(7\.3(?:\.\d+)*)\s*\|([^|]*)\|([^|]*)\|([^|]*)\|/gm)]
    .map(m => ({ rule: m[1], classes: m[4].replace(/\*\*/g, '').trim() }));
  eq(rows.length > 0, true, `found ${rows.length} bonus rows in the rules reference`);

  const parse = txt => txt.toLowerCase().startsWith('all')
    ? [...ALL_CLASSES]
    : (txt.match(/\b[A-F]\b/g) ?? []);

  let checked = 0, drifted = [];
  for (const row of rows) {
    const def = FD_BONUSES.find(d => d.rule === row.rule);
    if (!def) { drifted.push(`${row.rule}: no bonus in the table`); continue; }
    const want = parse(row.classes).sort().join(',');
    const got = [...def.classes].sort().join(',');
    if (want !== got) drifted.push(`${row.rule}: reference says ${want}, code says ${got}`);
    checked++;
  }
  eq(drifted.join(' | '), '', `all ${checked} class lists match the rules reference`);
  eq(checked, FD_BONUSES.length, 'and every bonus in the code appears in the reference');
}

console.log(failures === 0 ? '\nAll preflight tests passed.' : `\n${failures} failure(s).`);
ts.cleanup();
process.exit(failures === 0 ? 0 : 1);
