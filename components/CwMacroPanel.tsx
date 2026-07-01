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
  cwError?: string | null;
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

export default function CwMacroPanel({ onSend, onStop, getFormValues, myCall, eventClass, eventSection, storageKey, cwError }: Props) {
  const [macros, setMacros] = useState<string[]>(DEFAULT_MACROS);
  const [wpm, setWpm] = useState(DEFAULT_WPM);
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState<string[]>(DEFAULT_MACROS);
  const [manualText, setManualText] = useState('');
  const [lastSent, setLastSent] = useState<string | null>(null);
  const firstEditRef = useRef<HTMLInputElement>(null);

  // Load saved macros/wpm
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const saved = JSON.parse(raw) as { macros?: string[]; wpm?: number };
        if (saved.macros && saved.macros.length === 12) { setMacros(saved.macros); setDraft(saved.macros); }
        if (saved.wpm) setWpm(saved.wpm);
      }
    } catch { /* ignore malformed storage */ }
  }, [storageKey]);

  const persist = useCallback((nextMacros: string[], nextWpm: number) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ macros: nextMacros, wpm: nextWpm }));
    } catch { /* ignore quota errors */ }
  }, [storageKey]);

  useEffect(() => { if (editMode) { firstEditRef.current?.focus(); firstEditRef.current?.select(); } }, [editMode]);

  function fireMacro(i: number) {
    if (editMode) return;
    const values = getFormValues();
    const text = expand(macros[i], values, myCall, eventClass, eventSection);
    if (!text.trim()) return;
    setLastSent(text);
    onSend(text, wpm);
  }

  function openEdit() {
    setDraft(macros);
    setEditMode(true);
  }

  function saveEdit() {
    setMacros(draft);
    persist(draft, wpm);
    setEditMode(false);
  }

  function cancelEdit() {
    setEditMode(false);
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
      const fMatch = e.key.match(/^F(\d{1,2})$/);
      if (fMatch && !typing && !editMode) {
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
  }, [macros, wpm, myCall, eventClass, eventSection, editMode]);

  function sendManual() {
    if (!manualText.trim()) return;
    setLastSent(manualText);
    onSend(manualText, wpm);
    setManualText('');
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-2.5 light:border-zinc-200 light:bg-zinc-100/50 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">CW Macros</h3>
        <div className="flex items-center gap-1.5">
          <label className="text-[10px] text-zinc-500">WPM</label>
          <input
            type="number" min={5} max={45} step={1}
            value={wpm}
            onChange={e => changeWpm(Math.max(5, Math.min(45, parseInt(e.target.value, 10) || DEFAULT_WPM)))}
            className="input w-12 h-6 px-1 py-0 text-center text-xs font-mono"
          />
          {editMode ? (
            <>
              <button type="button" onClick={saveEdit}
                className="rounded border border-green-700 bg-green-900/30 px-2 py-0.5 text-[10px] font-bold text-green-400 hover:bg-green-900/50">
                SAVE
              </button>
              <button type="button" onClick={cancelEdit}
                className="rounded border border-zinc-700 px-2 py-0.5 text-[10px] font-semibold text-zinc-400 hover:bg-zinc-800">
                CANCEL
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={openEdit}
                title="Edit macros"
                className="rounded border border-zinc-700 px-2 py-0.5 text-[10px] font-semibold text-zinc-400 hover:border-amber-500 hover:text-amber-400">
                EDIT
              </button>
              <button type="button" onClick={onStop} title="Stop sending (Space bar)"
                className="rounded border border-red-700 bg-red-900/30 px-2 py-0.5 text-[10px] font-bold text-red-400 hover:bg-red-900/50">
                ■ STOP
              </button>
            </>
          )}
        </div>
      </div>

      {cwError && (
        <div className="rounded border border-red-800 bg-red-900/30 px-2 py-1 text-[10px] text-red-400">
          CW error: {cwError}
        </div>
      )}

      {/* Macro buttons / edit grid */}
      <div className="grid grid-cols-4 gap-1">
        {(editMode ? draft : macros).map((m, i) => (
          editMode ? (
            <input
              key={i}
              ref={i === 0 ? firstEditRef : undefined}
              value={m}
              onChange={e => setDraft(d => d.map((x, j) => j === i ? e.target.value.toUpperCase() : x))}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); saveEdit(); } if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); } }}
              placeholder={`F${i + 1}`}
              className="input h-8 text-[9px] font-mono px-1 py-0.5"
            />
          ) : (
            <button
              key={i}
              type="button"
              onClick={() => fireMacro(i)}
              title={macros[i] || '(empty)'}
              className="h-8 rounded border border-zinc-700 bg-zinc-800 px-1 text-left hover:border-amber-500 hover:bg-zinc-750 transition-colors light:border-zinc-300 light:bg-zinc-50 light:hover:border-amber-500 overflow-hidden"
            >
              <div className="text-[9px] font-bold text-amber-400 leading-tight">F{i + 1}</div>
              <div className="text-[8px] text-zinc-400 leading-tight truncate light:text-zinc-600">
                {macros[i] || <span className="text-zinc-600">empty</span>}
              </div>
            </button>
          )
        ))}
      </div>
      <p className="text-[9px] text-zinc-600 light:text-zinc-500">
        {editMode
          ? 'Editing — placeholders: {call} {class} {section} {mycall} {exch}'
          : 'Click or press F1-F12 to send · Space bar stops'}
      </p>

      {/* Manual send */}
      <div className="flex gap-1.5">
        <input
          value={manualText}
          onChange={e => setManualText(e.target.value.toUpperCase())}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); sendManual(); } }}
          placeholder="Free-text CW…"
          className="input flex-1 h-7 text-xs font-mono px-2 py-0"
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
        <p className="text-[9px] text-zinc-500 font-mono truncate">Last: {lastSent}</p>
      )}
    </div>
  );
}
