'use client';

import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';

interface FormValues {
  callsign: string;
  rcvdClass: string;
  rcvdSection: string;
}

export type OpMode = 'RUN' | 'S&P';

export interface CwMacroPanelHandle {
  /** Fires the macro mapped to an ESM stage for the current Run/S&P mode.
   * 'cq' only does anything in RUN mode (S&P has nothing to call yet). */
  fireEsm: (stage: 'cq' | 'call' | 'log') => void;
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
  esm: boolean;
  onToggleEsm: () => void;
}

const RUN_DEFAULTS = [
  'CQ FD CQ FD DE {mycall} {mycall} K',
  '{call} {exch}',
  'TU {mycall}',
  '{call}?',
  'AGN',
  'NR?',
  'QRL?',
  '73',
  'R R TU',
  'CL',
  '',
  '',
];

const SP_DEFAULTS = [
  '{call} {mycall}',
  '{exch}',
  'TU {mycall}',
  '{call}?',
  'AGN',
  'NR?',
  'QRL?',
  '73',
  'R R TU',
  'CL',
  '',
  '',
];

const ROLE_LABELS: Record<OpMode, [string, string, string]> = {
  'RUN':  ['CQ', 'CALL', 'TU'],
  'S&P':  ['CALL', 'EXCH', 'TU'],
};

const DEFAULT_WPM = 20;

interface Store {
  run: string[];
  sp: string[];
  wpm: number;
  opMode: OpMode;
}

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

