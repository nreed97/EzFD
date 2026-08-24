'use client';

import { useState, useCallback, useRef } from 'react';
import type { Bonuses, EventType } from '@/lib/types';
import { calculateBonusPoints } from '@/lib/scoring';
import { bonusDefs, bonusRate, transmittersFromClass } from '@/lib/bonuses';

interface Props {
  joinCode: string;
  initialBonuses: Bonuses;
  eventType: EventType;
  /** The entry class, e.g. "3A" — the emergency power bonus pays per
   *  transmitter, so the panel needs it to show what the box is worth. */
  entryClass: string | null;
  /** QSO points × power multiplier. Only Winter Field Day's unverified
   *  emergency power bonus reads it; Field Day's is per transmitter. */
  baseScore: number;
  onBonusesChange?: (b: Bonuses) => void;
  readOnly?: boolean;
}

export default function BonusTracker({
  joinCode, initialBonuses, eventType, entryClass, baseScore, onBonusesChange, readOnly = false,
}: Props) {
  const [bonuses, setBonuses] = useState<Bonuses>(initialBonuses);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useCallback(async (next: Bonuses) => {
    setSaving(true);
    onBonusesChange?.(next);
    try {
      await fetch(`/api/events/${joinCode}/bonuses`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
    } finally {
      setSaving(false);
    }
  }, [joinCode, onBonusesChange]);

  function toggleBool(key: keyof Bonuses) {
    if (readOnly) return;
    const next = { ...bonuses, [key]: !bonuses[key] };
    setBonuses(next);
    save(next);
  }

  function setNum(key: keyof Bonuses, value: number) {
    if (readOnly) return;
    const next = { ...bonuses, [key]: value };
    setBonuses(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => save(next), 600);
  }

  // The definitions, the rate strings and the arithmetic all come from
  // lib/bonuses.ts, so the number beside a checkbox is the number the scorer
  // adds. They used to be separate transcriptions of the rules and disagreed.
  const defs = bonusDefs(eventType);
  const ctx = { transmitters: transmittersFromClass(entryClass), baseScore };
  const bonusPoints = calculateBonusPoints(bonuses, eventType, ctx);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 light:border-zinc-200 light:bg-white">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center justify-between px-3 py-2.5"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Bonuses</span>
          {bonusPoints > 0 && (
            <span className="rounded bg-amber-400/10 px-1.5 py-0.5 font-mono text-xs font-bold text-amber-400 light:bg-amber-50 light:text-amber-700">
              +{bonusPoints.toLocaleString()}
            </span>
          )}
          {saving && <span className="text-[10px] text-zinc-600">saving…</span>}
        </div>
        <span className="text-zinc-600 text-xs">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="border-t border-zinc-800 light:border-zinc-200 px-3 pb-3 pt-2 flex flex-col gap-1.5">
          {eventType === 'WFD' && (
            <p className="mb-1 rounded bg-amber-400/10 px-2 py-1.5 text-[10px] leading-snug text-amber-400 light:bg-amber-50 light:text-amber-700">
              Winter Field Day bonuses have not been checked against the WFDA
              rules. Verify these against the current rules before submitting.
            </p>
          )}
          {defs.map(def => (
            <div key={def.key} className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                {def.kind === 'per-unit' ? (
                  <input
                    type="number"
                    min={0}
                    max={def.inputMax}
                    value={(typeof bonuses[def.key] === 'number' ? bonuses[def.key] : 0) as number}
                    onChange={e => setNum(def.key, Math.max(0, parseInt(e.target.value) || 0))}
                    disabled={readOnly}
                    className="w-12 rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-center font-mono text-xs text-zinc-200 light:border-zinc-300 light:bg-white light:text-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                ) : (
                  <input
                    type="checkbox"
                    checked={!!bonuses[def.key]}
                    onChange={() => toggleBool(def.key)}
                    disabled={readOnly}
                    className="accent-amber-400 shrink-0 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                )}
                {/* The panel column is narrow enough that a long label still
                    truncates; the title keeps the full text reachable, and the
                    summary sheet — the surface that gets transcribed onto an
                    entry — always shows it in full. */}
                <span
                  title={def.rule ? `${def.label} (rule ${def.rule})` : def.label}
                  className="truncate text-xs text-zinc-300 light:text-zinc-700"
                >
                  {def.label}
                </span>
              </div>
              {/* The rule number rides with the rate rather than the label:
                  inside the label's truncating span it ate enough width to
                  clip "Message to section manager" down to a stub. */}
              <span className="shrink-0 text-[10px] text-zinc-600 light:text-zinc-400">
                {def.rule && <span className="mr-1.5 opacity-70">{def.rule}</span>}
                {bonusRate(def, ctx)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
