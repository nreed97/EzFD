'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { Band, Mode, DisplayQSO, QSO } from '@/lib/types';
import { ARRL_SECTIONS } from '@/lib/types';

const BAND_GRID: Band[][] = [
  ['160m', '80m',  '40m'],
  ['20m',  '15m',  '10m'],
  ['6m',   '2m',   'SAT'],
];

const EXTRA_BANDS: Band[] = ['1.25m', '70cm'];
const MODES: Mode[] = ['PH', 'CW', 'DIG'];

const MODE_STYLE: Record<Mode, string> = {
  PH:  'bg-blue-400/15 border-blue-400/40 text-blue-400 light:bg-blue-50 light:border-blue-500 light:text-blue-700',
  CW:  'bg-yellow-400/15 border-yellow-400/40 text-yellow-400 light:bg-yellow-50 light:border-yellow-600 light:text-yellow-700',
  DIG: 'bg-green-400/15 border-green-400/40 text-green-400 light:bg-green-50 light:border-green-600 light:text-green-700',
};

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
  onDigHelp: () => void;
  existingQSOs: QSO[];
}

export default function QSOForm({
  eventId, hasQRZ, band, mode, onBandChange, onModeChange,
  onSubmit, submitting, lastLogged, submitError, onDigHelp, existingQSOs,
}: Props) {
  const [callsign, setCallsign] = useState('');
  const [rcvdClass, setRcvdClass] = useState('');
  const [rcvdSection, setRcvdSection] = useState('');
  const [qrzInfo, setQrzInfo] = useState<{ name?: string; state?: string; country?: string } | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [showQSY, setShowQSY] = useState(false);
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

  // TODO: CAT control — integrate Hamlib/flrig via a local relay to auto-populate
  // band and mode from the radio. Also explore CW keying via PTT/serial keyer.
  // The relay could expose a small WebSocket or HTTP endpoint on localhost that
  // the logging page polls, similar to the WSJT-X UDP relay already in place.
  function pickBand(b: Band) {
    onBandChange(b);
    setShowQSY(false);
  }

  // Client-side dupe check — server enforces authoritatively, this is just a heads-up
  const isDupe = callsign.length >= 3 &&
    existingQSOs.some(q => !q.is_dupe && q.callsign === callsign && q.band === band && q.mode === mode);

  const callsignInvalid = callsign.length >= 3 && (() => {
    const c = callsign.replace(/\/.*/, '');
    return !/^[A-Z0-9]{3,}$/.test(c) || !/[A-Z]/.test(c) || !/[0-9]/.test(c);
  })();

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      {/* Callsign */}
      <div>
        <label className="block text-xs text-zinc-400 mb-1 light:text-zinc-600">Callsign</label>
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
        {qrzInfo && !isDupe && (
          <p className="mt-1 text-xs text-zinc-400 light:text-zinc-600">
            {qrzInfo.name}
            {qrzInfo.state ? ` · ${qrzInfo.state}` : ''}
            {qrzInfo.country && qrzInfo.country !== 'United States' ? ` · ${qrzInfo.country}` : ''}
          </p>
        )}
        {isDupe && (
          <p className="mt-1 text-xs text-yellow-500">
            Already worked on {band} {mode} — will log as dupe
          </p>
        )}
        {callsignInvalid && !isDupe && (
          <p className="mt-1 text-xs text-orange-400">
            Unusual callsign format — double-check before logging
          </p>
        )}
      </div>

      {/* Exchange */}
      <div className="flex gap-2">
        <div className="w-20">
          <label className="block text-xs text-zinc-400 mb-1 light:text-zinc-600">Rcvd Class</label>
          <input
            value={rcvdClass}
            onChange={e => setRcvdClass(e.target.value.toUpperCase())}
            placeholder="3A"
            className="input w-full font-mono"
            maxLength={4}
          />
        </div>
        <div className="flex-1">
          <label className="block text-xs text-zinc-400 mb-1 light:text-zinc-600">Rcvd Section</label>
          <input
            list="section-list"
            value={rcvdSection}
            onChange={e => setRcvdSection(e.target.value.toUpperCase())}
            placeholder="MN"
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

      {/* Post-log feedback */}
      {lastLogged && (
        <div className={`rounded-lg border px-3 py-2 ${
          lastLogged.is_dupe
            ? 'border-yellow-700 bg-yellow-900/30'
            : lastLogged._pending
              ? 'border-zinc-700 bg-zinc-800/50 light:border-zinc-300 light:bg-zinc-100'
              : 'border-green-800 bg-green-900/20'
        }`}>
          <div className="flex items-baseline justify-between gap-2">
            <span className={`font-mono text-lg font-bold tracking-wider ${
              lastLogged.is_dupe ? 'text-yellow-400' : lastLogged._pending ? 'text-zinc-300 light:text-zinc-700' : 'text-green-400'
            }`}>
              {lastLogged.callsign}
            </span>
            <span className="text-xs text-zinc-500 light:text-zinc-400">
              {lastLogged.band} · {lastLogged.mode}
            </span>
          </div>
          <p className={`text-[11px] mt-0.5 ${
            lastLogged.is_dupe ? 'text-yellow-600' : lastLogged._pending ? 'text-zinc-500' : 'text-green-600'
          }`}>
            {lastLogged.is_dupe ? 'Logged as dupe' : lastLogged._pending ? 'Queued — syncing…' : 'Logged ✓'}
          </p>
        </div>
      )}

      <button
        type="submit"
        disabled={!callsign || submitting}
        className="rounded-lg bg-amber-400 py-3 font-bold text-zinc-900 transition-colors hover:bg-amber-300 disabled:opacity-50 text-base"
      >
        {submitting ? 'Logging…' : 'Log QSO  [Enter]'}
      </button>

      {/* QSY drawer */}
      <div className="border-t border-zinc-800 pt-2 light:border-zinc-200">
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setShowQSY(v => !v)}
          className="flex w-full items-center justify-between rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 hover:border-zinc-500 hover:bg-zinc-750 transition-colors light:border-zinc-300 light:bg-zinc-100 light:hover:bg-zinc-200 light:hover:border-zinc-400"
        >
          <div className="flex items-center gap-2">
            <span className="rounded border bg-amber-400/15 border-amber-400/40 px-2.5 py-1 font-mono text-sm font-bold text-amber-400 light:bg-amber-50 light:border-amber-600 light:text-amber-700">
              {band}
            </span>
            <span className={`rounded border px-2.5 py-1 font-mono text-sm font-bold ${MODE_STYLE[mode]}`}>
              {mode}
            </span>
          </div>
          <span className="text-xs font-semibold text-zinc-400 tracking-wide light:text-zinc-600">
            {showQSY ? '▲ DONE' : '▼ QSY'}
          </span>
        </button>

        {showQSY && (
          <div className="mt-2 flex flex-col gap-2">
            <div className="grid grid-cols-3 gap-1">
              {BAND_GRID.flat().map(b => (
                <button
                  key={b}
                  type="button"
                  tabIndex={-1}
                  onClick={() => pickBand(b)}
                  className={`rounded py-2.5 text-sm font-mono font-semibold transition-colors ${
                    band === b
                      ? 'bg-amber-400 text-zinc-900'
                      : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 light:bg-zinc-200 light:text-zinc-700 light:hover:bg-zinc-300'
                  }`}
                >
                  {b}
                </button>
              ))}
            </div>

            {showExtra ? (
              <div className="flex gap-1">
                {EXTRA_BANDS.map(b => (
                  <button
                    key={b}
                    type="button"
                    tabIndex={-1}
                    onClick={() => pickBand(b)}
                    className={`flex-1 rounded py-2.5 text-sm font-mono font-semibold transition-colors ${
                      band === b
                        ? 'bg-amber-400 text-zinc-900'
                        : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 light:bg-zinc-200 light:text-zinc-700 light:hover:bg-zinc-300'
                    }`}
                  >
                    {b}
                  </button>
                ))}
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowExtra(false)}
                  className="px-2 text-xs text-zinc-500 hover:text-zinc-300 light:text-zinc-600 light:hover:text-zinc-800"
                >
                  ↑
                </button>
              </div>
            ) : (
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowExtra(true)}
                className="text-left text-xs text-zinc-600 hover:text-zinc-400 light:text-zinc-500 light:hover:text-zinc-700"
              >
                + 1.25m / 70cm
              </button>
            )}

            <div className="flex rounded-lg overflow-hidden border border-zinc-700 light:border-zinc-300">
              {MODES.map(m => (
                <button
                  key={m}
                  type="button"
                  tabIndex={-1}
                  onClick={() => onModeChange(m)}
                  className={`flex-1 py-3 text-sm font-bold transition-colors ${
                    mode === m
                      ? 'bg-amber-400 text-zinc-900'
                      : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 light:bg-zinc-100 light:text-zinc-700 light:hover:bg-zinc-200'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        )}

        {mode === 'DIG' && (
          <button
            type="button"
            tabIndex={-1}
            onClick={onDigHelp}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-zinc-600 bg-zinc-800/40 px-3 py-2 text-xs text-zinc-400 hover:border-blue-600 hover:text-blue-400 transition-colors"
          >
            <span>📡</span>
            <span>Using WSJT-X or JTDX? Set up auto-import →</span>
          </button>
        )}
      </div>
    </form>
  );
}
