'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { Band, Mode, DisplayQSO } from '@/lib/types';
import { ARRL_SECTIONS } from '@/lib/types';

const BAND_GRID: Band[][] = [
  ['160m', '80m',  '40m'],
  ['20m',  '15m',  '10m'],
  ['6m',   '2m',   'SAT'],
];

const EXTRA_BANDS: Band[] = ['1.25m', '70cm'];

const MODES: Mode[] = ['PH', 'CW', 'DIG'];

interface Props {
  eventId: string;
  hasQRZ: boolean;
  band: Band;
  mode: Mode;
  onBandChange: (b: Band) => void;
  onModeChange: (m: Mode) => void;
  onSubmit: (data: { callsign: string; band: Band; mode: Mode; rcvd_class: string; rcvd_section: string }) => Promise<void>;
  submitting: boolean;
  lastLogged: DisplayQSO | null;
  submitError: string | null;
}

export default function QSOForm({
  eventId, hasQRZ, band, mode, onBandChange, onModeChange,
  onSubmit, submitting, lastLogged, submitError,
}: Props) {
  const [callsign, setCallsign] = useState('');
  const [rcvdClass, setRcvdClass] = useState('');
  const [rcvdSection, setRcvdSection] = useState('');
  const [qrzInfo, setQrzInfo] = useState<{ name?: string; state?: string; country?: string } | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [showExtra, setShowExtra] = useState(false);
  const callRef = useRef<HTMLInputElement>(null);
  const lookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { callRef.current?.focus(); }, []);

  const lookupCallsign = useCallback(async (call: string) => {
    if (!hasQRZ || call.length < 3) return;
    setLookingUp(true);
    try {
      const res = await fetch(`/api/qrz?callsign=${encodeURIComponent(call)}&event_id=${eventId}`);
      if (res.ok) {
        const data = await res.json();
        setQrzInfo(data.name ? data : null);
      }
    } finally {
      setLookingUp(false);
    }
  }, [eventId, hasQRZ]);

  function handleCallChange(val: string) {
    const upper = val.toUpperCase().replace(/[^A-Z0-9/]/g, '');
    setCallsign(upper);
    setQrzInfo(null);
    if (lookupTimer.current) clearTimeout(lookupTimer.current);
    if (upper.length >= 3) {
      lookupTimer.current = setTimeout(() => lookupCallsign(upper), 600);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!callsign || submitting) return;
    await onSubmit({ callsign, band, mode, rcvd_class: rcvdClass, rcvd_section: rcvdSection });
    setCallsign('');
    setRcvdClass('');
    setRcvdSection('');
    setQrzInfo(null);
    callRef.current?.focus();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      {/* Callsign */}
      <div>
        <label className="block text-xs text-zinc-400 mb-1">Callsign</label>
        <input
          ref={callRef}
          value={callsign}
          onChange={e => handleCallChange(e.target.value)}
          placeholder="W0NY"
          className="input w-full font-mono text-xl tracking-widest"
          autoComplete="off"
          spellCheck={false}
        />
        {lookingUp && <p className="mt-1 text-xs text-zinc-500">Looking up…</p>}
        {qrzInfo && (
          <p className="mt-1 text-xs text-zinc-400">
            {qrzInfo.name}
            {qrzInfo.state ? ` · ${qrzInfo.state}` : ''}
            {qrzInfo.country && qrzInfo.country !== 'United States' ? ` · ${qrzInfo.country}` : ''}
          </p>
        )}
      </div>

      {/* Band grid */}
      <div>
        <label className="block text-xs text-zinc-400 mb-1">Band</label>
        <div className="grid grid-cols-3 gap-1">
          {BAND_GRID.flat().map(b => (
            <button
              key={b}
              type="button"
              tabIndex={-1}
              onClick={() => onBandChange(b)}
              className={`rounded py-1.5 text-xs font-mono font-semibold transition-colors ${
                band === b
                  ? 'bg-amber-400 text-zinc-900'
                  : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
              }`}
            >
              {b}
            </button>
          ))}
        </div>
        {/* Extra bands collapsed by default */}
        {showExtra ? (
          <div className="mt-1 flex gap-1">
            {EXTRA_BANDS.map(b => (
              <button
                key={b}
                type="button"
                tabIndex={-1}
                onClick={() => onBandChange(b)}
                className={`flex-1 rounded py-1.5 text-xs font-mono font-semibold transition-colors ${
                  band === b
                    ? 'bg-amber-400 text-zinc-900'
                    : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                }`}
              >
                {b}
              </button>
            ))}
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowExtra(false)}
              className="px-2 text-xs text-zinc-500 hover:text-zinc-300"
            >
              ↑
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowExtra(true)}
            className="mt-1 text-xs text-zinc-600 hover:text-zinc-400"
          >
            + 1.25m / 70cm
          </button>
        )}
      </div>

      {/* Mode */}
      <div>
        <label className="block text-xs text-zinc-400 mb-1">Mode</label>
        <div className="flex rounded-lg overflow-hidden border border-zinc-700">
          {MODES.map(m => (
            <button
              key={m}
              type="button"
              tabIndex={-1}
              onClick={() => onModeChange(m)}
              className={`flex-1 py-2 text-sm font-bold transition-colors ${
                mode === m
                  ? 'bg-amber-400 text-zinc-900'
                  : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Exchange */}
      <div className="flex gap-2">
        <div className="w-20">
          <label className="block text-xs text-zinc-400 mb-1">Rcvd Class</label>
          <input
            value={rcvdClass}
            onChange={e => setRcvdClass(e.target.value.toUpperCase())}
            placeholder="3A"
            className="input w-full font-mono"
            maxLength={4}
          />
        </div>
        <div className="flex-1">
          <label className="block text-xs text-zinc-400 mb-1">Rcvd Section</label>
          <input
            list="section-list"
            value={rcvdSection}
            onChange={e => setRcvdSection(e.target.value.toUpperCase())}
            placeholder="EPA"
            className="input w-full font-mono"
            maxLength={5}
          />
          <datalist id="section-list">
            {ARRL_SECTIONS.map(s => <option key={s} value={s} />)}
          </datalist>
        </div>
      </div>

      {/* Server error */}
      {submitError && (
        <div className="rounded-lg border border-red-800 bg-red-900/30 p-2 text-xs text-red-400">
          Error: {submitError}
        </div>
      )}

      {/* Feedback */}
      {lastLogged && (
        <div className={`rounded-lg border p-2 text-xs ${
          lastLogged.is_dupe
            ? 'border-yellow-700 bg-yellow-900/30 text-yellow-400'
            : lastLogged._pending
              ? 'border-zinc-700 bg-zinc-800/50 text-zinc-400'
              : 'border-green-800 bg-green-900/20 text-green-400'
        }`}>
          {lastLogged.is_dupe
            ? `DUPE — ${lastLogged.callsign} already worked on ${lastLogged.band} ${lastLogged.mode}`
            : lastLogged._pending
              ? `Queued: ${lastLogged.callsign} · ${lastLogged.band} · ${lastLogged.mode} (syncing…)`
              : `Logged: ${lastLogged.callsign} · ${lastLogged.band} · ${lastLogged.mode}`}
        </div>
      )}

      <button
        type="submit"
        disabled={!callsign || submitting}
        className="rounded-lg bg-amber-400 py-2.5 font-bold text-zinc-900 transition-colors hover:bg-amber-300 disabled:opacity-50 text-sm"
      >
        {submitting ? 'Logging…' : 'Log QSO  [Enter]'}
      </button>
    </form>
  );
}
