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
 *   * **Canada** — Statistics Canada's census division cartographic boundary
 *     file, dissolved to provinces for most sections and to RAC's four
 *     Ontario sections for that province. Already in NAD83 lat/lon, so there
 *     is nothing to reproject. Cached under .cache/ so a rebuild needs no
 *     network.
 *
 * ## Two kinds of section
 *
 * 54 of the 85 sections *are* a state, a province, a territory, or a small
 * union of them (Maryland + DC; Yukon + NWT + Nunavut; Hawaii + the US
 * Pacific islands). Those are exact: the boundary is an administrative
 * boundary somebody else already surveyed.
 *
 * The other 31 are carved out of nine jurisdictions by county — California
 * alone splits into nine sections — or, in Ontario, by census division. Those
 * need the published list, and where one is not transcribed yet this emits the
 * *jurisdiction* as a single `pending` outline naming the sections inside it.
 * The map draws those neutrally with their labels, which is honest about what
 * is known: a wrong boundary drawn confidently is worse than no boundary at
 * all, and this file would look equally authoritative either way.
 *
 * When `data/arrl-section-counties.json` gains a jurisdiction, its counties
 * are dissolved into real sections here and the `pending` outline disappears.
 * Nothing else has to change. `data/rac-ontario-sections.json` does the same
 * job for Ontario.
 *
 * One `pending` outline is not waiting on a transcription and never will be:
 * Nipissing District is split between Ontario East and Ontario North by
 * Algonquin Park's boundary, which is not a census-division line. See the
 * `_split` note in the Ontario data file.
 *
 * `scripts/test-sections.cjs` checks the output accounts for every section in
 * ARRL_SECTIONS exactly once, whether filled or pending, so a section cannot
 * go missing from the map without the build failing.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import * as shapefile from 'shapefile';
import * as tc from 'topojson-client';
import * as ts from 'topojson-server';
import * as tsimp from 'topojson-simplify';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const cache = path.join(root, '.cache');
const OUT = path.join(root, 'public', 'sections.geo.json');

/** Statistics Canada 2011 census divisions (`gcd_000b11a_e`), cartographic
 *  boundary file, under the Statistics Canada Open Licence. Ontario's census
 *  divisions have not changed since, and RAC's table is written against this
 *  same enumeration. Taken from a repository that vendored StatCan's own zip
 *  unmodified, because statcan.gc.ca is not reachable from every build host;
 *  pinned to a commit so the shapes cannot move without this line moving. */
const STATCAN_CD =
  'https://raw.githubusercontent.com/NYPL-Simplified/geojson-places-ca/38fd04c29dd002a31c69d091bfa98ea861729140/gcd_000b11a_e.zip';
const STATCAN_CD_BASE = 'gcd_000b11a_e';
/** …and checked, because a pinned URL only proves where the bytes came from.
 *  A boundary file that changed under us would redraw sections silently. */
const STATCAN_CD_SHA256 =
  '10c301493274b3c7c513798c99379706ded073630f580e6dc3d7034a5e882735';

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

// Canada, by Statistics Canada province/territory code (PRUID).
const CA_WHOLE = {
  NL: ['10'], PE: ['11'], NS: ['12'], NB: ['13'],
  QC: ['24'], MB: ['46'], SK: ['47'], AB: ['48'], BC: ['59'],
  // RAC folded Yukon into the Northern Territories section; it is one section
  // covering all three territories, not three.
  NT: ['60', '61', '62'],
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
  { key: 'CA-ON', name: 'Ontario',         pr: '35',      sections: ['GH', 'ONE', 'ONN', 'ONS'] },
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
/**
 * How much detail survives simplification, as a minimum triangle weight.
 *
 * An absolute tolerance rather than "keep the top tenth of the vertices",
 * which is what this was and which measures the wrong thing: the percentile is
 * taken over whatever arcs happen to be in the file, so adding a denser source
 * makes the cut-off finer for *everything else*. Adding Ontario's census
 * divisions did exactly that — 22,930 arcs became 392,019, the threshold fell
 * from 0.049 to 0.0000054, and the Northern Territories tripled in size
 * without anything about the Northern Territories changing.
 *
 * The value is the threshold the percentile produced when the file held only
 * the original sources, so the shapes that were calibrated against the
 * rendered map keep exactly the detail they were calibrated to. Below about
 * 0.02 the file stops shrinking usefully; above about 0.15 Michigan's Upper
 * Peninsula and the Delmarva start to mangle.
 */
const TOLERANCE = Number(process.env.SECTION_GEO_TOLERANCE ?? 0.049);

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

/** The county → section table, transcribed from ARRL's published boundaries.
 *  Absent or partial is fine: whatever is missing stays a `pending` outline
 *  rather than being guessed at. */
function loadCountyTable() {
  const p = path.join(root, 'data', 'arrl-section-counties.json');
  if (!fs.existsSync(p)) return {};
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  return raw.jurisdictions ?? {};
}

/** The census-division → section table for Ontario, transcribed from RAC's
 *  published one. Same contract as the county table: absent is fine, and
 *  whatever is missing stays a `pending` outline rather than being guessed. */
function loadOntarioTable() {
  const p = path.join(root, 'data', 'rac-ontario-sections.json');
  if (!fs.existsSync(p)) return null;
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!raw.sections) return null;
  return { sections: raw.sections, split: raw._split ?? {} };
}

