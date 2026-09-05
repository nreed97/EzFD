#!/usr/bin/env node
// Unit tests for lib/nav.ts — the menu behind the hamburger.
//
// This module exists because the logger kept two hand-written copies of its
// controls, one for the header and one for a mobile bar, and they drifted:
// Docs ended up reachable only on a phone, and Import ADIF, the exports, the
// second-radio window and the deleted-contacts list only at 768px and up.
// Nobody decided either of those. They were a `hidden sm:` that went one way
// in one copy and the other way in the other.
//
// So the assertions here are mostly structural, and they are the ones that
// would have caught that:
//
//   * an item is filtered on what the event and the hardware *are* — never on
//     screen width, which is not an input to this module at all;
//   * every action the table offers is wired up by the surface that offers it,
//     or the drawer would render an entry that does nothing;
//   * the components render the menu from here rather than growing a second
//     list of their own, which is checked by reading them back.

const fs = require('fs');
const path = require('path');
const { compile } = require('./_compile-ts.cjs');
const ts = compile(['lib/nav.ts']);
const { navItems, itemsByGroup, actionsFor, NAV_GROUPS } = ts.load('nav');

let failures = 0;
const ok = m => console.log(`ok    ${m}`);
const no = (m, d) => { failures++; console.log(`FAIL  ${m}${d ? `  ${d}` : ''}`); };
const eq = (a, e, m) =>
  a === e ? ok(m) : no(m, `got ${JSON.stringify(a)}, expected ${JSON.stringify(e)}`);
const deep = (a, e, m) =>
  JSON.stringify(a) === JSON.stringify(e) ? ok(m) : no(m, `got ${JSON.stringify(a)}, expected ${JSON.stringify(e)}`);
const truthy = (v, m) => (v ? ok(m) : no(m));

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

const base = { joinCode: 'ABC123', eventType: 'FD' };
const logger = (o = {}) => ({ surface: 'logger', ...base, stationNumber: 1, operatorCall: 'W0AAA', ...o });
const dash = (o = {}) => ({ surface: 'dashboard', ...base, ...o });
const ids = ctx => navItems(ctx).map(i => i.id);
const has = (ctx, id) => ids(ctx).includes(id);

console.log('\n-- every item is well formed --');
{
  const all = [logger(), logger({ rigConnected: true, canCw: true }), dash(), dash({ isVisitor: true }),
               logger({ eventType: 'SES' }), dash({ eventType: 'SES' }), dash({ eventType: 'WFD' })];
  let bad = 0;
  for (const ctx of all) {
    for (const item of navItems(ctx)) {
      if (!item.id || !item.label) { bad++; no('item has an id and a label', JSON.stringify(item)); }
      // The hint is what makes the drawer readable where the old header was
      // not: "ADIF" and "Backup" both looked like a download and nothing said
      // which was which.
      if (!item.hint) { bad++; no('item has a hint', item.id); }
      if (!NAV_GROUPS.includes(item.group)) { bad++; no('item is in a known group', `${item.id}: ${item.group}`); }
      const wired = (item.href ? 1 : 0) + (item.action ? 1 : 0);
      if (wired !== 1) { bad++; no('item is either a link or an action, not both or neither', item.id); }
    }
    const seen = ids(ctx);
    if (new Set(seen).size !== seen.length) { bad++; no('no duplicate ids', JSON.stringify(seen)); }
  }
  if (bad === 0) ok(`${all.length} contexts, every item well formed and uniquely identified`);
}

console.log('\n-- groups render in a fixed order, and empty ones are skipped --');
{
  const grouped = itemsByGroup(navItems(logger()));
  const order = grouped.map(g => g.group);
  const expected = NAV_GROUPS.filter(g => order.includes(g));
  deep(order, expected, 'groups come back in NAV_GROUPS order');
  truthy(grouped.every(g => g.items.length > 0), 'no group comes back empty');

  // A visitor loses the whole Export group, which must disappear rather than
  // render as a bare heading with nothing under it.
  const visitor = itemsByGroup(navItems(dash({ isVisitor: true })));
  truthy(!visitor.some(g => g.group === 'Export'), 'a visitor gets no empty Export heading');
}

