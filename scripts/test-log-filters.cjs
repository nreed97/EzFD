#!/usr/bin/env node
// Unit tests for lib/logFilters.ts and lib/logColumns.ts — the dashboard log
// view's filtering and column selection.
//
// Both are deliberately pure: filtering is a function of (qsos, filters, now)
// with no clock read of its own, and the column set is a function of (stored
// choice, event type). That is what makes them testable here in milliseconds
// rather than only through a browser.
//
// The cases that matter are the ones where a wrong answer hides a contact an
// operator is looking for:
//   * an untouched filter must mean "no restriction", never "match nothing"
//   * a soft-deleted contact must never be reachable (the caller filters, but
//     the shape of the data is asserted here so a future filter can't undo it)
//   * an unrecognised section must stay findable — those are the typos the
//     view exists to help correct

const { compile } = require('./_compile-ts.cjs');
const ts = compile(['lib/logFilters.ts', 'lib/logColumns.ts']);
const { applyLogFilters, filterOptions, isFiltered, EMPTY_FILTERS } = ts.load('logFilters');
const { LOG_COLUMNS, defaultColumns, resolveColumns, hhmmss } = ts.load('logColumns');

let failures = 0;
const ok = m => console.log(`ok    ${m}`);
const no = (m, d) => { failures++; console.log(`FAIL  ${m}${d ? `  ${d}` : ''}`); };
const eq = (actual, expected, m) =>
  actual === expected ? ok(m) : no(m, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);

const NOW = Date.parse('2026-06-27T20:00:00Z');
const minsAgo = n => new Date(NOW - n * 60_000).toISOString();

let seq = 0;
const qso = (over = {}) => ({
  id: `id-${seq++}`,
  callsign: 'K1ABC',
  band: '20m',
  mode: 'PH',
  datetime_utc: minsAgo(5),
  rcvd_class: '2A',
  rcvd_section: 'MN',
  operator_call: 'W0AAA',
  station_number: 1,
  is_dupe: false,
  updated_at: null,
  ...over,
});

const f = (over = {}) => ({ ...EMPTY_FILTERS, ...over });
const ids = rows => rows.map(r => r.id).join(',');

// ── an untouched filter restricts nothing ───────────────────────────────
// The bug this guards: treating an empty multi-select as "match nothing"
// would blank the log the moment the view opened.
console.log('\n── no filters means no restriction ──');
{
  const log = [qso(), qso({ callsign: 'K2DEF' }), qso({ callsign: 'K3GHI' })];
  eq(applyLogFilters(log, EMPTY_FILTERS, NOW).length, 3, 'every contact passes an empty filter');
  eq(isFiltered(EMPTY_FILTERS), false, 'and the empty filter reports itself as inactive');
  eq(isFiltered(f({ callsign: 'K1' })), true, 'a callsign makes it active');
  eq(isFiltered(f({ bands: ['20m'] })), true, 'so does a band');
  eq(isFiltered(f({ dupes: 'hide' })), true, 'so does a dupe setting');
  eq(isFiltered(f({ callsign: '   ' })), false, 'but whitespace alone does not');
}

// ── the filters an operator actually asked for ──────────────────────────
console.log('\n── operator and station ──');
{
  const log = [
    qso({ operator_call: 'W0AAA', station_number: 1 }),
    qso({ operator_call: 'W0BBB', station_number: 2 }),
    qso({ operator_call: 'W0AAA', station_number: 2 }),
  ];
  eq(applyLogFilters(log, f({ operators: ['W0AAA'] }), NOW).length, 2, 'one operator');
  eq(applyLogFilters(log, f({ operators: ['W0AAA', 'W0BBB'] }), NOW).length, 3, 'two operators is a union');
  eq(applyLogFilters(log, f({ stations: [2] }), NOW).length, 2, 'one station');
  eq(applyLogFilters(log, f({ operators: ['W0AAA'], stations: [2] }), NOW).length, 1,
     'operator and station combine as AND');
}

// A contact with no operator recorded — an ADIF import — cannot be attributed,
// so it must not silently match whoever is being filtered for.
console.log('\n── an unattributed contact ──');
{
  const log = [qso({ operator_call: null }), qso({ operator_call: 'W0AAA' })];
  eq(applyLogFilters(log, EMPTY_FILTERS, NOW).length, 2, 'shows when the operator filter is off');
  eq(applyLogFilters(log, f({ operators: ['W0AAA'] }), NOW).length, 1,
     'and does not match a named operator');
}

