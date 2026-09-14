'use client';

import { useEffect, useMemo, useState } from 'react';
import { MapContainer, Marker, Tooltip, GeoJSON, useMap, AttributionControl } from 'react-leaflet';
import L from 'leaflet';
import type { LatLngExpression, PathOptions } from 'leaflet';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import 'leaflet/dist/leaflet.css';
import { SECTION_DATA } from '@/lib/sections';
import { placeLabels, BASE_ZOOM } from '@/lib/mapLabels';
import { useLightMode } from '@/lib/useLightMode';

interface Props {
  workedSections: string[];
}

/**
 * Section boundaries, fetched rather than bundled.
 *
 * ~164 KB of polygons that only the map view needs, so it stays out of the
 * logger's bundle — a club logging from a phone on a hotspot should not pay
 * for a map they never open. Built by `scripts/build-section-geo.mjs` and
 * checked in, so a field server with no internet still has it: the tiles
 * underneath need the network, the sections do not.
 *
 * Two kinds of feature. A `section` is one ARRL/RAC section and fills with
 * whether it has been worked. A `pending` outline is an area whose internal
 * boundaries are not known: either a jurisdiction whose county list has not
 * been transcribed, or an administrative unit two sections split along a line
 * that is not an administrative one — Nipissing District, cut between Ontario
 * East and Ontario North by Algonquin Park, at the time of writing. It draws
 * neutral and dashed rather than picking a colour, because "we do not know
 * where this boundary runs" is not the same as "nobody has worked it", and a
 * confident fill would be indistinguishable from a real one.
 *
 * A pending outline names the sections inside it on hover. Every section has a
 * label with a tooltip of its own, so without one this is the only shape on
 * the map that answers nothing when you ask it what it is.
 */
interface SectionProps {
  kind: 'section' | 'pending';
  name?: string;
  sections?: string[];
}
type SectionFeature = Feature<Geometry, SectionProps>;

/**
 * World land, so the map has ground under it without a raster tile.
 *
 * 56 KB, one feature, built by scripts/build-basemap.mjs from Natural Earth
 * via `world-atlas`. Fetched rather than bundled for the same reason the
 * sections are: only this view needs it, and a club logging from a phone on a
 * hotspot should not pay for a map they never open.
 */
function useBasemap() {
  const [land, setLand] = useState<FeatureCollection<Geometry> | null>(null);
  useEffect(() => {
    let live = true;
    // A failure here costs the ground, not the map: the sections still draw,
    // which is the half that carries the information.
    fetch('/basemap.geo.json')
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (live) setLand(j); })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  return land;
}

function useSectionShapes() {
  const [shapes, setShapes] = useState<FeatureCollection<Geometry, SectionProps> | null>(null);
  useEffect(() => {
    let live = true;
    // The map is useful without this — the labels and the basemap are already
    // drawn — so a failure degrades to what the map was before rather than
    // showing an error over a working screen.
    fetch('/sections.geo.json')
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (live) setShapes(j); })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  return shapes;
}

/**
 * The zoom, as state, so label placement can respond to it.
 *
 * This replaces a component that called `map.setView([39.5, -98.35], 3)` on
 * mount — the same centre and zoom `MapContainer` is already given as props,
 * so it re-did on mount exactly what had just been done.
 */
function useMapZoom() {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  useEffect(() => {
    const onZoom = () => setZoom(map.getZoom());
    map.on('zoomend', onZoom);
    return () => { map.off('zoomend', onZoom); };
  }, [map]);
  return zoom;
}

/** Renders the section labels for the current zoom. Inside the map, because
 *  that is where the zoom lives. */
function SectionLabels({ workedSet, lightMode }: {
  workedSet: Set<string>; lightMode: boolean;
}) {
  const zoom = useMapZoom();
  // Placement order is SECTION_DATA's, which is fixed, which is what keeps a
  // label from moving because somebody logged a contact. See lib/mapLabels.ts.
  const points = useMemo(() => Object.entries(SECTION_DATA)
    .map(([section, info]) => ({ section, lat: info.lat, lon: info.lon })), []);
  const shown = useMemo(() => placeLabels(points, zoom), [points, zoom]);

  return (
    <>
      {Object.entries(SECTION_DATA).map(([section, info]) => {
        if (!shown.has(section)) return null;
        const worked = workedSet.has(section);
        return (
          <Marker
            key={section}
            position={[info.lat, info.lon] as LatLngExpression}
            icon={sectionIcon(section, worked, lightMode)}
          >
            <Tooltip>
              <span className="font-mono font-bold">{section}</span>
              {' — '}{info.name}
              {worked ? ' ✓' : ''}
            </Tooltip>
          </Marker>
        );
      })}
    </>
  );
}