/**
 * Reconcile ARRL's county names with the Census Bureau's.
 *
 * Three differences, all in ARRL's text, and fixed here rather than in the
 * data file so that file stays a faithful copy of the source somebody can
 * diff against ARRL's page:
 *
 *   * `Northhampton` — ARRL's spelling of Northampton, PA.
 *   * `Dade` — Florida renamed it Miami-Dade in 1997; ARRL's list did not.
 *   * `St Johns` — the Census writes St. Johns with the stop.
 *
 * Everything else matches once punctuation and case are normalised, which is
 * checked rather than assumed: an unmatched name fails the build instead of
 * quietly leaving a hole in a section.
 */
const ARRL_COUNTY_ALIASES = {
  northhampton: 'Northampton',
  dade: 'Miami-Dade',
  'st johns': 'St. Johns',
};
const normaliseCounty = n =>
  n.trim().toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ');

/**
 * Turn one jurisdiction's county lists into section → county-FIPS lists.
 *
 * Verifies both directions, because each catches a different way of being
 * wrong: a name ARRL lists that no county answers to (a typo, or a county
 * that has since been renamed), and a county in the state that no section
 * claims (an omission — the failure that leaves a hole in the map and is
 * invisible in a rendered picture).
 */
function resolveJurisdiction(key, table, countiesInState) {
  const byName = new Map();
  for (const c of countiesInState) byName.set(normaliseCounty(c.properties.name), c);

  const out = {};
  const claimedBy = new Map();
  for (const [section, list] of Object.entries(table)) {
    out[section] = [];
    for (const raw of list.split(',')) {
      const key0 = normaliseCounty(raw);
      const name = ARRL_COUNTY_ALIASES[key0] ?? raw.trim();
      const county = byName.get(normaliseCounty(name));
      if (!county) {
        throw new Error(`${key} ${section}: no county named "${raw.trim()}" — ` +
          `check it against the Census name, or add an alias`);
      }
      if (claimedBy.has(county.id)) {
        throw new Error(`${key}: ${county.properties.name} is in both ` +
          `${claimedBy.get(county.id)} and ${section}`);
      }
      claimedBy.set(county.id, section);
      out[section].push(county.id);
    }
  }

  const unclaimed = countiesInState
    .filter(c => !claimedBy.has(c.id))
    .map(c => c.properties.name);
  if (unclaimed.length) {
    throw new Error(`${key}: ${unclaimed.length} counties belong to no section — ` +
      unclaimed.join(', '));
  }
  return out;
}

/**
 * Reconcile RAC's census-division names with Statistics Canada's.
 *
 * RAC writes them the way a person says them — "Durham Regional Municipality",
 * "City of Ottawa", "Manitoulin Island" — and the census writes the bare name.
 * Stripping the civic prefixes and suffixes does most of it; the rest are
 * spelled differently and are listed, so an unmatched name fails the build
 * rather than quietly leaving a hole in a section.
 *
 * `City of Sudbury` is the census division "Greater Sudbury / Grand Sudbury",
 * which is *not* the same thing as Sudbury District — see SUDBURY_DISTRICT.
 */
const RAC_CD_ALIASES = {
  'leeds & grenville': 'Leeds and Grenville',
  'lennox-addington': 'Lennox and Addington',
  'prescott & russell': 'Prescott and Russell',
  'stormont, dundas & glengarry': 'Stormont, Dundas and Glengarry',
  sudbury: 'Greater Sudbury / Grand Sudbury',
  // RAC lists each half of these two census divisions as its own row.
  brantford: 'Brant',
  haldimand: 'Haldimand-Norfolk',
  norfolk: 'Haldimand-Norfolk',
};