console.log('\n-- filtering is on what the event is, never on screen width --');
{
  // The module takes no width, breakpoint or viewport input at all. This is
  // the structural version of "the exports must not be desktop-only".
  const src = read('lib/nav.ts');
  const widthWords = /\b(width|viewport|breakpoint|isMobile|isPhone|sm:|md:|lg:)\b/;
  truthy(!widthWords.test(src.replace(/^\s*\*.*$/gm, '')),
    'lib/nav.ts mentions no width, breakpoint or device in its logic');

  truthy(has(logger(), 'exportAdif'), 'the ADIF export is offered on the logger');
  truthy(has(dash(), 'exportAdif'), 'and on the dashboard');
  truthy(has(logger(), 'docs'), 'Guides are offered on the logger — they used to be phone-only');
  truthy(has(dash(), 'docs'), 'and on the dashboard');
  truthy(has(logger(), 'importAdif'), 'Import ADIF is offered — it used to be 768px and up');
  truthy(has(logger(), 'secondRadio'), 'so is the second radio window');
}

console.log('\n-- a special event has no contest submission --');
{
  truthy(!has(dash({ eventType: 'SES' }), 'exportCabrillo'), 'no Cabrillo on an SES');
  truthy(!has(logger({ eventType: 'SES' }), 'exportCabrillo'), 'on either surface');
  truthy(!has(dash({ eventType: 'SES' }), 'summary'), 'and no ARRL summary sheet');
  truthy(has(dash({ eventType: 'SES' }), 'exportAdif'), 'but the ADIF export stays — an SES still uploads');
  truthy(has(dash({ eventType: 'WFD' }), 'exportCabrillo'), 'Winter Field Day does submit Cabrillo');
  truthy(has(dash({ eventType: 'WFD' }), 'summary'), 'and has a summary sheet');
}

console.log('\n-- a visitor is read-only --');
{
  const v = dash({ isVisitor: true });
  // Only the things that hand over a *file*. A visitor already reads the whole
  // log in the Log view and the score on the scoreboard, so the line is not
  // "how much can they see" — it is "can they walk away with the event". The
  // summary sheet is on the visitor's side of that line: it prints aggregates
  // they are already looking at, and the exports do not.
  for (const id of ['exportAdif', 'exportCabrillo', 'exportBackup']) {
    truthy(!has(v, id), `a visitor is not offered ${id}`);
  }
  truthy(has(v, 'summary'), 'but the printable summary stays — it aggregates what is already on screen');
  truthy(has(v, 'docs'), 'but can still read the guides');
  truthy(has(v, 'theme'), 'and still switch the theme');
  // Leaving must not send them to the operator sign-in: that asks for a
  // callsign they never gave, and drops them into the logger when the browser
  // still holds a sign-in for the event.
  const leave = navItems(v).find(i => i.id === 'logger');
  eq(leave.href, '/', 'and leaving takes a visitor home, not to the sign-in');
  eq(navItems(dash()).find(i => i.id === 'logger').href, '/event/ABC123',
    'while an operator goes back to their event');
}

console.log('\n-- rig entries follow the hardware, not the layout --');
{
  truthy(!has(logger(), 'cwWindow'), 'no CW window without a rig');
  truthy(!has(logger(), 'rigDetails'), 'and no rig readout');
  truthy(!has(logger({ rigConnected: true }), 'cwWindow'),
    'a rig that cannot key CW is offered no CW window');
  truthy(has(logger({ rigConnected: true }), 'rigDetails'),
    'but its details are offered');
  truthy(has(logger({ rigConnected: true, canCw: true }), 'cwWindow'),
    'a CW-capable rig gets the keying window');
}

console.log('\n-- the second radio is named for the station it opens --');
{
  const at = n => navItems(logger({ stationNumber: n })).find(i => i.id === 'secondRadio').label;
  eq(at(1), 'Open station 2', 'station 1 offers station 2');
  eq(at(3), 'Open station 4', 'station 3 offers station 4');
}