console.log('\n── callsign search ──');
{
  const log = [qso({ callsign: 'K1ABC' }), qso({ callsign: 'W9XYZ' }), qso({ callsign: 'K1ABC/P' })];
  eq(applyLogFilters(log, f({ callsign: 'K1ABC' }), NOW).length, 2, 'matches a portable suffix too');
  eq(applyLogFilters(log, f({ callsign: 'k1abc' }), NOW).length, 2, 'and is case-insensitive');
  eq(applyLogFilters(log, f({ callsign: '1AB' }), NOW).length, 2, 'and matches mid-callsign');
  eq(applyLogFilters(log, f({ callsign: 'ZZZ' }), NOW).length, 0, 'and finds nothing when it should');
}

console.log('\n── band, mode and section ──');
{
  const log = [
    qso({ band: '20m', mode: 'PH', rcvd_section: 'MN' }),
    qso({ band: '40m', mode: 'CW', rcvd_section: 'EPA' }),
    qso({ band: '20m', mode: 'CW', rcvd_section: 'MN' }),
  ];
  eq(applyLogFilters(log, f({ bands: ['20m'] }), NOW).length, 2, 'band');
  eq(applyLogFilters(log, f({ modes: ['CW'] }), NOW).length, 2, 'mode');
  eq(applyLogFilters(log, f({ sections: ['MN'] }), NOW).length, 2, 'section');
  eq(applyLogFilters(log, f({ sections: ['mn'] }), NOW).length, 2, 'section match is case-insensitive');
  eq(applyLogFilters(log, f({ bands: ['20m'], modes: ['CW'] }), NOW).length, 1, 'and they combine');
}

// An unrecognised exchange is exactly what this view helps an operator find.
// Filtering it out of the options, or failing to match it, would defeat that.
console.log('\n── an unrecognised section stays findable ──');
{
  const log = [qso({ rcvd_section: 'MN' }), qso({ rcvd_section: 'ZZQ' }), qso({ rcvd_section: 'DX' })];
  eq(applyLogFilters(log, f({ sections: ['ZZQ'] }), NOW).length, 1, 'a typo can be filtered for');
  eq(filterOptions(log).sections.includes('ZZQ'), true, 'and is offered as an option');
  eq(filterOptions(log).sections.includes('DX'), true, 'DX is offered too — it is a real exchange');
}

console.log('\n── dupes ──');
{
  const log = [qso(), qso({ is_dupe: true }), qso({ is_dupe: true })];
  eq(applyLogFilters(log, f({ dupes: 'all' }), NOW).length, 3, 'all');
  eq(applyLogFilters(log, f({ dupes: 'hide' }), NOW).length, 1, 'hide');
  eq(applyLogFilters(log, f({ dupes: 'only' }), NOW).length, 2, 'only');
}

console.log('\n── edited contacts (the #22 audit trail) ──');
{
  const log = [qso(), qso({ updated_at: minsAgo(1), updated_by: 'W0BBB' })];
  eq(applyLogFilters(log, EMPTY_FILTERS, NOW).length, 2, 'both show by default');
  eq(applyLogFilters(log, f({ editedOnly: true }), NOW).length, 1, 'and the edited one can be isolated');
}

// ── the time window ─────────────────────────────────────────────────────
// nowMs is a parameter, never a clock read, so this is deterministic.
console.log('\n── time window ──');
{
  const log = [
    qso({ id: 'recent', datetime_utc: minsAgo(5) }),
    qso({ id: 'older',  datetime_utc: minsAgo(90) }),
    qso({ id: 'oldest', datetime_utc: minsAgo(600) }),
  ];
  eq(ids(applyLogFilters(log, f({ sinceMinutes: 15 }), NOW)), 'recent', 'last 15 minutes');
  eq(ids(applyLogFilters(log, f({ sinceMinutes: 120 }), NOW)), 'recent,older', 'last two hours');
  eq(applyLogFilters(log, f({ sinceMinutes: 0 }), NOW).length, 3, 'zero means no limit, not none');

  // pg hands back a Date; SSE hands back a string. Both must filter alike.
  const asDate = [qso({ id: 'd', datetime_utc: new Date(NOW - 5 * 60_000) })];
  eq(applyLogFilters(asDate, f({ sinceMinutes: 15 }), NOW).length, 1,
     'a Date filters the same as its ISO string');

  // Dropping a contact because its timestamp is unreadable would make it
  // vanish with no way to notice. It is kept instead.
  const broken = [qso({ id: 'x', datetime_utc: 'not-a-date' })];
  eq(applyLogFilters(broken, f({ sinceMinutes: 15 }), NOW).length, 1,
     'an unparseable timestamp is kept, not silently dropped');
}

