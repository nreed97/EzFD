'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Band, Mode, SesReservation } from '@/lib/types';

interface Props {
  eventId: string;
  myOpCall: string;
  currentBand: Band;
  currentMode: Mode;
  /** Default checkout length for this event, in minutes. */
  slotMinutes: number;
  /** Bumped by the parent on every SSE `reservation` event. The parent
   *  already holds an EventSource for this event, so this component refetches
   *  off that rather than opening a second stream. */
  refreshToken: number;
  /** ISO timestamp of this operator's most recent QSO, or null. Auto-extend
   *  only fires for an operator who is actually working the band — otherwise
   *  a forgotten browser tab would hold the call indefinitely. */
  lastQsoAt: string | null;
  /** Reports whether this operator currently holds (currentBand, currentMode)
   *  so the parent can warn before logging. Must be referentially stable. */
  onHoldingChange?: (holding: boolean) => void;
}

const POLL_MS = 60_000;
const AUTO_EXTEND_CHECK_MS = 60_000;
/** Extend when the slot has less than this left and the operator is active. */
const EXTEND_THRESHOLD_MS = 10 * 60 * 1000;
const EXTEND_MINUTES = 15;
/** How recently an operator must have logged to count as still working. */
const ACTIVE_WINDOW_MS = 15 * 60 * 1000;

const MODE_COLORS: Record<string, string> = {
  PH:  'text-blue-400 light:text-blue-700',
  CW:  'text-yellow-400 light:text-yellow-700',
  DIG: 'text-green-400 light:text-green-700',
};

