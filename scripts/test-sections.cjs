#!/usr/bin/env node
// Guards the ARRL/RAC section list against the two ways it has gone wrong:
//
//   1. The places that enumerate sections drifting apart — ARRL_SECTIONS
//      (lib/types.ts), SECTION_DATA (lib/sections.ts) and SECTION_GROUPS
//      (lib/sections.ts, the call-area layout).
//   2. A section total written out as a literal instead of derived from
//      ARRL_SECTIONS.length. That is what issue #14 was: scoring awarded the
//      Worked All Sections bonus at the list length while the summary sheet
//      and the "Sections Needed" button compared against a hardcoded 84, so
//      the sheet an operator transcribes onto their ARRL entry omitted a
//      bonus its own claimed score already included.
//   3. A component growing its own private copy of the section list. That is
//      how the first fix missed a place: SectionGrid and SectionsNeeded each
//      had their own grid, only one was corrected, and the panel operators
//      read to know what to chase kept listing retired sections. The layout
//      now lives once in SECTION_GROUPS, and check 3 fails if a copy reappears.
//
// Parses the sources rather than importing them: these are TS/TSX modules and
// the check needs to run without a build step.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

let failures = 0;
const ok = m => console.log(`  \x1b[32mok\x1b[0m   ${m}`);
const no = (m, d) => { failures++; console.log(`  \x1b[31mFAIL\x1b[0m ${m}${d ? `\n       ${d}` : ''}`); };

const diff = (a, b) => [...a].filter(x => !b.has(x)).sort().join(', ') || '(none)';

// --- the three lists ---------------------------------------------------
const typesSrc = read('lib/types.ts');
const listBody = typesSrc.match(/export const ARRL_SECTIONS = \[([\s\S]*?)\] as const;/);
if (!listBody) {
  no('ARRL_SECTIONS is parseable from lib/types.ts');
  process.exit(1);
}
const sections = [...listBody[1].matchAll(/'([A-Z0-9]+)'/g)].map(m => m[1]);
const sectionSet = new Set(sections);

const dataKeys = [...read('lib/sections.ts').matchAll(/^ {2}([A-Z0-9]+): +\{/gm)].map(m => m[1]);
const dataSet = new Set(dataKeys);

const sectionsSrc = read('lib/sections.ts');
const groupsBody = sectionsSrc.match(/export const SECTION_GROUPS[^=]*= \[([\s\S]*?)\n\];/);
const gridKeys = groupsBody
  ? [...groupsBody[1].matchAll(/sections: \[([^\]]*)\]/g)]
      .flatMap(g => [...g[1].matchAll(/'([A-Z0-9]+)'/g)].map(m => m[1]))
  : [];
const gridSet = new Set(gridKeys);

console.log('Section list consistency');

if (sections.length === sectionSet.size) ok(`ARRL_SECTIONS has no duplicates (${sections.length} entries)`);
else no('ARRL_SECTIONS has no duplicates');

// 71 US + 14 Canadian. Pinned so a silent edit that drops or invents a
// section has to be a deliberate change to this file too.
if (sections.length === 85) ok('ARRL_SECTIONS holds the 85 current ARRL/RAC sections');
else no('ARRL_SECTIONS holds the 85 current ARRL/RAC sections', `found ${sections.length}`);

if (dataKeys.length === dataSet.size) ok('SECTION_DATA has no duplicate keys');
else no('SECTION_DATA has no duplicate keys');

if (sectionSet.size === dataSet.size && [...sectionSet].every(s => dataSet.has(s))) {
  ok('SECTION_DATA covers exactly ARRL_SECTIONS');
} else {
  no('SECTION_DATA covers exactly ARRL_SECTIONS',
     `missing from SECTION_DATA: ${diff(sectionSet, dataSet)} | not a section: ${diff(dataSet, sectionSet)}`);
}

if (gridKeys.length === gridSet.size) ok('SECTION_GROUPS lists no section twice');
else no('SECTION_GROUPS lists no section twice');

if (sectionSet.size === gridSet.size && [...sectionSet].every(s => gridSet.has(s))) {
  ok('SECTION_GROUPS covers exactly ARRL_SECTIONS');
} else {
  no('SECTION_GROUPS covers exactly ARRL_SECTIONS',
     `missing from the grid: ${diff(sectionSet, gridSet)} | not a section: ${diff(gridSet, sectionSet)}`);
}

