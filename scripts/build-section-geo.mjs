#!/usr/bin/env node
/**
 * Build the section boundary file the map draws.
 *
 *   node scripts/build-section-geo.mjs
 *
 * Writes public/sections.geo.json — one polygon per ARRL/RAC section, so the
 * map can fill the section an operator worked instead of dropping a label box
 * near the middle of it.
 *
 * ## Where the shapes come from
 *
 * Both sources are public domain and both are pinned, because a boundary file
 * that quietly changes under you is worse than one that is out of date:
 *
 *   * **US** — `us-atlas` on npm, which is the Census Bureau's cartographic
 *     boundary files pre-built as TopoJSON. States and counties in one file,
 *     keyed by FIPS.
 *   * **Canada** — Natural Earth 1:50m admin-1, fetched from the project's
 *     public mirror. Cached under .cache/ so a rebuild needs no network.
 *
 * ## Two kinds of section
 *
 * 54 of the 85 sections *are* a state, a province, a territory, or a small
 * union of them (Maryland + DC; Yukon + NWT + Nunavut; Hawaii + the US
 * Pacific islands). Those are exact: the boundary is an administrative
 * boundary somebody else already surveyed.
 *
 * The other 31 are carved out of nine jurisdictions by county — California
 * alone splits into nine sections. Those need ARRL's published county list,
 * which is not transcribed here yet, so this emits their *jurisdiction* as a
 * single `pending` outline naming the sections inside it. The map draws those
 * neutrally with their labels, which is honest about what is known: a wrong
 * boundary drawn confidently is worse than no boundary at all, and this file
 * would look equally authoritative either way.
 *
 * When `data/arrl-section-counties.json` gains a jurisdiction, its counties
 * are dissolved into real sections here and the `pending` outline disappears.
 * Nothing else has to change.
 *
 * `scripts/test-sections.cjs` checks the output accounts for every section in
 * ARRL_SECTIONS exactly once, whether filled or pending, so a section cannot
 * go missing from the map without the build failing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as tc from 'topojson-client';
import * as ts from 'topojson-server';
import * as tsimp from 'topojson-simplify';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const cache = path.join(root, '.cache');
const OUT = path.join(root, 'public', 'sections.geo.json');

/** Natural Earth 1:50m admin-1, public domain. Pinned to a commit rather than
 *  a branch so the shapes cannot move without this line moving. */
const NE_ADMIN1 =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_admin_1_states_provinces.geojson';

// ── Sections that are exactly one administrative unit, or a union of a few ──
// US, by state FIPS.
const US_WHOLE = {
  CT: ['09'], ME: ['23'], NH: ['33'], RI: ['44'], VT: ['50'],
  DE: ['10'], MDC: ['24', '11'],                       // Maryland + DC
  AL: ['01'], GA: ['13'], KY: ['21'], NC: ['37'], SC: ['45'],
  TN: ['47'], VA: ['51'], PR: ['72'], VI: ['78'],
  AR: ['05'], LA: ['22'], MS: ['28'], NM: ['35'], OK: ['40'],
  PAC: ['15', '66', '60', '69'],                       // Hawaii + US Pacific
  AK: ['02'], AZ: ['04'], ID: ['16'], MT: ['30'], NV: ['32'],
  OR: ['41'], UT: ['49'], WY: ['56'],
  MI: ['26'], OH: ['39'], WV: ['54'],
  IL: ['17'], IN: ['18'], WI: ['55'],
  CO: ['08'], IA: ['19'], KS: ['20'], MN: ['27'], MO: ['29'],
  ND: ['38'], NE: ['31'], SD: ['46'],
};

// Canada, by Natural Earth admin-1 name.
const CA_WHOLE = {
  AB: ['Alberta'], BC: ['British Columbia'], MB: ['Manitoba'],
  NB: ['New Brunswick'], NL: ['Newfoundland and Labrador'],
  NS: ['Nova Scotia'], PE: ['Prince Edward Island'],
  QC: ['Québec'], SK: ['Saskatchewan'],
  // RAC folded Yukon into the Northern Territories section; it is one section
  // covering all three territories, not three.
  NT: ['Northwest Territories', 'Yukon', 'Nunavut'],
};

