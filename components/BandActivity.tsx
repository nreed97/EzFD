'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { Band, Mode, DisplayQSO } from '@/lib/types';

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
  qsos: DisplayQSO[];
}

const MODE_COLORS: Record<Mode, string> = {
  PH:  'text-blue-400 light:text-blue-700',
  CW:  'text-yellow-400 light:text-yellow-700',
  DIG: 'text-green-400 light:text-green-700',
};

const HEARTBEAT_MS = 30_000;
const POLL_MS      = 15_000;
const INACTIVE_MS  = 15 * 60 * 1000;

function timeSince(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60)   return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

export default function BandActivity({ eventId, myOpCall, myStation, currentBand, currentMode, qsos }: Props) {
  const [stations, setStations] = useState<StationPresence[]>([]);
  const [tick, setTick] = useState(0);
  const lastBandRef = useRef<Band | null>(null);
  const lastModeRef = useRef<Mode | null>(null);

  // Re-render every 10s so "Xm ago" stays fresh
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 10_000);
    return () => clearInterval(id);
  }, []);

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

  useEffect(() => {
    if (currentBand === lastBandRef.current && currentMode === lastModeRef.current) return;
    lastBandRef.current = currentBand;
    lastModeRef.current = currentMode;
    publishPresence(currentBand, currentMode);
  }, [currentBand, currentMode, publishPresence]);

  useEffect(() => {
    const id = setInterval(() => publishPresence(lastBandRef.current ?? currentBand, lastModeRef.current ?? currentMode), HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [publishPresence, currentBand, currentMode]);

  useEffect(() => {
    fetchPresence();
    const id = setInterval(fetchPresence, POLL_MS);
    return () => clearInterval(id);
  }, [fetchPresence]);

  // Last QSO time per operator from the live QSO list
  const lastQSOByOp: Record<string, string> = {};
  for (const q of qsos) {
    if (q.operator_call && !q._pending) {
      const cur = lastQSOByOp[q.operator_call];
      if (!cur || q.datetime_utc > cur) lastQSOByOp[q.operator_call] = q.datetime_utc;
    }
  }

  // Merge presence list with any op who has logged but has no presence row
  const presenceMap = new Map(stations.map(s => [s.op_call, s]));
  const allOps: StationPresence[] = [...stations];
  for (const op of Object.keys(lastQSOByOp)) {
    if (!presenceMap.has(op)) {
      allOps.push({ op_call: op, station: 0, band: '20m', mode: 'PH', updated_at: lastQSOByOp[op] });
    }
  }

  const now = Date.now();

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 light:border-zinc-200 light:bg-zinc-100/50">
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        Operators
      </h3>
      <div className="flex flex-col gap-1">
        {allOps.length === 0 && (
          <p className="text-[11px] text-zinc-600 light:text-zinc-400">No operators online yet.</p>
        )}
        {allOps
          .sort((a, b) => {
            // Me first, then by last QSO recency
            if (a.op_call === myOpCall) return -1;
            if (b.op_call === myOpCall) return 1;
            const aLast = lastQSOByOp[a.op_call] ?? '';
            const bLast = lastQSOByOp[b.op_call] ?? '';
            return bLast.localeCompare(aLast);
          })
          .map(s => {
            const isMe = s.op_call === myOpCall;
            const lastQSO = lastQSOByOp[s.op_call];
            const inactive = lastQSO
              ? now - new Date(lastQSO).getTime() > INACTIVE_MS
              : true;
            const conflict = !isMe && s.band === currentBand && s.mode === currentMode;

            return (
              <div
                key={s.op_call}
                className={`flex items-center justify-between rounded px-2 py-1 text-xs transition-opacity ${
                  conflict
                    ? 'border border-red-700 bg-red-900/30'
                    : isMe
                      ? 'border border-zinc-700 bg-zinc-800/60 light:border-zinc-300 light:bg-zinc-200'
                      : 'bg-zinc-800/40 light:bg-zinc-200/80'
                } ${inactive && !isMe ? 'opacity-35' : ''}`}
              >
                <span className={`font-mono font-semibold ${isMe ? 'text-amber-400 light:text-amber-700' : 'text-zinc-200 light:text-zinc-800'}`}>
                  {s.op_call}
                  {conflict && <span className="ml-1 text-red-400">!</span>}
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-mono text-zinc-300 light:text-zinc-700">{s.band}</span>
                  <span className={`font-mono font-bold ${MODE_COLORS[s.mode] ?? 'text-zinc-300 light:text-zinc-700'}`}>{s.mode}</span>
                  <span className={`font-mono text-[10px] ${inactive && !isMe ? 'text-zinc-600 light:text-zinc-400' : 'text-zinc-500 light:text-zinc-500'}`}>
                    {lastQSO ? timeSince(lastQSO) : '—'}
                  </span>
                </span>
              </div>
            );
          })}
      </div>
    </div>
  );
}