// Sections retired by RAC that older lists still carry. Keeping them would
// inflate the Worked All Sections target and offer operators dead choices.
const retired = ['MAR', 'ON', 'PEI', 'GTA', 'YT'];
const stale = retired.filter(s => sectionSet.has(s));
if (stale.length === 0) ok(`no retired sections (${retired.join(', ')}) remain in the list`);
else no('no retired sections remain in the list', `still present: ${stale.join(', ')}`);

// --- no hardcoded totals ------------------------------------------------
//
// Sections are an operating goal, not a bonus: ARRL Field Day rule 7.3 runs
// 7.3.1 to 7.3.18 and none of them awards points for a clean sweep. Scoring no
// longer compares a section count against anything, which is why only the
// "how many left to chase" display remains here. The literal check below still
// matters — that display is the sheet an operator reads to know what to work.
console.log('\nThe sections-remaining total is derived, not written out');

const derivedFrom = [
  ['components/LoggingClient.tsx', 'ARRL_SECTIONS.length - score.sections_worked'],
];
for (const [file, needle] of derivedFrom) {
  if (read(file).includes(needle)) ok(`${file} compares against ARRL_SECTIONS.length`);
  else no(`${file} compares against ARRL_SECTIONS.length`, `expected to find: ${needle}`);
}

// Scoring must not grow a sections bonus back. It had one for several
// releases; ARRL has never had such a rule, so a clean sweep used to add 100
// points to a claimed score that an entrant then copied onto their entry.
{
  const src = read('lib/scoring.ts') + read('lib/bonuses.ts');
  if (!/ARRL_SECTIONS\.length/.test(src)) ok('lib/scoring.ts awards nothing for a section sweep');
  else no('lib/scoring.ts awards nothing for a section sweep',
          'ARRL_SECTIONS.length is back in the scorer — there is no such bonus');
}

// Catch the general shape too, so a *different* literal doesn't sneak back in.
for (const file of ['lib/scoring.ts', 'components/SummarySheet.tsx', 'components/LoggingClient.tsx', 'components/SectionsNeeded.tsx']) {
  const hits = [...read(file).matchAll(/sections?_?[Ww]orked\s*(?:>=|<=|>|<|-|===|!==)\s*(\d+)|(\d+)\s*(?:>=|<=|>|<|-)\s*(?:score\.)?sections?_?[Ww]orked/g)];
  if (hits.length === 0) ok(`${file} has no hardcoded section total`);
  else no(`${file} has no hardcoded section total`, `literal(s): ${hits.map(h => h[1] ?? h[2]).join(', ')}`);
}

// --- no private copies of the list ------------------------------------
//
// The check that would have caught the SectionsNeeded miss. Any file other
// than the two canonical ones holding an array literal of three or more
// section abbreviations is a second copy of the list, and a second copy is
// how it goes stale.
console.log('\nThe section list exists in one place');

const canonical = new Set(['lib/types.ts', 'lib/sections.ts', 'scripts/test-sections.cjs']);
const searchDirs = ['components', 'lib', 'app'];

const walk = dir => fs.readdirSync(path.join(root, dir), { withFileTypes: true })
  .flatMap(e => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return walk(rel);
    return /\.(ts|tsx)$/.test(e.name) ? [rel] : [];
  });

const offenders = [];
for (const file of searchDirs.flatMap(walk)) {
  if (canonical.has(file)) continue;
  for (const m of read(file).matchAll(/\[((?:\s*'[A-Z0-9]{2,4}'\s*,){2,}\s*'[A-Z0-9]{2,4}'\s*,?)\s*\]/g)) {
    const entries = [...m[1].matchAll(/'([A-Z0-9]+)'/g)].map(x => x[1]);
    const hits = entries.filter(e => sectionSet.has(e));
    // Three or more real sections in one literal is a section list, not a
    // coincidental array of short uppercase strings (bands, modes, classes).
    if (hits.length >= 3) offenders.push(`${file}: [${entries.slice(0, 6).join(', ')}${entries.length > 6 ? ', …' : ''}]`);
  }
}

if (offenders.length === 0) {
  ok('no file outside lib/types.ts and lib/sections.ts hardcodes a section list');
} else {
  no('no file outside lib/types.ts and lib/sections.ts hardcodes a section list',
     offenders.join('\n       ') + '\n       Use ARRL_SECTIONS or SECTION_GROUPS instead.');
}

console.log('');
if (failures) {
  console.log(`\x1b[31m${failures} check(s) failed\x1b[0m`);
  process.exit(1);
}
console.log('\x1b[32mAll section checks passed\x1b[0m');