console.log('\n-- every action a surface offers is wired up by that surface --');
{
  // The failure this prevents: an entry is added to the table, no component
  // handles it, and the drawer renders a menu item that silently does nothing.
  const SURFACES = [
    ['logger', 'components/LoggingClient.tsx',
      [logger(), logger({ rigConnected: true, canCw: true })]],
    ['dashboard', 'components/DashboardClient.tsx',
      [dash(), dash({ eventType: 'SES' }), dash({ isVisitor: true })]],
  ];
  for (const [name, file, contexts] of SURFACES) {
    const src = read(file);
    // The handler object literal passed to NavDrawer.
    const needed = new Set();
    for (const ctx of contexts) for (const a of actionsFor(ctx)) needed.add(a);
    const missing = [...needed].filter(a => !new RegExp(`\\b${a}\\s*[:,]`).test(src));
    if (missing.length === 0) ok(`${name} wires up all ${needed.size} of its actions`);
    else no(`${name} wires up all of its actions`, `missing: ${missing.join(', ')}`);
  }
}

console.log('\n-- the components render the menu from lib/nav.ts, not their own list --');
{
  for (const file of ['components/LoggingClient.tsx', 'components/DashboardClient.tsx']) {
    const src = read(file);
    truthy(src.includes('<NavDrawer'), `${path.basename(file)} renders the drawer`);
  }
  // The old header carried these as its own markup. If any comes back as a
  // hand-written control the menu already provides, the two can drift again.
  const RECLAIMED = [
    ['components/DashboardClient.tsx', /format=cabrillo/, 'Cabrillo link'],
    ['components/DashboardClient.tsx', /format=json/, 'Backup link'],
    ['components/DashboardClient.tsx', /<ThemeToggle/, 'theme toggle'],
    ['components/LoggingClient.tsx', /setShowAdifImport\(true\)}\s*\n?\s*className/, 'Import ADIF button'],
    ['components/LoggingClient.tsx', /<ThemeToggle/, 'theme toggle'],
    ['components/LoggingClient.tsx', /href="\/docs"/, 'Docs link'],
  ];
  let dupes = 0;
  for (const [file, pattern, what] of RECLAIMED) {
    if (pattern.test(read(file))) { dupes++; no(`${path.basename(file)} has no second ${what}`, 'the drawer already offers it'); }
  }
  if (dupes === 0) ok('neither component kept its own copy of a menu item');
}

console.log('\n-- the drawer itself lists nothing of its own --');
{
  const src = read('components/NavDrawer.tsx');
  truthy(src.includes("from '@/lib/nav'"), 'NavDrawer reads the table');
  // Labels live in lib/nav.ts. A literal here would be a third copy.
  const leaked = ['Cabrillo', 'Import ADIF', 'Summary sheet', 'Night mode', 'Guides']
    .filter(l => new RegExp(`>${l}<|'${l}'|"${l}"`).test(src));
  if (leaked.length === 0) ok('no menu label is written into the drawer markup');
  else no('no menu label is written into the drawer markup', leaked.join(', '));
}

console.log('\n-- the drawer is reachable and dismissable by keyboard --');
{
  const src = read('components/NavDrawer.tsx');
  truthy(/aria-expanded/.test(src), 'the hamburger reports its expanded state');
  truthy(/aria-label="Menu"/.test(src), 'and is labelled for a screen reader');
  truthy(/role="dialog"/.test(src), 'the panel is a dialog');
  truthy(/aria-labelledby/.test(src), 'with an accessible name');
  truthy(/'Escape'/.test(src), 'Escape closes it');
  truthy(/'Tab'/.test(src), 'and Tab is kept inside it while open');
  truthy(/motion-reduce:/.test(src), 'the slide is dropped for reduced motion');
}

console.log('');
if (failures > 0) { console.error(`${failures} failure(s)`); process.exit(1); }
console.log('All navigation tests passed.');
