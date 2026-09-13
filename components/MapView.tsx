'use client';

import { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Marker, Tooltip, GeoJSON, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { LatLngExpression, PathOptions } from 'leaflet';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import 'leaflet/dist/leaflet.css';
import { SECTION_DATA } from '@/lib/sections';
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

function MapBounds() {
  const map = useMap();
  useEffect(() => {
    map.setView([39.5, -98.35], 3);
  }, [map]);
  return null;
}

function sectionIcon(section: string, worked: boolean, lightMode: boolean) {
  let bg: string, color: string, border: string;
  if (worked) {
    bg = '#fbbf24'; color = '#1c1917'; border = '#d97706';
  } else if (lightMode) {
    bg = 'rgba(255,255,255,0.9)'; color = '#52525b'; border = '#a1a1aa';
  } else {
    bg = 'rgba(24,24,27,0.85)'; color = '#52525b'; border = '#3f3f46';
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
  const lightMode = useLightMode();
  const shapes = useSectionShapes();

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

  // OpenStreetMap's own tiles, which need no account and no key.
  //
  // This used to be CARTO's basemap CDN, which had a light and a dark style
  // and was open to anyone. It is not any more: unauthenticated tiles come
  // back with "API key required" rendered into the image, so the map still
  // drew, still placed every section marker correctly, and was still useless
  // — the failure is a picture, not an error, and nothing on screen said what
  // had happened.
  //
  // A key is the wrong shape for this app whatever CARTO charges. There is no
  // account to attach one to, the field servers this supports run on plain
  // HTTP with no internet guarantee, and a club that clones the repo has to
  // get a working map without signing up for anything.
  //
  // No {s} subdomain: OSM deprecated the a/b/c split, and modern browsers
  // multiplex over one HTTP/2 connection anyway. No {r} either — the standard
  // tile server has no @2x tiles, so asking for them is a wasted 404 per tile.
  const tileUrl = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

  return (
    <MapContainer
      // Only one tile style is published, so dark is a filter over it rather
      // than a second URL. `.map-dark` inverts the tile pane alone — markers,
      // tooltips and the zoom control are separate panes and keep their own
      // colours, which is what stops the worked-section labels inverting into
      // something unreadable. Dark matters here beyond taste: this interface
      // is dark by default and has a night mode for keeping dark adaptation
      // after sunset, and a white map at 2am undoes that.
      className={lightMode ? undefined : 'map-dark'}
      center={[39.5, -98.35]}
      zoom={3}
      style={{ height: '100%', width: '100%', background: lightMode ? '#e8e8e8' : '#111' }}
      zoomControl={true}
    >
      <TileLayer
        key={tileUrl}
        url={tileUrl}
        // OSM's tile usage policy asks for attribution; it is also the only
        // thing on screen naming where the map came from.
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      />
      {/* Under the markers: Leaflet draws vector overlays below the marker
          pane, so the section labels stay legible on top of their own fill.
          Keyed on what it is drawn from, so a change to either redraws it —
          Leaflet caches path styles otherwise. */}
      {shapes && (
        <GeoJSON
          key={`fill-${workedSections.length}-${lightMode}`}
          data={shapes}
          style={fillStyle as never}
          onEachFeature={(feature, layer) => {
            const p = (feature as SectionFeature).properties;
            if (p?.kind !== 'pending' || !p.name) return;
            layer.bindTooltip(
              `${p.name} — ${(p.sections ?? []).join(' or ')}`,
              { sticky: true });
          }}
        />
      )}
      {/* After every fill, so strokes are painted over them. Non-interactive:
          the fill layer above owns the hover, and a stroke that swallowed it
          would make the pending tooltip depend on hitting a hairline. */}
      {shapes && (
        <GeoJSON
          key={`dim-${workedSections.length}-${lightMode}`}
          data={shapes}
          filter={f => !isWorked(f as SectionFeature)}
          style={borderStyle as never}
          interactive={false}
        />
      )}
      {shapes && (
        <GeoJSON
          key={`strong-${workedSections.length}-${lightMode}`}
          data={shapes}
          filter={f => isWorked(f as SectionFeature)}
          style={borderStyle as never}
          interactive={false}
        />
      )}
      <MapBounds />

      {Object.entries(SECTION_DATA).map(([section, info]) => {
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
    </MapContainer>
  );
}
