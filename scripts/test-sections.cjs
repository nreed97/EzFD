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

// --- the map's section boundaries ---------------------------------------
//
// public/sections.geo.json is a fourth enumeration of the section list, and
// this repo has been bitten three times by a second copy going stale. The
// guard above only scans .ts/.tsx, so a JSON asset slips straight past it.
//
// The failure this prevents is specific and silent: a section whose polygon
// is missing simply is not drawn, and a map with a hole in it looks like a
// map. Nothing else would notice.
console.log('\nThe map covers every section');
{
  const geoPath = path.join(root, 'public', 'sections.geo.json');
  if (!fs.existsSync(geoPath)) {
    no('public/sections.geo.json exists', 'run: node scripts/build-section-geo.mjs');
  } else {
    const geo = JSON.parse(fs.readFileSync(geoPath, 'utf8'));

    // Two kinds of feature. A `section` is one section, filled by whether it
    // has been worked. A `pending` outline names the sections inside an area
    // whose internal boundaries are not known, and they count as accounted
    // for — either a jurisdiction whose county list has not been transcribed,
    // or an administrative unit two sections split along a line that is not an
    // administrative one (Nipissing District, cut by Algonquin Park).
    //
    // Those two cases have to be told apart or this check reads them wrong.
    // A jurisdiction *substitutes* for its sections, which have no fill of
    // their own; a shared unit sits on top of sections that are drawn all
    // around it, so counting the names it lists would report every one of them
    // as appearing twice. A pending feature whose sections are all filled
    // elsewhere is the shared kind — which is exactly what makes it shared.
    const filled = geo.features.filter(f => f.properties.kind === 'section').map(f => f.id);
    const filledSet = new Set(filled);
    const pending = geo.features
      .filter(f => f.properties.kind === 'pending')
      .filter(f => !(f.properties.sections ?? []).every(s => filledSet.has(s)))
      .flatMap(f => f.properties.sections ?? []);
    const covered = [...filled, ...pending];

    const missing = sections.filter(s => !covered.includes(s));
    const extra = covered.filter(s => !sectionSet.has(s));
    const dupes = covered.filter((s, i) => covered.indexOf(s) !== i);

    if (missing.length === 0) ok(`every one of the ${sections.length} sections is on the map`);
    else no('every section is on the map', `missing: ${missing.join(', ')}`);

    if (extra.length === 0) ok('and nothing on the map is not a section');
    else no('nothing on the map is not a section', extra.join(', '));

    if (dupes.length === 0) ok('each appears exactly once');
    else no('each appears exactly once', `repeated: ${[...new Set(dupes)].join(', ')}`);

    // A shared outline is drawn *over* sections that are filled around it, so
    // it must name at least two of them and every one must be a real section.
    // One name would mean the area belongs to that section and should have
    // been dissolved into it; a name that is not a section, or one with no
    // fill anywhere, would be an area the map asserts and the log cannot
    // score — and the coverage check above deliberately looks past these
    // features, so nothing else would notice.
    const shared = geo.features
      .filter(f => f.properties.kind === 'pending')
      .filter(f => (f.properties.sections ?? []).every(s => filledSet.has(s)));
    const badShared = shared.filter(f => (f.properties.sections ?? []).length < 2);
    if (badShared.length === 0) {
      ok(shared.length
        ? `${shared.length} shared outline(s), each over two or more filled sections`
        : 'no shared outlines');
    } else {
      no('a shared outline covers two or more sections',
        badShared.map(f => `${f.id} names ${(f.properties.sections ?? []).join('/') || 'nothing'}`).join('; '));
    }

    // DX is an exchange, never a section. On the map it would be a shape with
    // no meaning, and in the denominator it would move the target to 86.
    if (!covered.includes('DX')) ok('DX has no polygon, because DX is not a section');
    else no('DX has no polygon', 'DX is a valid exchange but never a section');

    const noGeom = geo.features.filter(f => !f.geometry || !f.geometry.coordinates?.length);
    if (noGeom.length === 0) ok('every feature carries geometry');
    else no('every feature carries geometry', noGeom.map(f => f.id).join(', '));

    // Alaska and the Pacific section really do straddle the antimeridian, and
    // they draw correctly only because every island is a separate ring. A
    // single ring spanning most of the globe is the classic symptom of a
    // source that does not split at 180 degrees, and it renders as a band
    // smeared across the whole world.
    let widest = 0, widestId = '';
    for (const f of geo.features) {
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const poly of polys) {
        const lons = poly[0].map(c => c[0]);
        const span = Math.max(...lons) - Math.min(...lons);
        if (span > widest) { widest = span; widestId = f.id; }
      }
    }
    if (widest < 180) ok(`no ring wraps the globe (widest ${widest.toFixed(0)}°, ${widestId})`);
    else no('no ring wraps the globe', `${widestId} spans ${widest.toFixed(0)}° — it will smear across the map`);

    // The asset is fetched on opening the map view. It has one job and it is
    // easy to regenerate at a resolution nobody asked for.
    const kb = fs.statSync(geoPath).size / 1024;
    if (kb < 400) ok(`the asset is ${kb.toFixed(0)} KB`);
    else no('the asset stays under 400 KB', `${kb.toFixed(0)} KB — re-run the build with a higher SECTION_GEO_TOLERANCE`);
  }
}

console.log('');
if (failures) {
  console.log(`\x1b[31m${failures} check(s) failed\x1b[0m`);
  process.exit(1);
}
console.log('\x1b[32mAll section checks passed\x1b[0m');
