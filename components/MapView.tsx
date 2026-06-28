'use client';

import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { LatLngExpression } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { SECTION_DATA } from '@/lib/sections';

interface Props {
  workedSections: string[];
}

function MapBounds() {
  const map = useMap();
  useEffect(() => {
    map.setView([39.5, -98.35], 3);
  }, [map]);
  return null;
}

function sectionIcon(section: string, worked: boolean) {
  const bg    = worked ? '#fbbf24' : 'rgba(24,24,27,0.85)';
  const color = worked ? '#1c1917' : '#52525b';
  const border = worked ? '#d97706' : '#3f3f46';
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
      <MapBounds />

      {Object.entries(SECTION_DATA).map(([section, info]) => {
        const worked = workedSet.has(section);
        return (
          <Marker
            key={section}
            position={[info.lat, info.lon] as LatLngExpression}
            icon={sectionIcon(section, worked)}
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
