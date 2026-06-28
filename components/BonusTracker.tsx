'use client';

import { useState, useCallback, useRef } from 'react';
import type { Bonuses } from '@/lib/types';
import { calculateBonusPoints } from '@/lib/scoring';

interface BoolDef {
  key: keyof Bonuses;
  label: string;
  pts: string;
  type: 'bool';
}
interface NumDef {
  key: keyof Bonuses;
  label: string;
  pts: string;
  type: 'num';
  max: number;
  suffix: string;
}
type BonusDef = BoolDef | NumDef;

const DEFS: BonusDef[] = [
  { key: 'emergency_power',   label: 'Emergency power',             pts: '+100% of base', type: 'bool' },
  { key: 'w1aw_bulletin',     label: 'W1AW FD bulletin',            pts: '+100',          type: 'bool' },
  { key: 'satellite',         label: 'Satellite QSO',               pts: '+100',          type: 'bool' },
  { key: 'natural_power',     label: 'Natural power (solar/wind)',   pts: '+100',          type: 'bool' },
  { key: 'public_info_table', label: 'Public info table',           pts: '+100',          type: 'bool' },
  { key: 'media_publicity',   label: 'Media publicity',             pts: '+100',          type: 'bool' },
  { key: 'educational',       label: 'Educational activity',        pts: '+100',          type: 'bool' },
  { key: 'message_to_sm',     label: 'Message to section manager',  pts: '+100',          type: 'bool' },
  { key: 'all_licensed',      label: '100% attendees licensed',     pts: '+100',          type: 'bool' },
  { key: 'elected_official',  label: 'Elected official visit',      pts: '+50',           type: 'bool' },
  { key: 'web_posting',       label: 'Club website posting',        pts: '+50',           type: 'bool' },
  { key: 'social_media',      label: 'Social media post',           pts: '+50',           type: 'bool' },
  { key: 'safety_officer',    label: 'Safety officer',              pts: '+25',           type: 'bool' },
  { key: 'youth_ops',    label: 'Youth operators (under 18)', pts: '+20 each',         type: 'num', max: 99,   suffix: 'ops' },
  { key: 'gota_qsos',    label: 'GOTA station QSOs',          pts: '+10 each, max 1000', type: 'num', max: 9999, suffix: 'QSOs' },
  { key: 'served_agency', label: 'Served agency reps',        pts: '+10 each, max 100', type: 'num', max: 10,   suffix: 'reps' },
  { key: 'nts_traffic',  label: 'NTS messages',               pts: '+10 each, max 100', type: 'num', max: 10,   suffix: 'msgs' },
];

interface Props {
  joinCode: string;
  initialBonuses: Bonuses;
  baseScore: number;
  onBonusesChange?: (b: Bonuses) => void;
}

export default function BonusTracker({ joinCode, initialBonuses, baseScore, onBonusesChange }: Props) {
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
    const next = { ...bonuses, [key]: !bonuses[key as keyof Bonuses] };
    setBonuses(next);
    save(next);
  }

  function setNum(key: keyof Bonuses, value: number) {
    const next = { ...bonuses, [key]: value };
    setBonuses(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => save(next), 600);
  }

  const bonusPoints = calculateBonusPoints(bonuses, baseScore);

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
          {DEFS.map(def => (
            <div key={def.key} className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                {def.type === 'bool' ? (
                  <input
                    type="checkbox"
                    checked={!!bonuses[def.key]}
                    onChange={() => toggleBool(def.key)}
                    className="accent-amber-400 shrink-0"
                  />
                ) : (
                  <input
                    type="number"
                    min={0}
                    max={(def as NumDef).max}
                    value={(bonuses[def.key] as number | undefined) ?? 0}
                    onChange={e => setNum(def.key, Math.max(0, parseInt(e.target.value) || 0))}
                    className="w-12 rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-center font-mono text-xs text-zinc-200 light:border-zinc-300 light:bg-white light:text-zinc-800"
                  />
                )}
                <span className="truncate text-xs text-zinc-300 light:text-zinc-700">{def.label}</span>
              </div>
              <span className="shrink-0 text-[10px] text-zinc-600 light:text-zinc-400">{def.pts}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
