'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { Band, Mode } from '@/lib/types';

interface StationPresence {
  op_call: string;
  station: number;
  band: Band;
  mode: Mode;
  updated_at: string;
}

interface Props {
  eventId: string;
  myOpCall: string;
  myStation: number;
  currentBand: Band;
  currentMode: Mode;
}

const MODE_COLORS: Record<Mode, string> = {
  PH:  'text-blue-400',
  CW:  'text-yellow-400',
  DIG: 'text-green-400',
};

const HEARTBEAT_MS  = 30_000;
const POLL_MS       = 15_000;

export default function BandActivity({ eventId, myOpCall, myStation, currentBand, currentMode }: Props) {
  const [stations, setStations] = useState<StationPresence[]>([]);
  const lastBandRef = useRef<Band | null>(null);
  const lastModeRef = useRef<Mode | null>(null);

  const publishPresence = useCallback(async (band: Band, mode: Mode) => {
    await fetch('/api/presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_id: eventId, op_call: myOpCall, station: myStation, band, mode }),
    }).catch(() => {});
  }, [eventId, myOpCall, myStation]);

  const fetchPresence = useCallback(async () => {
    const res = await fetch(`/api/presence?event_id=${eventId}`).catch(() => null);
    if (res?.ok) setStations(await res.json());
  }, [eventId]);

  // Publish immediately on mount and whenever band/mode changes
  useEffect(() => {
    if (currentBand === lastBandRef.current && currentMode === lastModeRef.current) return;
    lastBandRef.current = currentBand;
    lastModeRef.current = currentMode;
    publishPresence(currentBand, currentMode);
  }, [currentBand, currentMode, publishPresence]);

  // Periodic heartbeat so our presence doesn't go stale
  useEffect(() => {
    const id = setInterval(() => publishPresence(lastBandRef.current ?? currentBand, lastModeRef.current ?? currentMode), HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [publishPresence, currentBand, currentMode]);

  // Poll for other stations' presence
  useEffect(() => {
    fetchPresence();
    const id = setInterval(fetchPresence, POLL_MS);
    return () => clearInterval(id);
  }, [fetchPresence]);

  const others = stations.filter(s => s.op_call !== myOpCall);
  if (others.length === 0) return null;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        Other Stations
      </h3>
      <div className="flex flex-col gap-1">
        {others
          .sort((a, b) => a.station - b.station)
          .map(s => {
            const conflict = s.band === currentBand && s.mode === currentMode;
            return (
              <div
                key={s.op_call}
                className={`flex items-center justify-between rounded px-2 py-1 text-xs ${
                  conflict ? 'border border-red-700 bg-red-900/30' : 'bg-zinc-800/50'
                }`}
              >
                <span className="font-mono text-zinc-400">
                  STN{s.station} <span className="text-zinc-300">{s.op_call}</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="font-mono text-zinc-200">{s.band}</span>
                  <span className={`font-mono font-bold ${MODE_COLORS[s.mode]}`}>{s.mode}</span>
                  {conflict && <span className="font-bold text-red-400">!</span>}
                </span>
              </div>
            );
          })}
      </div>
    </div>
  );
}