function clockUTC(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}Z`;
}

function minutesUntil(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return isNaN(ms) ? null : Math.round(ms / 60_000);
}

export default function SesCoordination({
  eventId, myOpCall, currentBand, currentMode, slotMinutes,
  refreshToken, lastQsoAt, onHoldingChange,
}: Props) {
  const [reservations, setReservations] = useState<SesReservation[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minutes, setMinutes] = useState(slotMinutes);
  // Re-render once a minute so the countdown stays honest without a refetch.
  const [, setTick] = useState(0);

  const fetchReservations = useCallback(async () => {
    const res = await fetch(`/api/ses/reservations?event_id=${eventId}`).catch(() => null);
    if (res?.ok) setReservations(await res.json());
  }, [eventId]);

  useEffect(() => { fetchReservations(); }, [fetchReservations, refreshToken]);

  useEffect(() => {
    const id = setInterval(fetchReservations, POLL_MS);
    return () => clearInterval(id);
  }, [fetchReservations]);

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const now = Date.now();
  const active = reservations.filter(r => {
    const start = new Date(r.starts_at).getTime();
    const end = r.ends_at ? new Date(r.ends_at).getTime() : Infinity;
    return start <= now && end > now;
  });
  const upcoming = reservations.filter(r => new Date(r.starts_at).getTime() > now);

  const mySlot = active.find(r => r.op_call === myOpCall) ?? null;
  const hereHolder = active.find(r => r.band === currentBand && r.mode === currentMode) ?? null;
  const iHoldHere = hereHolder?.op_call === myOpCall;

  useEffect(() => {
    onHoldingChange?.(iHoldHere);
  }, [iHoldHere, onHoldingChange]);

  // ── Auto-extend ────────────────────────────────────────────────────────
  // Read volatile values through a ref rather than depending on them: this
  // panel re-renders on every rig frequency tick (~4/sec), and a dependency
  // on a changing value would tear down and rebuild the interval before it
  // ever fired.
  const extendStateRef = useRef({ mySlot, lastQsoAt });
  useEffect(() => {
    extendStateRef.current = { mySlot, lastQsoAt };
  }, [mySlot, lastQsoAt]);

  useEffect(() => {
    const id = setInterval(async () => {
      const { mySlot: slot, lastQsoAt: lastQso } = extendStateRef.current;
      if (!slot?.ends_at) return;
      const remaining = new Date(slot.ends_at).getTime() - Date.now();
      if (remaining > EXTEND_THRESHOLD_MS) return;
      // Only for an operator still working — otherwise an abandoned tab would
      // hold the callsign forever and nobody else could check it out.
      if (!lastQso || Date.now() - new Date(lastQso).getTime() > ACTIVE_WINDOW_MS) return;

      await fetch(`/api/ses/reservations/${slot.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'extend', op_call: myOpCall, minutes: EXTEND_MINUTES }),
      }).catch(() => {});
      fetchReservations();
    }, AUTO_EXTEND_CHECK_MS);
    return () => clearInterval(id);
  }, [myOpCall, fetchReservations]);

  async function checkOut() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/ses/reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_id: eventId,
          op_call: myOpCall,
          band: currentBand,
          mode: currentMode,
          minutes,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error ?? `Checkout failed (${res.status})`);
      await fetchReservations();
    } finally {
      setBusy(false);
    }
  }

  async function patchSlot(id: string, action: 'release' | 'extend') {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/ses/reservations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, op_call: myOpCall, minutes: EXTEND_MINUTES }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error ?? `Could not ${action} the slot`);
      await fetchReservations();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 light:border-zinc-200 light:bg-zinc-100/50">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          Call Checkout
        </h3>
        {mySlot && (
          <span className="rounded border border-green-700 bg-green-900/30 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-green-400">
            You hold {mySlot.band} {mySlot.mode}
          </span>
        )}
      </div>

      {/* Status for the band/mode the form is currently set to */}
      <div className={`mb-2 rounded border px-2 py-1.5 text-[11px] ${
        iHoldHere
          ? 'border-green-800 bg-green-900/20 text-green-400'
          : hereHolder
            ? 'border-red-800 bg-red-900/25 text-red-400'
            : 'border-zinc-700 bg-zinc-800/40 text-zinc-400 light:border-zinc-300 light:bg-zinc-200/60 light:text-zinc-600'
      }`}>
        {iHoldHere ? (
          <>You have <strong>{currentBand} {currentMode}</strong> until {clockUTC(hereHolder!.ends_at)}</>
        ) : hereHolder ? (
          <><strong>{hereHolder.op_call}</strong> holds {currentBand} {currentMode} until {clockUTC(hereHolder.ends_at)}</>
        ) : (
          <>Nobody holds <strong>{currentBand} {currentMode}</strong> right now</>
        )}
      </div>

      {error && (
        <div className="mb-2 rounded border border-red-800 bg-red-900/25 px-2 py-1 text-[11px] text-red-400">
          {error}
        </div>
      )}

      {/* Actions */}
      {iHoldHere && hereHolder ? (
        <div className="flex gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => patchSlot(hereHolder.id, 'extend')}
            className="flex-1 rounded border border-zinc-700 py-1.5 text-[11px] font-semibold text-zinc-300 hover:border-zinc-500 hover:bg-zinc-800 disabled:opacity-50 light:border-zinc-300 light:text-zinc-600 light:hover:bg-zinc-100"
          >
            +{EXTEND_MINUTES} min
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => patchSlot(hereHolder.id, 'release')}
            className="flex-1 rounded border border-red-800 py-1.5 text-[11px] font-semibold text-red-400 hover:bg-red-900/30 disabled:opacity-50"
          >
            Release
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <select
            value={minutes}
            onChange={e => setMinutes(Number(e.target.value))}
            className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-1.5 text-[11px] text-zinc-300 light:border-zinc-300 light:bg-white light:text-zinc-700"
          >
            {[30, 60, 120, 180, 240].map(m => (
              <option key={m} value={m}>{m >= 60 ? `${m / 60}h` : `${m}m`}</option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy || !!hereHolder}
            onClick={checkOut}
            title={hereHolder ? `${hereHolder.op_call} already holds this band/mode` : undefined}
            className="flex-1 rounded bg-amber-400 py-1.5 text-[11px] font-bold text-zinc-900 hover:bg-amber-300 disabled:opacity-40 disabled:hover:bg-amber-400"
          >
            Check out {currentBand} {currentMode}
          </button>
        </div>
      )}

      {/* Who has what right now */}
      <div className="mt-2.5">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1">
          On the air ({active.length})
        </div>
        {active.length === 0 && (
          <p className="text-[11px] text-zinc-600 light:text-zinc-400">Nobody has the call checked out.</p>
        )}
        <div className="flex flex-col gap-1">
          {active.map(r => {
            const left = minutesUntil(r.ends_at);
            return (
              <div
                key={r.id}
                className={`flex items-center justify-between rounded px-2 py-1 text-xs ${
                  r.op_call === myOpCall
                    ? 'border border-zinc-700 bg-zinc-800/60 light:border-zinc-300 light:bg-zinc-200'
                    : 'bg-zinc-800/40 light:bg-zinc-200/80'
                }`}
              >
                <span className={`font-mono font-semibold ${
                  r.op_call === myOpCall ? 'text-amber-400 light:text-amber-700' : 'text-zinc-200 light:text-zinc-800'
                }`}>
                  {r.op_call}
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-mono text-zinc-300 light:text-zinc-700">{r.band}</span>
                  <span className={`font-mono font-bold ${MODE_COLORS[r.mode] ?? 'text-zinc-300'}`}>{r.mode}</span>
                  {r.planned_freq && (
                    <span className="font-mono text-[10px] text-zinc-500">{r.planned_freq}</span>
                  )}
                  <span className="font-mono text-[10px] text-zinc-500">
                    {left !== null && left < 60 ? `${left}m left` : clockUTC(r.ends_at)}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {upcoming.length > 0 && (
        <div className="mt-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1">
            Scheduled ({upcoming.length})
          </div>
          <div className="flex flex-col gap-1">
            {upcoming.slice(0, 6).map(r => (
              <div key={r.id} className="flex items-center justify-between rounded px-2 py-0.5 text-[11px] text-zinc-500">
                <span className="font-mono">{r.op_call}</span>
                <span className="flex items-center gap-2">
                  <span className="font-mono">{r.band} {r.mode}</span>
                  <span className="font-mono text-[10px]">{clockUTC(r.starts_at)}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