/**
 * A section's label box.
 *
 * The unworked label used to be `#52525b` on a near-black box: **2.32:1** for
 * 9px monospace, under even the 3:1 floor for large text, while the worked
 * label sat at 10.48:1. That is exactly backwards — the sections an operator
 * is hunting are the unworked ones, so the labels that mattered most were the
 * ones that could not be read, and only in dark mode, which is the default.
 * `#a1a1aa` measures 6.99:1 and is the same zinc the dim section border uses.
 *
 * The worked box's own border was `#d97706` on `#fbbf24` — 1.91:1, the same
 * mistake as the section borders, in miniature. The text carries the box, so
 * this only ever cost the box its edge, but there is no reason to keep it.
 */
function sectionIcon(section: string, worked: boolean, lightMode: boolean) {
  let bg: string, color: string, border: string;
  if (worked) {
    bg = '#fbbf24'; color = '#1c1917'; border = '#92400e';
  } else if (lightMode) {
    bg = 'rgba(255,255,255,0.9)'; color = '#3f3f46'; border = '#a1a1aa';
  } else {
    bg = 'rgba(24,24,27,0.85)'; color = '#a1a1aa'; border = '#52525b';
  }
  const weight = worked ? '700' : '500';
  return L.divIcon({
    className: '',
    iconSize: [0, 0],
    iconAnchor: [0, 0],
    html: `<div style="position:relative;width:0;height:0">
      <span style="
        position:absolute;
        left:0;top:0;
        transform:translate(-50%,-50%);
        background:${bg};
        color:${color};
        border:1px solid ${border};
        padding:1px 4px;
        border-radius:3px;
        font-size:9px;
        font-weight:${weight};
        font-family:monospace;
        white-space:nowrap;
        line-height:1.5;
        box-shadow:${worked ? '0 0 6px rgba(251,191,36,0.4)' : 'none'};
      ">${section}</span>
    </div>`,
  });
}