/** RAC's rows carry the kind of municipality; the census name does not. */
const normaliseCd = n =>
  n.trim().toLowerCase()
    .replace(/\./g, '')
    .replace(/^(city|town|township|municipality) of /, '')
    .replace(/^united counties of /, '')
    .replace(/ (regional municipality|region municipality|united counties|county|counties|district|island)$/, '')
    .replace(/\s+/g, ' ');

/**
 * Sudbury District, which RAC's table does not name.
 *
 * The table lists the City of Greater Sudbury but not the district wrapping
 * around it, so taken literally it leaves one of Ontario's largest census
 * divisions in no section at all — a hole in the map, and the failure that is
 * invisible in a rendered picture. ARRL's own section-boundaries page settles
 * it: Ontario North covers everything northwest of a line from Killarney
 * through Sudbury and North Bay, and Killarney is a municipality of Sudbury
 * District. So is Espanola, and so is Chapleau.
 *
 * Kept here rather than in the data file because that file is a transcription
 * and this is an inference — the same reason ARRL's own three spelling quirks
 * are reconciled in this script instead of edited into their county list.
 */
const SUDBURY_DISTRICT = { cd: 'Sudbury', section: 'ONN' };

/**
 * Turn RAC's table into section → census-division lists.
 *
 * Verifies both directions for the same reasons the county resolver does, with
 * one Ontario-specific allowance: two census divisions are named twice, once
 * per half (Brant as Brantford and Brant, Haldimand-Norfolk as Haldimand and
 * Norfolk). That is only ever benign when both halves land in the same
 * section, so claiming one division for two *different* sections still fails.
 */
function resolveOntario(table, split, cdsInProvince) {
  const byName = new Map();
  for (const c of cdsInProvince) byName.set(normaliseCd(c.properties.name), c);

  const out = {};
  const claimedBy = new Map();
  const claim = (section, raw, viaAlias = true) => {
    const key = normaliseCd(raw);
    // The alias table translates RAC's vocabulary, so it applies only to RAC's
    // own rows. Reading a census name through it would fold Sudbury District
    // into Greater Sudbury, which is the one distinction that matters here.
    const name = (viaAlias && RAC_CD_ALIASES[key]) || raw.trim();
    const cd = byName.get(normaliseCd(name));
    if (!cd) {
      throw new Error(`CA-ON ${section}: no census division named "${raw.trim()}" — ` +
        `check it against the Statistics Canada name, or add an alias`);
    }
    const already = claimedBy.get(cd.id);
    if (already && already !== section) {
      throw new Error(`CA-ON: ${cd.properties.name} is in both ${already} and ${section}`);
    }
    if (already) return; // the second half of a division RAC lists twice
    claimedBy.set(cd.id, section);
    (out[section] ??= []).push(cd.id);
  };

  for (const [section, rows] of Object.entries(table)) {
    out[section] = [];
    for (const raw of rows) claim(section, raw);
  }
  claim(SUDBURY_DISTRICT.section, SUDBURY_DISTRICT.cd, false);

  // The divisions RAC's rule splits between two sections are drawn as their
  // own outline, so they are accounted for without being claimed.
  const splitIds = new Set();
  for (const name of Object.keys(split)) {
    const cd = byName.get(normaliseCd(name));
    if (!cd) throw new Error(`CA-ON: no census division named "${name}" to split`);
    if (claimedBy.has(cd.id)) {
      throw new Error(`CA-ON: ${name} is both split and claimed by ${claimedBy.get(cd.id)}`);
    }
    splitIds.add(cd.id);
  }

  const unclaimed = cdsInProvince
    .filter(c => !claimedBy.has(c.id) && !splitIds.has(c.id))
    .map(c => c.properties.name);
  if (unclaimed.length) {
    throw new Error(`CA-ON: ${unclaimed.length} census divisions belong to no section — ` +
      unclaimed.join(', '));
  }
  return { resolved: out, splitIds };
}

/**
 * Canada's census divisions, as features carrying their province code.
 *
 * The download is a 52 MB zip holding all 293 of them, cached like any other
 * source. The shapes are already NAD83 lat/lon — no projection to undo — and
 * NAD83 sits within a couple of metres of WGS84, which is nothing at the zoom
 * this map draws.
 *
 * Every Canadian section is built from this one file, provinces included, and
 * that is the point. Ontario's sections have to come from here because they
 * are carved by census division and Natural Earth stops at the province; if
 * its *neighbours* came from Natural Earth instead, the two outlines would not
 * coincide and a strip belonging to neither would open along the border. That
 * is not hypothetical — it measured 1.9% of the Ottawa River border and 4.8%
 * of the Manitoba one before the provinces moved here too. One source per
 * country means every internal border is the same arcs on both sides, and
 * topology() below welds them.
 */
