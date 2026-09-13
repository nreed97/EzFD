/**
 * Which section labels are worth drawing at a given zoom.
 *
 * At the map's default zoom of 3, **54 of the 85 labels overlap another one** —
 * 105 overlapping pairs, worst through the Northeast where a dozen sections are
 * smaller than their own abbreviations. That is not a crowded corner, it is
 * most of the map, and it is the view an operator lands on. By zoom 5 it is 9
 * of 85 and by zoom 6 effectively none, so the problem is entirely one of scale.
 *
 * Leader lines were the other candidate and are what a printed atlas would do.
 * They need a placement solver to decide where each displaced label goes, and
 * at zoom 3 they would mean fanning fifteen labels out into the Atlantic
 * without crossing each other. Hiding a label that cannot be read anyway is
 * what web maps do instead, and it costs nothing here because the section
 * polygon answers the same question on hover.
 *
 * Two properties matter more than the packing being optimal:
 *
 * **Stable.** Placement never consults whether a section is worked. A label
 * that vanished because someone logged a contact — or worse, one that
 * reshuffled its neighbours — would make the map twitch during a run. Order is
 * the caller's, which is `SECTION_DATA`'s, which is fixed.
 *
 * **Monotonic in zoom.** Zooming in reveals labels and never takes one away.
 * That does not fall out of greedy placement, which was the first attempt and
 * was wrong: gaps do all grow with zoom, but a label that was *blocked* at one
 * zoom becomes placeable at the next, and can then evict a label that had been
 * drawn all along. Measured, VT and DE were drawn at zoom 3 and disappeared at
 * zoom 4, and ENY between 4 and 5 — zooming in to read a label made it vanish.
 * So each zoom level starts from the previous level's set, already placed, and
 * only fills the gaps around it. Monotonic by construction rather than by
 * argument, which is what the test checks.
 */

export interface LabelPoint {
  section: string;
  lat: number;
  lon: number;
}

/** 9px monospace measures ~5.4px per character; the box adds 4px of padding
 *  each side and a 1px border. Kept here rather than in the component so the
 *  test measures the same box the map draws. */
export const LABEL_CHAR_PX = 5.4;
export const LABEL_PAD_PX = 10;
export const LABEL_HEIGHT_PX = 15;

export function labelWidth(section: string): number {
  return section.length * LABEL_CHAR_PX + LABEL_PAD_PX;
}

/**
 * Web Mercator pixel position at `zoom`, for Leaflet's 256px tiles. The same
 * projection Leaflet uses, reimplemented rather than imported so this stays a
 * pure function a test can drive without a DOM or a map instance.
 */
export function projectPx(lat: number, lon: number, zoom: number): [number, number] {
  const n = 256 * 2 ** zoom;
  const x = ((lon + 180) / 360) * n;
  const s = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
  return [x, y];
}

/** The zoom the map opens at, and the floor placement is built up from. */
export const BASE_ZOOM = 3;

function fill(points: LabelPoint[], zoom: number, already: Set<string>): Set<string> {
  const kept: { x: number; y: number; w: number }[] = [];
  const out = new Set<string>();

  // Whatever survived the last zoom goes down first, so it cannot be evicted
  // by a label that has only now become placeable.
  const order = [...points.filter(p => already.has(p.section)),
                 ...points.filter(p => !already.has(p.section))];

  for (const p of order) {
    const [x, y] = projectPx(p.lat, p.lon, zoom);
    const w = labelWidth(p.section);
    const clashes = kept.some(k =>
      Math.abs(k.x - x) < (k.w + w) / 2 &&
      Math.abs(k.y - y) < LABEL_HEIGHT_PX);
    if (clashes) continue;
    kept.push({ x, y, w });
    out.add(p.section);
  }
  return out;
}

/**
 * The sections whose labels should be drawn at this zoom.
 *
 * Built up one whole zoom level at a time from `BASE_ZOOM`, because the set at
 * each level is what gives the next level its priority. Fractional zooms floor
 * to the level below: a half-zoomed map shows what the level it has passed
 * showed, never more, so nothing appears and disappears mid-gesture.
 */
export function placeLabels(points: LabelPoint[], zoom: number): Set<string> {
  const top = Math.max(BASE_ZOOM, Math.floor(zoom));
  let kept = new Set<string>();
  for (let z = BASE_ZOOM; z <= top; z++) kept = fill(points, z, kept);
  return kept;
}
