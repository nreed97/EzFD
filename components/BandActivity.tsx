'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useNow } from '@/lib/useNow';
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
  onConflict?: (conflicting: boolean) => void;
  onBandOccupancy?: (occupied: Partial<Record<Band, string[]>>) => void;
  rigConnected?: boolean;
  onRigHelp?: () => void;
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

export default function BandActivity({ eventId, myOpCall, myStation, currentBand, currentMode, qsos, onConflict, onBandOccupancy, rigConnected, onRigHelp }: Props) {
  const [stations, setStations] = useState<StationPresence[]>([]);
  const [isQRT, setIsQRT] = useState(false);
  const lastBandRef = useRef<Band | null>(null);
  const lastModeRef = useRef<Mode | null>(null);
  const isQRTRef = useRef(false);

  const publishPresence = useCallback(async (band: Band, mode: Mode) => {
    if (isQRTRef.current) return;
    await fetch('/api/presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_id: eventId, op_call: myOpCall, station: myStation, band, mode }),
    }).catch(() => {});
  }, [eventId, myOpCall, myStation]);

  const removePresence = useCallback(async () => {
    await fetch('/api/presence', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_id: eventId, op_call: myOpCall }),
    }).catch(() => {});
  }, [eventId, myOpCall]);

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
    // the loader is async: whatever state it sets happens in a promise
    // continuation after an await, never synchronously during the effect, so
    // it cannot cascade a render. The rule cannot see through the async
    // boundary.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchPresence();
    const id = setInterval(fetchPresence, POLL_MS);
    return () => clearInterval(id);
  }, [fetchPresence]);

  function goQRT() {
    isQRTRef.current = true;
    setIsQRT(true);
    removePresence();
    // Remove self from local station list immediately
    setStations(prev => prev.filter(s => s.op_call !== myOpCall));
  }

  function goOnAir() {
    isQRTRef.current = false;
    setIsQRT(false);
    publishPresence(currentBand, currentMode);
  }

  // Last QSO time per operator from the live QSO list. The clock comes from
  // state so that an operator crossing the INACTIVE_MS threshold dims on its
  // own, rather than only when the next presence poll happens to re-render.
  const now = useNow(POLL_MS);
  const lastQSOByOp: Record<string, string> = {};
  for (const q of qsos) {
    if (q.operator_call && !q._pending) {
      const cur = lastQSOByOp[q.operator_call];
      const dt = typeof q.datetime_utc === 'string' ? q.datetime_utc : q.datetime_utc.toISOString();
      if (!cur || dt > cur) lastQSOByOp[q.operator_call] = dt;
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

  // An op is active for conflict purposes only if they have a recent QSO (< INACTIVE_MS)
  // or no QSOs at all (they're live in presence but haven't logged yet)
  function isActiveForConflict(s: StationPresence): boolean {
    if (s.op_call === myOpCall) return false;
    const lastQSO = lastQSOByOp[s.op_call];
    if (lastQSO && now - new Date(lastQSO).getTime() > INACTIVE_MS) return false;
    return true;
  }

  const anyConflict = allOps.some(s =>
    isActiveForConflict(s) && s.band === currentBand && s.mode === currentMode
  );

  // Band occupancy for QSY tile indicators (other active ops only)
  const occupied: Partial<Record<Band, string[]>> = {};
  for (const s of allOps) {
    if (!isActiveForConflict(s)) continue;
    if (!occupied[s.band]) occupied[s.band] = [];
    occupied[s.band]!.push(s.op_call);
  }
  const occupiedKey = JSON.stringify(occupied);

  // Notify parent of conflict state changes
  useEffect(() => {
    onConflict?.(anyConflict);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyConflict]);

  // Notify parent of band occupancy changes
  useEffect(() => {
    onBandOccupancy?.(occupied);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [occupiedKey]);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 light:border-zinc-200 light:bg-zinc-100/50">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          Operators
        </h3>
        <div className="flex items-center gap-1.5">
          {/* Rig control button */}
          <button
            onClick={onRigHelp}
            title={rigConnected ? 'Rig control active — click for details' : 'Set up rig control'}
            className={`text-[10px] font-semibold uppercase tracking-wide rounded border px-2 py-0.5 transition-colors ${
              rigConnected
                ? 'border-green-700 bg-green-900/20 text-green-400 hover:bg-green-900/40'
                : 'border-zinc-700 text-zinc-600 hover:border-zinc-500 hover:text-zinc-400'
            }`}
          >
            {rigConnected ? '● RIG' : 'Rig'}
          </button>

          {/* QRT toggle */}
          {isQRT ? (
            <button
              onClick={goOnAir}
              className="text-[10px] font-semibold uppercase tracking-wide rounded border border-green-700 bg-green-900/30 px-2 py-0.5 text-green-400 hover:bg-green-900/50 transition-colors"
            >
              Back on Air
            </button>
          ) : (
            <button
              onClick={goQRT}
              className="text-[10px] font-semibold uppercase tracking-wide rounded border border-zinc-700 px-2 py-0.5 text-zinc-500 hover:border-red-700 hover:bg-red-900/30 hover:text-red-400 transition-colors"
            >
              Go QRT
            </button>
          )}
        </div>
      </div>

      {isQRT && (
        <div className="mb-2 rounded border border-red-800 bg-red-900/20 px-2 py-1 text-[11px] text-red-400">
          You are QRT — not shown to other operators
        </div>
      )}

      <div className="flex flex-col gap-1">
        {allOps.length === 0 && (
          <p className="text-[11px] text-zinc-600 light:text-zinc-400">No operators online yet.</p>
        )}
        {allOps
          .sort((a, b) => {
            if (a.op_call === myOpCall) return -1;
            if (b.op_call === myOpCall) return 1;
            const aLast = lastQSOByOp[a.op_call] ?? '';
            const bLast = lastQSOByOp[b.op_call] ?? '';
            return bLast > aLast ? -1 : bLast < aLast ? 1 : 0;
          })
          .map(s => {
            const isMe = s.op_call === myOpCall;
            const lastQSO = lastQSOByOp[s.op_call];
            const inactive = lastQSO
              ? now - new Date(lastQSO).getTime() > INACTIVE_MS
              : false;
            const conflict = !isMe && isActiveForConflict(s) && s.band === currentBand && s.mode === currentMode;

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
