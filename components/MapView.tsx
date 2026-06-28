'use client';

import { useEffect } from 'react';
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap } from 'react-leaflet';
import type { LatLngExpression } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { SECTION_DATA } from '@/lib/sections';

interface Props {
  workedSections: string[];
}

function MapBounds({ workedSections }: { workedSections: string[] }) {
  const map = useMap();
  useEffect(() => {
    map.setView([39.5, -98.35], 3);
  }, [map]);
  return null;
}

export default function MapView({ workedSections }: Props) {
  const workedSet = new Set(workedSections.map(s => s.toUpperCase()));

  return (
    <MapContainer
      center={[39.5, -98.35]}
      zoom={3}
      style={{ height: '100%', width: '100%', background: '#111' }}
      zoomControl={true}
    >
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
      />
      <MapBounds workedSections={workedSections} />

      {Object.entries(SECTION_DATA).map(([section, info]) => {
        const worked = workedSet.has(section);
        return (
          <CircleMarker
            key={section}
            center={[info.lat, info.lon] as LatLngExpression}
            radius={worked ? 10 : 5}
            pathOptions={{
              color: worked ? '#fbbf24' : '#3f3f46',
              fillColor: worked ? '#fbbf24' : '#27272a',
              fillOpacity: worked ? 0.85 : 0.5,
              weight: worked ? 2 : 1,
            }}
          >
            <Tooltip>
              <span className="font-mono font-bold">{section}</span>
              {' — '}{info.name}
              {worked ? ' ✓' : ''}
            </Tooltip>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