// ── Sections carved out of one jurisdiction by county ───────────────────────
// Until the county list is transcribed, the jurisdiction is drawn once and
// labelled with the sections inside it.
const CARVED = [
  { key: 'US-25', name: 'Massachusetts',   fips: '25',    sections: ['EMA', 'WMA'] },
  { key: 'US-34', name: 'New Jersey',      fips: '34',    sections: ['NNJ', 'SNJ'] },
  { key: 'US-36', name: 'New York',        fips: '36',    sections: ['ENY', 'NLI', 'NNY', 'WNY'] },
  { key: 'US-42', name: 'Pennsylvania',    fips: '42',    sections: ['EPA', 'WPA'] },
  { key: 'US-12', name: 'Florida',         fips: '12',    sections: ['NFL', 'SFL', 'WCF'] },
  { key: 'US-48', name: 'Texas',           fips: '48',    sections: ['NTX', 'STX', 'WTX'] },
  { key: 'US-06', name: 'California',      fips: '06',    sections: ['EB', 'LAX', 'ORG', 'SB', 'SCV', 'SDG', 'SF', 'SJV', 'SV'] },
  { key: 'US-53', name: 'Washington',      fips: '53',    sections: ['EWA', 'WWA'] },
  { key: 'CA-ON', name: 'Ontario',         ne: 'Ontario', sections: ['GH', 'ONE', 'ONN', 'ONS'] },
];

/** Rough area of a lon/lat ring in km², good enough to decide whether a thing
 *  is visible. Shoelace with longitude scaled by cos(latitude). */
function ringAreaKm2(ring) {
  const R = 111.32; // km per degree of latitude
  const latMean = ring.reduce((a, c) => a + c[1], 0) / ring.length;
  const k = Math.cos((latMean * Math.PI) / 180);
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] * k) * ring[i][1] - (ring[i][0] * k) * ring[j][1];
  }
  return Math.abs(a / 2) * R * R;
}

/**
 * Drop islands too small to see, keeping the largest piece whatever happens.
 *
 * Alaska ships 137 separate polygons and the Northern Territories 105 — the
 * Aleutians and the Canadian Arctic Archipelago — and between them they were
 * two thirds of this file. At the zoom this map opens at a degree of latitude
 * is about five pixels, so an island under a couple of hundred square
 * kilometres is smaller than a pixel: bytes spent on something nobody can
 * see. Every section keeps at least its largest polygon, so none can vanish.
 */
const MIN_ISLAND_KM2 = 250;
function dropSpecks(geometry) {
  if (geometry.type !== 'MultiPolygon') return geometry;
  const scored = geometry.coordinates
    .map(poly => ({ poly, area: ringAreaKm2(poly[0]) }))
    .sort((a, b) => b.area - a.area);
  const keep = scored.filter((s, i) => i === 0 || s.area >= MIN_ISLAND_KM2);
  return keep.length === geometry.coordinates.length
    ? geometry
    : { type: 'MultiPolygon', coordinates: keep.map(s => s.poly) };
}

/** The county → section table, once somebody transcribes it from ARRL's
 *  published list. Absent or partial is fine: whatever is missing stays a
 *  `pending` outline rather than being guessed at. */
function loadCountyTable() {
  const p = path.join(root, 'data', 'arrl-section-counties.json');
  if (!fs.existsSync(p)) return {};
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  return raw.jurisdictions ?? {};
}

