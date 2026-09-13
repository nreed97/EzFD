// Which section labels the map draws at which zoom.
//
//   node scripts/test-map-labels.cjs
//
// The map opens at zoom 3, and at that zoom 54 of its 85 labels overlap
// another — 105 overlapping pairs, worst through the Northeast where a dozen
// sections are smaller than their own abbreviations. That is not a crowded
// corner, it is most of the map, and it is the view an operator lands on.
//
// Two properties are worth more here than the packing being optimal, and
// neither is obvious from looking at a rendered map:
//
//   * Stable. Placement must not consult whether a section is worked, or the
//     map twitches while people are logging.
//   * Monotonic. Zooming in must never take a label away. This did not hold
//     in the first implementation — greedy placement in a fixed order let a
//     label that had only just become placeable evict one that had been drawn
//     all along, and VT, DE and ENY each vanished as the map zoomed *in*.
//     That is the bug this file exists to keep fixed.

const { compile } = require('./_compile-ts.cjs');
const ts = compile(['lib/mapLabels.ts', 'lib/sections.ts']);
const { placeLabels, projectPx, labelWidth, BASE_ZOOM } = ts.load('mapLabels');
const { SECTION_DATA } = ts.load('sections');

let failures = 0;
const ok = m => console.log(`ok    ${m}`);
const no = (m, d) => { console.log(`FAIL  ${m}${d ? ` — ${d}` : ''}`); failures++; };
const truthy = (c, m, d) => (c ? ok(m) : no(m, d));

const POINTS = Object.entries(SECTION_DATA)
  .map(([section, i]) => ({ section, lat: i.lat, lon: i.lon }));

console.log('\n-- every label is reachable, none is drawn on top of another --');

truthy(POINTS.length === 85, 'all 85 sections carry coordinates to place',
  `got ${POINTS.length}`);

// A label nobody can ever read is worse than one hidden until you zoom.
const deep = placeLabels(POINTS, 14);
const never = POINTS.filter(p => !deep.has(p.section)).map(p => p.section);
truthy(never.length === 0, 'every section label is drawn once zoomed in far enough',
  never.join(' '));

// The whole point: what is drawn does not collide.
function collisions(zoom) {
  const keep = placeLabels(POINTS, zoom);
  const drawn = POINTS.filter(p => keep.has(p.section)).map(p => {
    const [x, y] = projectPx(p.lat, p.lon, zoom);
    return { s: p.section, x, y, w: labelWidth(p.section) };
  });
  const hits = [];
  for (let i = 0; i < drawn.length; i++)
    for (let j = i + 1; j < drawn.length; j++) {
      const a = drawn[i], b = drawn[j];
      if (Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < 15)
        hits.push(`${a.s}/${b.s}`);
    }
  return hits;
}
for (const z of [3, 4, 5, 6]) {
  const hits = collisions(z);
  truthy(hits.length === 0, `nothing drawn at zoom ${z} overlaps anything else`,
    hits.slice(0, 5).join(' '));
}

// It has to actually thin the default view, or it is machinery doing nothing.
const atBase = placeLabels(POINTS, BASE_ZOOM).size;
truthy(atBase < POINTS.length, 'the default zoom draws fewer than all 85',
  `drew ${atBase}`);
truthy(atBase > POINTS.length / 2, 'but still draws most of them, not a token few',
  `drew ${atBase}`);

console.log('\n-- zooming in never takes a label away --');

// The first implementation failed exactly here: greedy in a fixed order let a
// newly placeable label evict one already drawn.
let lost = [];
for (let z = BASE_ZOOM; z < 14; z++) {
  const a = placeLabels(POINTS, z), b = placeLabels(POINTS, z + 1);
  for (const s of a) if (!b.has(s)) lost.push(`${s}@${z}->${z + 1}`);
}
truthy(lost.length === 0, 'a label drawn at one zoom is still drawn at the next',
  lost.slice(0, 6).join(' '));

// A fractional zoom mid-gesture must not add labels the level has not reached.
const half = placeLabels(POINTS, BASE_ZOOM + 0.5);
const whole = placeLabels(POINTS, BASE_ZOOM);
truthy(half.size === whole.size && [...whole].every(s => half.has(s)),
  'a fractional zoom shows the level below, so nothing flickers mid-pinch');

// Below the floor is the floor, not an empty map.
truthy(placeLabels(POINTS, 0).size === whole.size,
  'zooming out past the base keeps the base set rather than emptying the map');

console.log('\n-- placement is stable, and never reads the log --');

// A label that vanished because somebody logged a contact would make the map
// twitch during a run, and would make the labels an unreliable reference.
// Comments stripped first: the prose in that file explains *why* it ignores
// the log, and grepping the explanation instead of the code would make this
// assertion impossible to satisfy honestly.
const code = require('fs').readFileSync('lib/mapLabels.ts', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');
// Substring, not a word boundary: `isWorked` and `workedFirst` are exactly
// how this would come back, and \bworked\b matches neither.
truthy(!/worked/i.test(code),
  'the placement module has no notion of a section being worked');

// Same inputs, same answer — the greedy order is the caller's, which is fixed.
const twice = placeLabels(POINTS, 4);
truthy([...placeLabels(POINTS, 4)].join() === [...twice].join(),
  'the same zoom places the same labels every time');

// Reversing the input must change *which* labels win, or the order is not
// actually the priority and the stability claim means nothing.
const reversed = placeLabels([...POINTS].reverse(), BASE_ZOOM);
truthy([...reversed].sort().join() !== [...whole].sort().join(),
  'input order is the priority, so a stable order is what keeps placement stable');

console.log();
if (failures === 0) console.log('All map label tests passed.');
else { console.log(`${failures} map label test(s) FAILED.`); process.exit(1); }
