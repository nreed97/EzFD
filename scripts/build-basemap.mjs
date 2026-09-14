#!/usr/bin/env node
/**
 * Build the basemap the section map draws on.
 *
 *   node scripts/build-basemap.mjs
 *
 * Writes public/basemap.geo.json — world land, as one shape, so the map has
 * ground under it without fetching a raster tile from anybody.
 *
 * ## Why the app carries its own basemap
 *
 * It used to draw OpenStreetMap's raster tiles, and before that CARTO's. Three
 * separate problems pointed at the same answer:
 *
 *   * **A distributed app should not point every install at someone else's
 *     tile server.** CARTO was open and then was not, and the refusal arrived
 *     as *"API key required" rendered into the tile image* — the map still
 *     drew, still placed all 85 sections correctly, and said nothing. OSM's
 *     tile usage policy is a volunteer service with its own limits, and EzFD
 *     is cloned and deployed by whoever wants it. The same failure was waiting.
 *   * **Firefox.** Measured on a real event: with tiles, panning dropped 11 of
 *     319 frames at a p95 of 30ms; with no tiles and everything else identical,
 *     0 of 517 at 6.1ms. Neither renderer choice (SVG vs Canvas), nor Leaflet's
 *     tile options (`updateWhenIdle`, `updateWhenZooming`, `keepBuffer`), nor
 *     forcing the tile pane onto its own compositor layer changed it. The cost
 *     is Firefox repainting raster tiles under a pan transform, and the only
 *     thing that removed it was removing the tiles.
 *   * **Offline field servers.** Tiles never loaded there anyway. The sections
 *     always drew, because they ship with the app; now the ground does too.
 *
 * ## The source
 *
 * Natural Earth 110m land, via the `world-atlas` package on npm — the same
 * public-domain, pre-built-TopoJSON shape as the `us-atlas` the sections come
 * from, and pinned in package.json for the same reason: a basemap that changes
 * underneath you is worse than one that is out of date.
 *
 * **Land, not countries.** `countries-110m` would draw Mexico's border rather
 * than leaving it as unmarked ground, at 145 KB and 177 features against
 * 56 KB and one. One feature is one SVG path, and path count is the thing the
 * Firefox measurements above say to be careful with. The borders that matter
 * here — every US state and Canadian province — are already drawn by the
 * sections on top.
 */
import { readFileSync, writeFileSync } from 'fs';
import * as tc from 'topojson-client';
import * as ts from 'topojson-simplify';

/**
 * An absolute simplification threshold, and it must stay absolute.
 *
 * `SECTION_GEO_TOLERANCE` in build-section-geo.mjs has the same note and the
 * same reason: a percentile ("keep the most significant tenth of the
 * vertices") measures the file rather than the map, so changing the source
 * silently recalibrates every shape in it. Calibrated against rendered output
 * at the zooms this map opens at — below ~0.02 the file stops shrinking
 * usefully, above ~0.15 Hudson Bay and the Gulf coast start to mangle.
 */
const BASEMAP_TOLERANCE = 0.05;

/** Two decimal places is about a kilometre, which is finer than a 110m-scale
 *  outline resolves. It is worth 11 KB of the file. */
const COORD_DP = 2;

const topo = JSON.parse(readFileSync('node_modules/world-atlas/land-110m.json', 'utf8'));
const simplified = ts.simplify(ts.presimplify(topo), BASEMAP_TOLERANCE);
const land = tc.feature(simplified, simplified.objects.land);

const round = (c) => Array.isArray(c[0])
  ? c.map(round)
  : c.map(v => Math.round(v * 10 ** COORD_DP) / 10 ** COORD_DP);

/**
 * Make a ring continuous across the antimeridian.
 *
 * Natural Earth keeps every longitude inside [-180, 180], so the ring that
 * carries Eurasia steps from +179 to -179 where Russia crosses the date line.
 * Drawn literally that is a line all the way back across the world, and it
 * renders as a band of ocean slicing through the Arctic — which is exactly
 * what the first build of this file did. `scripts/test-sections.cjs` already
 * guards the section file against the same thing, for the same reason: Alaska
 * and PAC straddle the antimeridian too, and only render because each island
 * is its own ring.
 *
 * Walking the ring and carrying an offset keeps it continuous, at the cost of
 * coordinates running past ±180, which Leaflet draws correctly.
 *
 * The offset then has to be taken back out, and leaving that step out is a
 * second, quieter bug: the ring carrying Afro-Eurasia begins in Chukotka, so
 * every point after the date line picks up -360 and the whole of Europe and
 * Africa is written at around -350. Leaflet draws that exactly where it says,
 * one world-width to the left of where it belongs — off the side of the map,
 * with an empty Eastern Hemisphere left behind. Re-centring on the ring's own
 * midpoint puts it back; Afro-Eurasia is then -18° to 190°, which is genuinely
 * over half the globe wide and is drawn once, running past the date line.
 */
function unwrap(ring) {
  let offset = 0;
  const out = [ring[0]];
  for (let i = 1; i < ring.length; i++) {
    const step = ring[i][0] - ring[i - 1][0];
    if (step >  180) offset -= 360;
    if (step < -180) offset += 360;
    out.push([ring[i][0] + offset, ring[i][1]]);
  }
  const lons = out.map(c => c[0]);
  const mid = (Math.min(...lons) + Math.max(...lons)) / 2;
  const shift = -Math.round(mid / 360) * 360;
  return shift ? out.map(([x, y]) => [x + shift, y]) : out;
}

/** Antarctica is dropped rather than unwrapped. Closing a ring that encircles
 *  a pole needs points carried down to the projection limit, which is real
 *  work for a landmass no ARRL or RAC section is on, and it is the other half
 *  of what drew a stray line across the first build. */
const ANTARCTIC_LIMIT = -60;

const features = land.type === 'FeatureCollection' ? land.features : [land];
let dropped = 0, unwrapped = 0;
for (const f of features) {
  const polys = f.geometry.type === 'MultiPolygon'
    ? f.geometry.coordinates : [f.geometry.coordinates];
  const kept = [];
  for (const poly of polys) {
    const rings = [];
    for (const ring of poly) {
      if (Math.min(...ring.map(c => c[1])) < ANTARCTIC_LIMIT) { dropped++; continue; }
      const wraps = ring.some((c, i) => i > 0 && Math.abs(c[0] - ring[i - 1][0]) > 180);
      rings.push(wraps ? (unwrapped++, unwrap(ring)) : ring);
    }
    if (rings.length) kept.push(rings);
  }
  f.geometry = { type: 'MultiPolygon', coordinates: kept };
  f.geometry.coordinates = round(f.geometry.coordinates);
  f.properties = {};
}
console.log(`  unwrapped ${unwrapped} ring(s) across the antimeridian, ` +
            `dropped ${dropped} below ${ANTARCTIC_LIMIT}°`);

const out = { type: 'FeatureCollection', features };
const json = JSON.stringify(out);
writeFileSync('public/basemap.geo.json', json);

const rings = features.reduce((n, f) => n + (f.geometry.type === 'MultiPolygon'
  ? f.geometry.coordinates.reduce((m, p) => m + p.length, 0)
  : f.geometry.coordinates.length), 0);
const verts = JSON.stringify(features).match(/\[-?[\d.]+,-?[\d.]+\]/g)?.length ?? 0;
console.log(`public/basemap.geo.json — ${features.length} feature(s), ${rings} rings, ` +
            `${verts} vertices, ${Math.round(json.length / 1024)} KB`);
