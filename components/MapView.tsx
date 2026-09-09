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

  // Amber for worked, matching the label boxes and the Scoreboard, so the
  // fill and the label agree at a glance rather than being two colour
  // languages on one screen.
  const shapeStyle = useMemo(() => (feature?: SectionFeature): PathOptions => {
    // Worked is the thing being read, so it is the only strong fill. Unworked
    // is a wash light enough to leave the basemap legible underneath — the
    // shape and its border are what carry the information there, not the
    // fill, and 85 opaque polygons would just be a map of nothing.
    if (feature?.properties?.kind === 'pending') {
      return { color: lightMode ? '#a1a1aa' : '#52525b', weight: 1, dashArray: '4 3',
               fillColor: lightMode ? '#e4e4e7' : '#18181b', fillOpacity: 0.2 };
    }
    const worked = !!feature?.id && workedSet.has(String(feature.id));
    return worked
      ? { color: '#b45309', weight: 1, fillColor: '#fbbf24', fillOpacity: 0.5 }
      : { color: lightMode ? '#a1a1aa' : '#52525b', weight: 0.6,
          fillColor: lightMode ? '#f4f4f5' : '#27272a', fillOpacity: 0.15 };
  }, [workedSet, lightMode]);

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
          key={`${workedSections.length}-${lightMode}`}
          data={shapes}
          style={shapeStyle as never}
          onEachFeature={(feature, layer) => {
            const p = (feature as SectionFeature).properties;
            if (p?.kind !== 'pending' || !p.name) return;
            layer.bindTooltip(
              `${p.name} — ${(p.sections ?? []).join(' or ')}`,
              { sticky: true });
          }}
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
