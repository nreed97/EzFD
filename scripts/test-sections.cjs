#!/usr/bin/env node
// Guards the ARRL/RAC section list against the two ways it has gone wrong:
//
//   1. The three places that enumerate sections drifting apart —
//      ARRL_SECTIONS (lib/types.ts), SECTION_DATA (lib/sections.ts) and the
//      GROUPS grid (components/SectionGrid.tsx).
//   2. A section total written out as a literal instead of derived from
//      ARRL_SECTIONS.length. That is what issue #14 was: scoring awarded the
//      Worked All Sections bonus at the list length while the summary sheet
//      and the "Sections Needed" button compared against a hardcoded 84, so
//      the sheet an operator transcribes onto their ARRL entry omitted a
//      bonus its own claimed score already included.
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

const gridSrc = read('components/SectionGrid.tsx');
const gridBody = gridSrc.match(/const GROUPS = \[([\s\S]*?)\n\];/);
const gridKeys = gridBody
  ? [...gridBody[1].matchAll(/sections: \[([^\]]*)\]/g)]
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

if (sectionSet.size === gridSet.size && [...sectionSet].every(s => gridSet.has(s))) {
  ok('the SectionGrid GROUPS grid covers exactly ARRL_SECTIONS');
} else {
  no('the SectionGrid GROUPS grid covers exactly ARRL_SECTIONS',
     `missing from the grid: ${diff(sectionSet, gridSet)} | not a section: ${diff(gridSet, sectionSet)}`);
}

// Sections retired by RAC that older lists still carry. Keeping them would
// inflate the Worked All Sections target and offer operators dead choices.
const retired = ['MAR', 'ON', 'PEI', 'GTA', 'YT'];
const stale = retired.filter(s => sectionSet.has(s));
if (stale.length === 0) ok(`no retired sections (${retired.join(', ')}) remain in the list`);
else no('no retired sections remain in the list', `still present: ${stale.join(', ')}`);

// --- no hardcoded totals ------------------------------------------------
console.log('\nWorked All Sections total is derived, not written out');

const derivedFrom = [
  ['lib/scoring.ts',              'sectionsWorked >= ARRL_SECTIONS.length'],
  ['components/SummarySheet.tsx', 'score.sections_worked >= ARRL_SECTIONS.length'],
  ['components/LoggingClient.tsx','ARRL_SECTIONS.length - score.sections_worked'],
];
for (const [file, needle] of derivedFrom) {
  if (read(file).includes(needle)) ok(`${file} compares against ARRL_SECTIONS.length`);
  else no(`${file} compares against ARRL_SECTIONS.length`, `expected to find: ${needle}`);
}

// Catch the general shape too, so a *different* literal doesn't sneak back in.
for (const file of ['lib/scoring.ts', 'components/SummarySheet.tsx', 'components/LoggingClient.tsx', 'components/SectionsNeeded.tsx']) {
  const hits = [...read(file).matchAll(/sections?_?[Ww]orked\s*(?:>=|<=|>|<|-|===|!==)\s*(\d+)|(\d+)\s*(?:>=|<=|>|<|-)\s*(?:score\.)?sections?_?[Ww]orked/g)];
  if (hits.length === 0) ok(`${file} has no hardcoded section total`);
  else no(`${file} has no hardcoded section total`, `literal(s): ${hits.map(h => h[1] ?? h[2]).join(', ')}`);
}

console.log('');
if (failures) {
  console.log(`\x1b[31m${failures} check(s) failed\x1b[0m`);
  process.exit(1);
}
console.log('\x1b[32mAll section checks passed\x1b[0m');
