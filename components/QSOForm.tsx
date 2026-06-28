'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { Band, Mode, DisplayQSO } from '@/lib/types';
import { BANDS, MODES } from '@/lib/types';
import { ARRL_SECTIONS } from '@/lib/types';

interface Props {
  eventId: string;
  hasQRZ: boolean;
  onSubmit: (data: { callsign: string; band: Band; mode: Mode; rcvd_class: string; rcvd_section: string }) => Promise<void>;
  submitting: boolean;
  lastLogged: DisplayQSO | null;
  defaultBand: Band;
  defaultMode: Mode;
}

export default function QSOForm({ eventId, hasQRZ, onSubmit, submitting, lastLogged, defaultBand, defaultMode }: Props) {
  const [callsign, setCallsign] = useState('');
  const [band, setBand] = useState<Band>(defaultBand);
  const [mode, setMode] = useState<Mode>(defaultMode);
  const [rcvdClass, setRcvdClass] = useState('');
  const [rcvdSection, setRcvdSection] = useState('');
  const [qrzInfo, setQrzInfo] = useState<{ name?: string; state?: string; country?: string } | null>(null);
  const [dupeWarning, setDupeWarning] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const callRef = useRef<HTMLInputElement>(null);
  const lookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { callRef.current?.focus(); }, []);

  const lookupCallsign = useCallback(async (call: string) => {
    if (!hasQRZ || call.length < 3) return;
    setLookingUp(true);
    const res = await fetch(`/api/qrz?callsign=${encodeURIComponent(call)}&event_id=${eventId}`);
    if (res.ok) {
      const data = await res.json();
      setQrzInfo(data.name ? data : null);
    }
    setLookingUp(false);
  }, [eventId, hasQRZ]);

  function handleCallChange(val: string) {
    const upper = val.toUpperCase().replace(/[^A-Z0-9/]/, '');
    setCallsign(upper);
    setQrzInfo(null);
    setDupeWarning(false);

    if (lookupTimer.current) clearTimeout(lookupTimer.current);
    if (upper.length >= 3) {
      lookupTimer.current = setTimeout(() => lookupCallsign(upper), 600);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!callsign || submitting) return;

    await onSubmit({ callsign, band, mode, rcvd_class: rcvdClass, rcvd_section: rcvdSection });
    setDupeWarning(false);
    setCallsign('');
    setRcvdClass('');
    setRcvdSection('');
    setQrzInfo(null);
    callRef.current?.focus();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div>
        <label className="block text-xs text-zinc-400 mb-1">Callsign</label>
        <input
          ref={callRef}
          value={callsign}
          onChange={e => handleCallChange(e.target.value)}
          placeholder="W1ABC"
          className="input w-full font-mono text-xl tracking-widest"
          autoComplete="off"
          spellCheck={false}
        />
        {lookingUp && <p className="mt-1 text-xs text-zinc-500">Looking up...</p>}
        {qrzInfo && (
          <p className="mt-1 text-xs text-zinc-400">
            {qrzInfo.name}
            {qrzInfo.state ? ` · ${qrzInfo.state}` : ''}
            {qrzInfo.country && qrzInfo.country !== 'United States' ? ` · ${qrzInfo.country}` : ''}
          </p>
        )}
      </div>

      <div className="flex gap-2">
        <div className="flex-1">
          <label className="block text-xs text-zinc-400 mb-1">Band</label>
          <select value={band} onChange={e => setBand(e.target.value as Band)} className="input w-full">
            {BANDS.map(b => <option key={b}>{b}</option>)}
          </select>
        </div>
        <div className="flex-1">
          <label className="block text-xs text-zinc-400 mb-1">Mode</label>
          <div className="flex rounded-lg overflow-hidden border border-zinc-700">
            {MODES.map(m => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`flex-1 py-1.5 text-sm font-semibold transition-colors ${
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
      </div>

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

      {dupeWarning && (
        <div className="rounded-lg border border-yellow-700 bg-yellow-900/30 p-2 text-xs text-yellow-400">
          DUPE — {callsign} already worked on {band} {mode}. Logged as dupe.
        </div>
      )}

      {lastLogged && !dupeWarning && (
        <div className="rounded-lg border border-green-800 bg-green-900/20 p-2 text-xs text-green-400">
          Logged: {lastLogged.callsign} · {lastLogged.band} · {lastLogged.mode}
        </div>
      )}

      <button
        type="submit"
        disabled={!callsign || submitting}
        className="rounded-lg bg-amber-400 py-2.5 font-bold text-zinc-900 transition-colors hover:bg-amber-300 disabled:opacity-50 text-sm"
      >
        {submitting ? 'Logging...' : 'Log QSO  [Enter]'}
      </button>
    </form>
  );
}