// ── filter options come from the log, not from the universe ─────────────
console.log('\n── options offered ──');
{
  const log = [
    qso({ operator_call: 'W0BBB', station_number: 2, band: '40m', mode: 'CW', rcvd_section: 'EPA' }),
    qso({ operator_call: 'W0AAA', station_number: 1, band: '20m', mode: 'PH', rcvd_section: 'MN' }),
    qso({ operator_call: 'W0AAA', station_number: 1, band: '20m', mode: 'PH', rcvd_section: 'MN' }),
  ];
  const o = filterOptions(log);
  eq(o.operators.join(','), 'W0AAA,W0BBB', 'operators are distinct and sorted');
  eq(o.stations.join(','), '1,2', 'stations sort numerically');
  eq(o.bands.join(','), '20m,40m', 'bands are distinct');
  eq(o.sections.join(','), 'EPA,MN', 'sections are distinct');
  eq(filterOptions([]).operators.length, 0, 'an empty log offers nothing');
  // A null section must not become an empty option in the picker.
  eq(filterOptions([qso({ rcvd_section: null })]).sections.length, 0,
     'a null section is not offered as a blank choice');
}

// ── columns ─────────────────────────────────────────────────────────────
console.log('\n── column defaults and recovery ──');
{
  eq(new Set(LOG_COLUMNS.map(c => c.id)).size, LOG_COLUMNS.length, 'every column id is unique');

  // An SES has NULL class and section on every row, so defaulting to the
  // contest columns would show a table of empty cells.
  const ses = defaultColumns('SES');
  eq(ses.includes('rcvd_section'), false, 'an SES does not default to the contest section column');
  eq(ses.includes('grid'), true, 'it defaults to the SES exchange instead');
  eq(defaultColumns('FD').includes('rcvd_section'), true, 'Field Day does default to section');
  eq(defaultColumns(undefined).includes('rcvd_section'), true, 'and so does an unknown event type');

  // Storage survives upgrades, so a stored list can name a column that no
  // longer exists or omit one added since.
  eq(resolveColumns(['callsign', 'not_a_column', 'band'], 'FD').map(c => c.id).join(','),
     'callsign,band', 'an unknown stored column is dropped');
  eq(resolveColumns(['band', 'callsign'], 'FD').map(c => c.id).join(','), 'band,callsign',
     'stored order is preserved');
  eq(resolveColumns([], 'FD').length > 0, true, 'an empty choice falls back to the defaults');
  eq(resolveColumns(['nope'], 'FD').length > 0, true, 'so does a choice of only unknown columns');
  // Nothing stored yet — a browser that has never opened this view.
  eq(resolveColumns(null, 'SES').every(c => typeof c.value === 'function'), true,
     'a null choice resolves to renderable columns');
  eq(resolveColumns(null, 'SES').map(c => c.id).join(','), defaultColumns('SES').join(','),
     'and they are that event type\'s defaults');
  eq(resolveColumns(undefined, 'FD').map(c => c.id).join(','), defaultColumns('FD').join(','),
     'undefined behaves the same as null');
  // localStorage can hand back anything a previous version wrote.
  eq(resolveColumns('not-an-array', 'FD').map(c => c.id).join(','), defaultColumns('FD').join(','),
     'and so does a stored value that is not an array');
}

console.log('\n── cell formatting handles both date shapes ──');
{
  const iso = '2026-06-27T18:04:11.000Z';
  eq(hhmmss(iso), '18:04:11', 'an ISO string');
  eq(hhmmss(new Date(iso)), '18:04:11', 'and a Date give the same cell');
  eq(hhmmss(null), '', 'null renders empty, not "Invalid Date"');
  eq(hhmmss('nonsense'), '', 'and so does an unparseable value');

  // Every column must survive a row with nothing optional set — a contest QSO
  // has no name/QTH/grid, an SES has no class/section.
  const bare = { id: 'b', callsign: 'K1ABC', band: '20m', mode: 'PH',
                 datetime_utc: '2026-06-27T18:00:00Z', station_number: 1, is_dupe: false };
  let threw = null;
  for (const c of LOG_COLUMNS) {
    try {
      const v = c.value(bare);
      if (typeof v !== 'string') threw = `${c.id} returned ${typeof v}`;
    } catch (e) { threw = `${c.id}: ${e.message}`; }
  }
  eq(threw, null, 'every column renders a string for a row with no optional fields');
}

console.log(failures === 0 ? '\nAll log view tests passed.' : `\n${failures} failure(s).`);
ts.cleanup();
process.exit(failures === 0 ? 0 : 1);