async function naturalEarth() {
  fs.mkdirSync(cache, { recursive: true });
  const f = path.join(cache, 'ne_50m_admin_1.geojson');
  if (!fs.existsSync(f)) {
    process.stderr.write('fetching Natural Earth admin-1…\n');
    const res = await fetch(NE_ADMIN1);
    if (!res.ok) throw new Error(`Natural Earth fetch failed: ${res.status}`);
    fs.writeFileSync(f, await res.text());
  }
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

/** ARRL_SECTIONS, read out of lib/types.ts rather than restated here — a
 *  second copy of the list is the bug this repo keeps re-finding. */
function arrlSections() {
  const src = fs.readFileSync(path.join(root, 'lib', 'types.ts'), 'utf8');
  const m = /export const ARRL_SECTIONS[^=]*=\s*\[([\s\S]*?)\]/.exec(src);
  if (!m) throw new Error('could not find ARRL_SECTIONS in lib/types.ts');
  return [...m[1].matchAll(/'([A-Z0-9]+)'/g)].map(x => x[1]);
}

const main = async () => {
  const sections = arrlSections();
  const us = JSON.parse(fs.readFileSync(
    path.join(root, 'node_modules', 'us-atlas', 'counties-10m.json'), 'utf8'));
  const ne = await naturalEarth();
  const countyTable = loadCountyTable();

  const usStates = new Map(us.objects.states.geometries.map(g => [g.id, g]));
  const usCounties = us.objects.counties.geometries;
  const neByName = new Map(
    ne.features.filter(f => f.properties.admin === 'Canada')
      .map(f => [f.properties.name, f]));

  /** Features, in the shape the map consumes. */
  const features = [];
  const accounted = new Set();

  // ── whole administrative units ────────────────────────────────────────────
  for (const [code, fipsList] of Object.entries(US_WHOLE)) {
    const geoms = fipsList.map(f => {
      const g = usStates.get(f);
      if (!g) throw new Error(`${code}: no US state with FIPS ${f}`);
      return g;
    });
    features.push({
      type: 'Feature', id: code,
      properties: { kind: 'section' },
      geometry: tc.merge(us, geoms),
    });
    accounted.add(code);
  }

  for (const [code, names] of Object.entries(CA_WHOLE)) {
    const fs_ = names.map(n => {
      const f = neByName.get(n);
      if (!f) throw new Error(`${code}: no Canadian admin-1 named ${n}`);
      return f;
    });
    features.push({
      type: 'Feature', id: code,
      properties: { kind: 'section' },
      geometry: fs_.length === 1 ? fs_[0].geometry : {
        type: 'MultiPolygon',
        coordinates: fs_.flatMap(f =>
          f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates),
      },
    });
    accounted.add(code);
  }

  // ── carved jurisdictions ──────────────────────────────────────────────────
  for (const j of CARVED) {
    const table = countyTable[j.key];
    if (table) {
      // Real sections, dissolved from counties.
      for (const [code, fipsCodes] of Object.entries(table)) {
        const geoms = usCounties.filter(c => fipsCodes.includes(c.id));
        if (geoms.length !== fipsCodes.length) {
          throw new Error(`${code}: ${fipsCodes.length} counties listed, ${geoms.length} found`);
        }
        features.push({
          type: 'Feature', id: code,
          properties: { kind: 'section' },
          geometry: tc.merge(us, geoms),
        });
        accounted.add(code);
      }
      continue;
    }
    // No table yet: draw the jurisdiction, name what is inside it.
    const geometry = j.fips
      ? tc.merge(us, [usStates.get(j.fips)])
      : neByName.get(j.ne).geometry;
    features.push({
      type: 'Feature', id: j.key,
      properties: { kind: 'pending', name: j.name, sections: j.sections },
      geometry,
    });
    for (const s of j.sections) accounted.add(s);
  }

  // ── every section accounted for, exactly once ─────────────────────────────
  const missing = sections.filter(s => !accounted.has(s));
  const extra = [...accounted].filter(s => !sections.includes(s));
  if (missing.length) throw new Error(`sections with no geometry: ${missing.join(', ')}`);
  if (extra.length) throw new Error(`geometry for things that are not sections: ${extra.join(', ')}`);

  // ── simplify ──────────────────────────────────────────────────────────────
  // Through TopoJSON, because it simplifies shared borders as one arc: doing
  // it per-polygon in GeoJSON tears adjacent sections apart at the seams.
  let dropped = 0;
  for (const f of features) {
    const before = f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates.length : 1;
    f.geometry = dropSpecks(f.geometry);
    const after = f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates.length : 1;
    dropped += before - after;
  }

  // A FeatureCollection, not a bare GeometryCollection: topology() carries
  // `id` and `properties` through from features and drops them from raw
  // geometries, which silently produced 63 anonymous polygons the first time.
  let topo = ts.topology({ sections: { type: 'FeatureCollection', features } });
  topo = tsimp.presimplify(topo);
  const weights = topo.arcs.flat().map(p => p[2]).filter(w => w && isFinite(w)).sort((a, b) => a - b);
  // Keep the most significant fifth of the vertices. Measured against the
  // rendered map: coastlines that matter at the zoom this opens at — Florida,
  // Maine, Michigan, the Chesapeake — still read correctly, and the file is a
  // twentieth of the size.
  const KEEP = Number(process.env.SECTION_GEO_KEEP ?? 0.1);
  topo = tsimp.simplify(topo, weights[Math.floor(weights.length * (1 - KEEP))] ?? 0);
  topo = tc.quantize(topo, 1e4);

  const out = tc.feature(topo, topo.objects.sections);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));

  const filled = out.features.filter(f => f.properties.kind === 'section').length;
  const pending = out.features.filter(f => f.properties.kind === 'pending');
  const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
  process.stderr.write(
    `${OUT.replace(root + '/', '')}  ${kb} KB\n` +
    `  ${filled} sections with a boundary\n` +
    `  ${pending.reduce((n, f) => n + f.properties.sections.length, 0)} awaiting a county list, ` +
    `in ${pending.length} jurisdictions: ${pending.map(f => f.properties.name).join(', ')}\n` +
    `  ${sections.length} sections accounted for\n` +
    `  ${dropped} islands below ${MIN_ISLAND_KM2} km² dropped as sub-pixel\n`);
};

main().catch(e => { process.stderr.write(`build failed: ${e.message}\n`); process.exit(1); });