function CwMacroPanel({ onSend, onStop, getFormValues, myCall, eventClass, eventSection, storageKey, cwError, esm, onToggleEsm }: Props, ref: React.Ref<CwMacroPanelHandle>) {
  const [opMode, setOpMode] = useState<OpMode>('RUN');
  const [runMacros, setRunMacros] = useState<string[]>(RUN_DEFAULTS);
  const [spMacros, setSpMacros] = useState<string[]>(SP_DEFAULTS);
  const [wpm, setWpm] = useState(DEFAULT_WPM);
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState<string[]>(RUN_DEFAULTS);
  const [manualText, setManualText] = useState('');
  const [lastSent, setLastSent] = useState<string | null>(null);
  const firstEditRef = useRef<HTMLInputElement>(null);

  const macros = opMode === 'RUN' ? runMacros : spMacros;
  const setMacros = opMode === 'RUN' ? setRunMacros : setSpMacros;

  // Load saved state
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<Store>;
        if (saved.run?.length === 12) setRunMacros(saved.run);
        if (saved.sp?.length === 12) setSpMacros(saved.sp);
        if (saved.wpm) setWpm(saved.wpm);
        if (saved.opMode === 'RUN' || saved.opMode === 'S&P') setOpMode(saved.opMode);
      }
    } catch { /* ignore malformed storage */ }
  }, [storageKey]);

  const persist = useCallback((next: Partial<Store>) => {
    try {
      const current: Store = { run: runMacros, sp: spMacros, wpm, opMode, ...next };
      localStorage.setItem(storageKey, JSON.stringify(current));
    } catch { /* ignore quota errors */ }
  }, [storageKey, runMacros, spMacros, wpm, opMode]);

  useEffect(() => { if (editMode) { firstEditRef.current?.focus(); firstEditRef.current?.select(); } }, [editMode]);

  const fireIndex = useCallback((i: number) => {
    if (editMode) return;
    const text = macros[i];
    if (!text || !text.trim()) return;
    const values = getFormValues();
    const expanded = expand(text, values, myCall, eventClass, eventSection);
    if (!expanded.trim()) return;
    setLastSent(expanded);
    onSend(expanded, wpm);
  }, [editMode, macros, getFormValues, myCall, eventClass, eventSection, onSend, wpm]);

  useImperativeHandle(ref, () => ({
    fireEsm(stage) {
      if (stage === 'cq') {
        if (opMode === 'RUN') fireIndex(0);
        return; // S&P: nothing to call yet
      }
      if (stage === 'call') {
        fireIndex(opMode === 'RUN' ? 1 : 0);
        return;
      }
      if (stage === 'log') {
        fireIndex(2);
      }
    },
  }), [opMode, fireIndex]);

  function switchMode(next: OpMode) {
    setOpMode(next);
    persist({ opMode: next });
  }

  function openEdit() {
    setDraft(macros);
    setEditMode(true);
  }

  function saveEdit() {
    setMacros(draft);
    persist(opMode === 'RUN' ? { run: draft } : { sp: draft });
    setEditMode(false);
  }

  function cancelEdit() {
    setEditMode(false);
  }

  function changeWpm(v: number) {
    setWpm(v);
    persist({ wpm: v });
  }

  // Space bar aborts sending; F1-F12 fire the matching macro — unless typing in a field
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
          fireIndex(idx);
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editMode, fireIndex, onStop]);

  function sendManual() {
    if (!manualText.trim()) return;
    setLastSent(manualText);
    onSend(manualText, wpm);
    setManualText('');
  }

  const roleLabels = ROLE_LABELS[opMode];

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-2.5 light:border-zinc-200 light:bg-zinc-100/50 flex flex-col gap-2">
      <div className="flex items-center justify-between flex-wrap gap-1.5">
        <div className="flex items-center gap-1">
          <div className="flex rounded overflow-hidden border border-zinc-700 text-[10px] font-bold">
            {(['RUN', 'S&P'] as const).map(m => (
              <button key={m} type="button" onClick={() => switchMode(m)}
                className={`px-2 py-0.5 transition-colors ${
                  opMode === m
                    ? 'bg-amber-400 text-zinc-900'
                    : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 light:bg-zinc-100 light:hover:bg-zinc-200'
                }`}>
                {m}
              </button>
            ))}
          </div>
          <button type="button" onClick={onToggleEsm}
            title="Enter Sends Message — Enter fires the right macro based on QSO progress (N1MM-style)"
            className={`rounded border px-2 py-0.5 text-[10px] font-bold transition-colors ${
              esm
                ? 'border-blue-600 bg-blue-900/30 text-blue-400'
                : 'border-zinc-700 text-zinc-500 hover:text-zinc-300'
            }`}>
            ESM {esm ? 'ON' : 'OFF'}
          </button>
        </div>
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
              <button type="button" onClick={openEdit} title="Edit macros"
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

      {esm && (
        <p className="text-[9px] text-blue-400/80 -mt-1">
          ESM active — Enter in Callsign sends {roleLabels[0]}/{roleLabels[1]} automatically, Enter after the exchange sends {roleLabels[2]} and logs the QSO.
        </p>
      )}

      {cwError && (
        <div className="rounded border border-red-800 bg-red-900/30 px-2 py-1 text-[10px] text-red-400">
          CW error: {cwError}
        </div>
      )}

      {/* Macro buttons / edit grid */}
      <div className="grid grid-cols-4 gap-1">
        {(editMode ? draft : macros).map((m, i) => {
          const role = i < 3 ? roleLabels[i] : null;
          return editMode ? (
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
              onClick={() => fireIndex(i)}
              title={macros[i] || '(empty)'}
              className="relative h-8 rounded border border-zinc-700 bg-zinc-800 px-1 text-left hover:border-amber-500 hover:bg-zinc-750 transition-colors light:border-zinc-300 light:bg-zinc-50 light:hover:border-amber-500 overflow-hidden"
            >
              <div className="flex items-center gap-1 leading-tight">
                <span className="text-[9px] font-bold text-amber-400">F{i + 1}</span>
                {role && esm && (
                  <span className="text-[7px] font-bold text-blue-400 border border-blue-800 rounded px-0.5">{role}</span>
                )}
              </div>
              <div className="text-[8px] text-zinc-400 leading-tight truncate light:text-zinc-600">
                {macros[i] || <span className="text-zinc-600">empty</span>}
              </div>
            </button>
          );
        })}
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

export default forwardRef(CwMacroPanel);