async function canadianCensusDivisions() {
  fs.mkdirSync(cache, { recursive: true });
  const zip = path.join(cache, `${STATCAN_CD_BASE}.zip`);
  if (!fs.existsSync(zip)) {
    process.stderr.write('fetching Statistics Canada census divisions…\n');
    const res = await fetch(STATCAN_CD);
    if (!res.ok) throw new Error(`census division fetch failed: ${res.status}`);
    fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  }
  const got = crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
  if (got !== STATCAN_CD_SHA256) {
    throw new Error(`census division file is not the pinned one\n` +
      `  expected ${STATCAN_CD_SHA256}\n  got      ${got}\n` +
      `  delete .cache/${STATCAN_CD_BASE}.zip and rebuild, or update the pin deliberately`);
  }

  const dir = path.join(cache, STATCAN_CD_BASE);
  if (!fs.existsSync(path.join(dir, `${STATCAN_CD_BASE}.shp`))) {
    fs.mkdirSync(dir, { recursive: true });
    // No unzip binary is guaranteed on a build host, and the two members this
    // needs are plain deflate; inflateRawSync is enough and avoids a dependency.
    const buf = fs.readFileSync(zip);
    for (const ext of ['shp', 'dbf']) {
      const member = `${STATCAN_CD_BASE}.${ext}`;
      const at = buf.indexOf(Buffer.from(member));
      if (at < 0) throw new Error(`${member} not found in the census division zip`);
      const lh = at - 30;                       // back up over the local file header
      const method = buf.readUInt16LE(lh + 8);
      const nameLen = buf.readUInt16LE(lh + 26);
      const extraLen = buf.readUInt16LE(lh + 28);
      const start = lh + 30 + nameLen + extraLen;
      const compressed = buf.readUInt32LE(lh + 18);
      const body = buf.subarray(start, start + compressed);
      fs.writeFileSync(path.join(dir, member),
        method === 0 ? body : zlib.inflateRawSync(body));
    }
  }

  const src = await shapefile.open(
    path.join(dir, `${STATCAN_CD_BASE}.shp`),
    path.join(dir, `${STATCAN_CD_BASE}.dbf`),
    { encoding: 'latin1' });
  const out = [];
  for (let r = await src.read(); !r.done; r = await src.read()) {
    out.push({
      type: 'Feature',
      id: r.value.properties.CDUID,
      properties: { name: r.value.properties.CDNAME, pr: r.value.properties.PRUID },
      geometry: r.value.geometry,
    });
  }
  if (out.length !== 293) {
    throw new Error(`expected Canada's 293 census divisions, got ${out.length}`);
  }
  const ontario = out.filter(f => f.properties.pr === '35');
  if (ontario.length !== 49) {
    throw new Error(`expected Ontario's 49 census divisions, got ${ontario.length}`);
  }
  return out;
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
  const cds = await canadianCensusDivisions();
  const countyTable = loadCountyTable();
  const ontarioTable = loadOntarioTable();

  const usStates = new Map(us.objects.states.geometries.map(g => [g.id, g]));
  const usCounties = us.objects.counties.geometries;
  // Canada gets its own topology so census divisions can be *dissolved* into a
  // section rather than merely collected into one. tc.merge drops the borders
  // between them; concatenating their rings keeps every one, and Leaflet
  // strokes every ring — the Golden Horseshoe drew as its seven constituent
  // municipalities with the section boundary nowhere distinguishable among
  // them. This is the same call the US counties already went through.
  const caTopo = ts.topology({ cds: { type: 'FeatureCollection', features: cds } });
  const caGeom = new Map(caTopo.objects.cds.geometries.map(g => [g.id, g]));
  const mergeCds = list => tc.merge(caTopo, list.map(c => {
    const g = caGeom.get(c.id);
    if (!g) throw new Error(`census division ${c.id} is missing from the topology`);
    return g;
  }));
  const cdsByProvince = new Map();
  for (const c of cds) {
    if (!cdsByProvince.has(c.properties.pr)) cdsByProvince.set(c.properties.pr, []);
    cdsByProvince.get(c.properties.pr).push(c);
  }

  /** Features, in the shape the map consumes. */
  const features = [];
  const accounted = new Set();
  const dissolved = [];

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

  for (const [code, prCodes] of Object.entries(CA_WHOLE)) {
    const inProvince = prCodes.flatMap(pr => {
      const list = cdsByProvince.get(pr);
      if (!list) throw new Error(`${code}: no Canadian province with PRUID ${pr}`);
      return list;
    });
    features.push({
      type: 'Feature', id: code,
      properties: { kind: 'section' },
      geometry: mergeCds(inProvince),
    });
    accounted.add(code);
  }

  // ── carved jurisdictions ──────────────────────────────────────────────────
  for (const j of CARVED) {
    const table = countyTable[j.key];
    if (table && j.fips) {
      const inState = usCounties.filter(c => c.id.slice(0, 2) === j.fips);
      const resolved = resolveJurisdiction(j.key, table, inState);
      for (const [code, fipsCodes] of Object.entries(resolved)) {
        const set = new Set(fipsCodes);
        features.push({
          type: 'Feature', id: code,
          properties: { kind: 'section' },
          geometry: tc.merge(us, inState.filter(c => set.has(c.id))),
        });
        accounted.add(code);
        dissolved.push(`${code}:${fipsCodes.length}`);
      }
      continue;
    }
    if (j.key === 'CA-ON' && ontarioTable) {
      const ontario = cdsByProvince.get('35');
      const { resolved, splitIds } = resolveOntario(
        ontarioTable.sections, ontarioTable.split, ontario);
      const byId = new Map(ontario.map(c => [c.id, c]));
      for (const [code, ids] of Object.entries(resolved)) {
        features.push({
          type: 'Feature', id: code,
          properties: { kind: 'section' },
          geometry: mergeCds(ids.map(id => byId.get(id))),
        });
        accounted.add(code);
        dissolved.push(`${code}:${ids.length}`);
      }
      // A division RAC splits between two sections along something that is not
      // a division boundary. Drawn once, neutrally, naming both — the same
      // treatment as a jurisdiction awaiting its list, and for the same reason.
      for (const id of splitIds) {
        const cd = byId.get(id);
        const s = ontarioTable.split[cd.properties.name];
        features.push({
          type: 'Feature', id: `CA-ON-${id}`,
          properties: {
            kind: 'pending',
            name: `${cd.properties.name} District`,
            sections: s.sections,
          },
          geometry: cd.geometry,
        });
      }
      continue;
    }

    // No table yet: draw the jurisdiction, name what is inside it.
    const geometry = j.fips
      ? tc.merge(us, [usStates.get(j.fips)])
      : mergeCds(cdsByProvince.get(j.pr));
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
  topo = tsimp.simplify(topo, TOLERANCE);
  topo = tc.quantize(topo, 1e4);

  const out = tc.feature(topo, topo.objects.sections);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));

  const filled = out.features.filter(f => f.properties.kind === 'section').length;
  const pending = out.features.filter(f => f.properties.kind === 'pending');
  // A jurisdiction still awaiting its list has no section filled anywhere; a
  // shared division names sections that are already drawn around it.
  const filledCodes = new Set(
    out.features.filter(f => f.properties.kind === 'section').map(f => f.id));
  const shared = pending.filter(f => f.properties.sections.every(s => filledCodes.has(s)));
  const awaiting = pending.filter(f => !shared.includes(f));
  const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
  process.stderr.write(
    `${OUT.replace(root + '/', '')}  ${kb} KB\n` +
    `  ${filled} sections with a boundary\n` +
    (awaiting.length
      ? `  ${awaiting.reduce((n, f) => n + f.properties.sections.length, 0)} awaiting a county list, ` +
        `in ${awaiting.length} jurisdictions: ${awaiting.map(f => f.properties.name).join(', ')}\n`
      : '  every section has a boundary\n') +
    (shared.length
      ? `  ${shared.length} drawn as shared, split by something that is not an ` +
        `administrative line: ${shared.map(f => f.properties.name).join(', ')}\n`
      : '') +
    `  ${sections.length} sections accounted for\n` +
    `  ${dropped} islands below ${MIN_ISLAND_KM2} km² dropped as sub-pixel\n` +
    (dissolved.length
      ? `  dissolved from counties: ${dissolved.join(' ')}\n`
      : ''));
};

main().catch(e => { process.stderr.write(`build failed: ${e.message}\n`); process.exit(1); });
