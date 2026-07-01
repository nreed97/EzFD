'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface FormValues {
  callsign: string;
  rcvdClass: string;
  rcvdSection: string;
}

interface Props {
  onSend: (text: string, wpm: number) => void;
  onStop: () => void;
  getFormValues: () => FormValues;
  myCall: string;
  eventClass: string;
  eventSection: string;
  storageKey: string;
}

const DEFAULT_MACROS = [
  'CQ FD CQ FD DE {mycall} {mycall} K',
  '{call} {call} DE {mycall} {mycall} K',
  '{exch} {exch}',
  'TU {mycall}',
  '{call}?',
  'AGN',
  'NR',
  '599 {exch}',
  'QRL?',
  'R R TU',
  '73 73',
  'CL',
];

const DEFAULT_WPM = 20;

function expand(text: string, values: FormValues, myCall: string, eventClass: string, eventSection: string): string {
  return text
    .replace(/\{call\}/gi, values.callsign)
    .replace(/\{class\}/gi, values.rcvdClass)
    .replace(/\{section\}/gi, values.rcvdSection)
    .replace(/\{mycall\}/gi, myCall)
    .replace(/\{myclass\}/gi, eventClass)
    .replace(/\{mysection\}/gi, eventSection)
    .replace(/\{exch\}/gi, `${eventClass} ${eventSection}`.trim());
}

export default function CwMacroPanel({ onSend, onStop, getFormValues, myCall, eventClass, eventSection, storageKey }: Props) {
  const [macros, setMacros] = useState<string[]>(DEFAULT_MACROS);
  const [wpm, setWpm] = useState(DEFAULT_WPM);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [manualText, setManualText] = useState('');
  const [lastSent, setLastSent] = useState<string | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  // Load saved macros/wpm
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const saved = JSON.parse(raw) as { macros?: string[]; wpm?: number };
        if (saved.macros && saved.macros.length === 12) setMacros(saved.macros);
        if (saved.wpm) setWpm(saved.wpm);
      }
    } catch { /* ignore malformed storage */ }
  }, [storageKey]);

  const persist = useCallback((nextMacros: string[], nextWpm: number) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ macros: nextMacros, wpm: nextWpm }));
    } catch { /* ignore quota errors */ }
  }, [storageKey]);

  useEffect(() => { editInputRef.current?.focus(); editInputRef.current?.select(); }, [editingIndex]);

  function fireMacro(i: number) {
    if (editingIndex !== null) return;
    const values = getFormValues();
    const text = expand(macros[i], values, myCall, eventClass, eventSection);
    if (!text.trim()) return;
    setLastSent(text);
    onSend(text, wpm);
  }

  function startEdit(i: number) {
    setEditingIndex(i);
    setEditText(macros[i]);
  }

  function saveEdit() {
    if (editingIndex === null) return;
    const next = [...macros];
    next[editingIndex] = editText;
    setMacros(next);
    persist(next, wpm);
    setEditingIndex(null);
  }

  function changeWpm(v: number) {
    setWpm(v);
    persist(macros, v);
  }

  // Space bar aborts sending — standard CW keyer convention — unless typing in a field
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
      if (e.code === 'Space' && !typing) {
        e.preventDefault();
        onStop();
      }
      // F1-F12 as global shortcuts
      const fMatch = e.key.match(/^F(\d{1,2})$/);
      if (fMatch && !typing) {
        const idx = parseInt(fMatch[1], 10) - 1;
        if (idx >= 0 && idx < 12) {
          e.preventDefault();
          fireMacro(idx);
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [macros, wpm, myCall, eventClass, eventSection]);

  function sendManual() {
    if (!manualText.trim()) return;
    setLastSent(manualText);
    onSend(manualText, wpm);
    setManualText('');
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 light:border-zinc-200 light:bg-zinc-100/50 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">CW Macros</h3>
        <button
          type="button"
          onClick={onStop}
          title="Stop sending (Space bar)"
          className="rounded border border-red-700 bg-red-900/30 px-2.5 py-1 text-xs font-bold text-red-400 hover:bg-red-900/50 transition-colors"
        >
          ■ STOP
        </button>
      </div>

      {/* Speed control */}
      <div className="flex items-center gap-2">
        <label className="text-xs text-zinc-500 shrink-0">Speed</label>
        <input
          type="range" min={10} max={40} step={1}
          value={wpm}
          onChange={e => changeWpm(parseInt(e.target.value, 10))}
          className="flex-1 accent-amber-400"
        />
        <span className="font-mono text-xs text-amber-400 w-14 text-right">{wpm} wpm</span>
      </div>

      {/* Macro buttons */}
      <div className="grid grid-cols-3 gap-1.5">
        {macros.map((m, i) => (
          <div key={i} className="relative group">
            {editingIndex === i ? (
              <input
                ref={editInputRef}
                value={editText}
                onChange={e => setEditText(e.target.value.toUpperCase())}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); saveEdit(); }
                  if (e.key === 'Escape') { e.preventDefault(); setEditingIndex(null); }
                }}
                onBlur={saveEdit}
                className="input w-full h-14 text-[10px] font-mono px-1.5 py-1"
              />
            ) : (
              <button
                type="button"
                onClick={() => fireMacro(i)}
                onDoubleClick={() => startEdit(i)}
                title={`${macros[i]}  —  double-click to edit`}
                className="w-full h-14 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-1 text-left hover:border-amber-500 hover:bg-zinc-750 transition-colors light:border-zinc-300 light:bg-zinc-50 light:hover:border-amber-500"
              >
                <div className="text-[10px] font-bold text-amber-400">F{i + 1}</div>
                <div className="text-[9px] text-zinc-400 leading-tight line-clamp-2 break-all light:text-zinc-600">
                  {macros[i] || <span className="text-zinc-600">(empty)</span>}
                </div>
              </button>
            )}
          </div>
        ))}
      </div>
      <p className="text-[10px] text-zinc-600 light:text-zinc-500 -mt-1">
        Click to send · double-click to edit · F1-F12 keys work too · Space bar stops
      </p>

      {/* Manual send */}
      <div className="flex gap-1.5 border-t border-zinc-800 pt-2 light:border-zinc-200">
        <input
          value={manualText}
          onChange={e => setManualText(e.target.value.toUpperCase())}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); sendManual(); } }}
          placeholder="Free-text CW…"
          className="input flex-1 font-mono text-xs"
        />
        <button
          type="button"
          onClick={sendManual}
          className="rounded border border-zinc-700 px-3 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 light:border-zinc-300 light:text-zinc-600 light:hover:bg-zinc-100"
        >
          Send
        </button>
      </div>

      {lastSent && (
        <p className="text-[10px] text-zinc-500 font-mono truncate">Last: {lastSent}</p>
      )}
    </div>
  );
}