export default function MapView({ workedSections }: Props) {
  const workedSet = useMemo(
    () => new Set(workedSections.map(s => s.toUpperCase())), [workedSections]);
  // What the layers are keyed on. Sorted so a reordering of the same sections
  // is not mistaken for a change.
  const workedKey = useMemo(() => [...workedSet].sort().join(','), [workedSet]);
  const lightMode = useLightMode();
  const shapes = useSectionShapes();
  const basemap = useBasemap();

  // The fill says whether a section has been worked. The border says where the
  // section ends. They are two different questions and they get two different
  // channels, which is why this does not need a colour per section the way a
  // map that puts identity in the fill does.
  //
  // They used to share one: worked drew an amber fill under a hardcoded amber
  // `#b45309` border, while every other state flipped its border with the
  // theme. The fill is translucent over a basemap whose lightness *inverts*
  // between themes — dark mode is a filter on the tile pane and the overlay is
  // not filtered — so in dark mode the amber fill blended toward the dark
  // tiles and landed on the border's own luminance: **1.02:1**, the same
  // lightness, an invisible line. Light mode measured 3.59:1, which is why it
  // only looked broken in the theme that is the default. Two adjacent worked
  // sections read as one blob.
  //
  // So every border is now a neutral chosen against the *page* rather than
  // against the fill, and it flips with the theme like the others always did.
  // No constant works: near-black is 4.05 on dark worked but 1.17 on dark
  // unworked, whose fill is itself near-black, and near-white is the mirror.
  // A darker amber does not rescue it either — `#78350f` is 1.85 in dark. Nor
  // does any mid-grey: `#71717a` scores the same 1.02 the amber did.
  //
  // Two shades rather than one, because a single strong neutral made the
  // *empty* half of the map the loudest thing on it — 85 bright hairlines over
  // nothing, which is the glare this interface avoids after sunset. Worked
  // sections get the strong shade and unworked the dim one; the unworked fill
  // sits at the extreme of the lightness range, so it needs far less to read.
  // Measured: dark 3.87 worked / 6.66 unworked, light 14.21 / 6.78 — every one
  // clear of 3:1, with the bright line where the eye is meant to go.
  const strongBorder = lightMode ? '#09090b' : '#e4e4e7';
  const dimBorder    = lightMode ? '#52525b' : '#a1a1aa';

  // Worked is the thing being read, so it is the only strong fill. Unworked is
  // a wash light enough to leave the basemap legible underneath — the shape and
  // its border carry the information there, not the fill, and 85 opaque
  // polygons would just be a map of nothing.
  const fillStyle = useMemo(() => (feature?: SectionFeature): PathOptions => {
    if (feature?.properties?.kind === 'pending') {
      return { stroke: false,
               fillColor: lightMode ? '#e4e4e7' : '#18181b', fillOpacity: 0.2 };
    }
    const worked = !!feature?.id && workedSet.has(String(feature.id));
    return worked
      ? { stroke: false, fillColor: '#fbbf24', fillOpacity: 0.5 }
      : { stroke: false,
          fillColor: lightMode ? '#f4f4f5' : '#27272a', fillOpacity: 0.15 };
  }, [workedSet, lightMode]);

  // Borders are their own layers, drawn after every fill, because Leaflet
  // renders all 85 polygons into one SVG group in document order and a stroke
  // is centred on its path — so half of each border sat inside the neighbour
  // drawn after it and was washed by that neighbour's 50% amber. That alone
  // took light mode from 3.59 to 2.00.
  //
  // Dim first, strong second, and that order is load-bearing rather than
  // incidental: a worked section and an unworked neighbour both draw the
  // boundary between them, so with one layer the shade of every shared edge
  // would depend on which polygon the file happened to list last. Drawing the
  // strong tier afterwards makes the outline of the worked region always the
  // strong line, which is also what it should be.
  const borderStyle = useMemo(() => (feature?: SectionFeature): PathOptions => {
    const pending = feature?.properties?.kind === 'pending';
    const worked = !pending && !!feature?.id && workedSet.has(String(feature.id));
    return {
      fill: false,
      color: worked ? strongBorder : dimBorder,
      weight: pending ? 1 : 0.8,
      // "We do not know where this boundary runs" still reads as a dashed
      // line rather than a colour of its own.
      ...(pending ? { dashArray: '4 3' } : {}),
    };
  }, [workedSet, strongBorder, dimBorder]);

  const isWorked = useMemo(() => (feature: SectionFeature) =>
    feature.properties?.kind !== 'pending' &&
    !!feature.id && workedSet.has(String(feature.id)), [workedSet]);

  // The map carries its own ground rather than fetching raster tiles.
  //
  // It drew OpenStreetMap's tiles until 2026-09-14, and CARTO's before that.
  // CARTO was open and then was not, and the refusal arrived as *"API key
  // required" rendered into the tile image* — the map still drew, still placed
  // all 85 sections correctly, and reported nothing. Moving to OSM moved that
  // risk rather than removing it: theirs is a volunteer service with a usage
  // policy, and EzFD is cloned and deployed by whoever wants it, so every
  // install pointed at their servers.
  //
  // Firefox settled it. Measured on a real event, panning with tiles dropped
  // 11 of 319 frames at a p95 of 30ms; with no tiles and everything else
  // identical, 0 of 517 at 6.1ms. Not the renderer — SVG and Canvas measured
  // the same. Not Leaflet's tile options, nor forcing the tile pane onto its
  // own compositor layer; none of those moved it. The cost is Firefox
  // repainting raster tiles under a pan transform, and removing the tiles is
  // what removed it.
  //
  // These two colours are not chosen freshly. They are what the old basemap
  // *rendered as* underneath the section fills — OSM's land is #f2efe9, and
  // #1c1a16 is what the dark-mode filter turned that into. The worked/unworked
  // border contrast was calibrated against those exact values, so keeping them
  // means that calibration still holds rather than quietly needing redoing.
  const land  = lightMode ? '#f2efe9' : '#1c1a16';

  // The ocean cannot be chosen freely either, but for the opposite reason: the
  // land is pinned, so the ocean is what has to make a coastline visible.
  // Light mode manages it by lightness -- #9ab8d2 sits 1.80:1 from the land.
  // Dark mode cannot: the land is already so dark that even pure black reaches
  // only 1.21:1, so there the coast reads as a *line* rather than as an edge
  // between two fills, which is what dark basemaps generally do anyway.
  const ocean = lightMode ? '#9ab8d2' : '#08090b';
  // Quieter than the dim section border in both themes, and blue-grey in light
  // so it reads as a water edge rather than one more section line. Coast is
  // context; the sections are the content, and the hierarchy should say so.
  const coast = lightMode ? '#7d8794' : '#52525b';
  const basemapStyle = useMemo((): PathOptions => ({
    fillColor: land, fillOpacity: 1, color: coast, weight: 0.6,
  }), [land, coast]);

  return (
    <MapContainer
      // Dark mode used to be a CSS filter over the one published tile style.
      // With the ground drawn from our own data it is just a colour, which is
      // both cheaper and more controllable — and it still matters beyond
      // taste: this interface is dark by default and has a night mode for
      // keeping dark adaptation after sunset, and a white map at 2am undoes
      // that.
      center={[39.5, -98.35]}
      // The same constant label placement builds up from, so the zoom the map
      // opens at and the zoom placement treats as the floor cannot drift apart.
      zoom={BASE_ZOOM}
      // The container background is the ocean: everything not drawn is water.
      style={{ height: '100%', width: '100%', background: ocean }}
      zoomControl={true}
      attributionControl={false}
    >
      {/* Natural Earth is public domain and asks for nothing, but naming where
          the shapes came from is the honest thing to do and it is the only
          line on screen that says this map is the app's own. */}
      <AttributionControl position="bottomright" prefix={false} />
      {/* The ground, under everything. One feature, so one path. */}
      {basemap && (
        <GeoJSON
          key={`land-${lightMode}`}
          data={basemap}
          style={basemapStyle as never}
          interactive={false}
          attribution="Land: Natural Earth · Sections: ARRL/RAC"
        />
      )}
      {/* Under the markers: Leaflet draws vector overlays below the marker
          pane, so the section labels stay legible on top of their own fill.
          Keyed on what it is drawn from, so a change to either redraws it —
          Leaflet caches path styles otherwise.
          The key is the set, not its size. A count is not the state: delete
          the last QSO for one section while another operator logs a new one
          and the recompute hands back a set of the same length with different
          members, which left the map drawing the old one with nothing to say
          it was stale. */}
      {shapes && (
        <GeoJSON
          key={`fill-${workedKey}-${lightMode}`}
          data={shapes}
          style={fillStyle as never}
          onEachFeature={(feature, layer) => {
            const p = (feature as SectionFeature).properties;
            if (p?.kind === 'pending') {
              if (p.name) {
                layer.bindTooltip(
                  `${p.name} — ${(p.sections ?? []).join(' or ')}`,
                  { sticky: true });
              }
              return;
            }
            // The shape answers for itself. It used to say nothing, so the
            // only way to identify a section was to hit its label — a 9px box
            // about 20px wide, which on a phone is most of the reason to give
            // up. Now that the shapes carry the map, they carry the question
            // too, and a label hidden by placement costs nothing.
            const id = feature.id ? String(feature.id) : '';
            const info = id ? SECTION_DATA[id as keyof typeof SECTION_DATA] : undefined;
            if (!info) return;
            layer.bindTooltip(
              `${id} — ${info.name}${workedSet.has(id) ? ' ✓' : ''}`,
              { sticky: true });
          }}
        />
      )}
      {/* After every fill, so strokes are painted over them. Non-interactive:
          the fill layer above owns the hover, and a stroke that swallowed it
          would make the pending tooltip depend on hitting a hairline. */}
      {shapes && (
        <GeoJSON
          key={`dim-${workedKey}-${lightMode}`}
          data={shapes}
          filter={f => !isWorked(f as SectionFeature)}
          style={borderStyle as never}
          interactive={false}
        />
      )}
      {shapes && (
        <GeoJSON
          key={`strong-${workedKey}-${lightMode}`}
          data={shapes}
          filter={f => isWorked(f as SectionFeature)}
          style={borderStyle as never}
          interactive={false}
        />
      )}
      <SectionLabels workedSet={workedSet} lightMode={lightMode} />

    </MapContainer>
  );
}
