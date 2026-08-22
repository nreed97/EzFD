'use client';

// A Gantt-style view of the SES call checkouts: one row per band+mode, time
// running left to right, so an operator can see who held the call before
// them, who has it now, and who is booked after — and which band/mode
// combinations nobody is covering at all.
//
// Colour note: mode is *fixed per row*, so it is carried by the row label as
// text (with the same mode token colour the rest of the app uses) rather
// than by the block fill. Encoding mode as fill would put green/yellow
// adjacent, which fails protan CVD separation (ΔE 5.0 light / 6.8 dark) —
// and would be redundant with the label anyway. The blocks instead encode
// the thing that actually varies along a row: whose slot it is (mine vs.
// another operator vs. already-finished), always with the callsign written
// on or beside the block, never colour alone.

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Band, Mode, SesReservation } from '@/lib/types';
import { BANDS, MODES } from '@/lib/types';
import { useNow } from '@/lib/useNow';

interface Props {
  eventId: string;
  myOpCall: string;
  /** Bumped by the parent whenever a slot is claimed/released, so the
   *  timeline refetches its own (wider) window in step with the board. */
  refreshToken: number;
}

/** Same mode token colours the logging page and sidebar already use — this
 *  keeps the row label reading the way operators are used to. */
const MODE_COLORS: Record<string, string> = {
  PH:  'text-blue-400 light:text-blue-700',
  CW:  'text-yellow-400 light:text-yellow-700',
  DIG: 'text-green-400 light:text-green-700',
};

const SPANS = [
  { hours: 6,  label: '6h',  tick: 1 },
  { hours: 12, label: '12h', tick: 2 },
  { hours: 24, label: '24h', tick: 4 },
] as const;

/** How much of the window sits behind "now" — enough to see the handover
 *  you just took over from without burying what's coming. */
const PAST_FRACTION = 0.25;

const TICK_MS = 30_000;

function hhmmUTC(d: Date): string {
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

function stampUTC(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : `${hhmmUTC(d)}Z`;
}

export default function ScheduleTimeline({ eventId, myOpCall, refreshToken }: Props) {
  const [rows, setRows] = useState<SesReservation[]>([]);
  const [spanHours, setSpanHours] = useState<number>(12);

  const span = SPANS.find(s => s.hours === spanHours) ?? SPANS[1];
  const pastHours = Math.ceil(span.hours * PAST_FRACTION);

  const load = useCallback(async () => {
    // Released slots are real history — "W1ABC had 20m PH until 14:30" — so
    // the timeline asks for them explicitly. The board's own live grid and
    // the dashboard sidebar keep using the default (current+upcoming) view.
    const res = await fetch(
      `/api/ses/reservations?event_id=${eventId}&past_hours=${pastHours}&include_released=1`
    ).catch(() => null);
    if (res?.ok) setRows(await res.json());
  }, [eventId, pastHours]);

  useEffect(() => {
    // the loader is async: whatever state it sets happens in a promise
    // continuation after an await, never synchronously during the effect, so
    // it cannot cascade a render. The rule cannot see through the async
    // boundary.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load, refreshToken]);

  // Was a bare tick counter whose only job was to force a re-render so the
  // Date.now() below would be re-read. useNow is that, with the clock value
  // itself in state so render stays pure.
  const now = useNow(TICK_MS);
  const windowStart = now - span.hours * PAST_FRACTION * 3_600_000;
  const windowEnd = windowStart + span.hours * 3_600_000;
  const windowMs = windowEnd - windowStart;

  // Only band/mode pairs with something in view earn a row — a full 15×3
  // grid of mostly-empty lanes would bury the ones that matter.
  const lanes = useMemo(() => {
    const seen = new Map<string, { band: Band; mode: Mode; slots: SesReservation[] }>();
    for (const r of rows) {
      const start = new Date(r.starts_at).getTime();
      const end = r.ends_at ? new Date(r.ends_at).getTime() : windowEnd;
      if (end <= windowStart || start >= windowEnd) continue;
      const key = `${r.band}|${r.mode}`;
      if (!seen.has(key)) seen.set(key, { band: r.band, mode: r.mode, slots: [] });
      seen.get(key)!.slots.push(r);
    }
    return [...seen.values()].sort((a, b) =>
      BANDS.indexOf(a.band) - BANDS.indexOf(b.band) || MODES.indexOf(a.mode) - MODES.indexOf(b.mode)
    );
  }, [rows, windowStart, windowEnd]);

  // Tick marks on the hour, at whole multiples of the span's tick interval.
  const ticks = useMemo(() => {
    const out: { pct: number; label: string }[] = [];
    const first = new Date(windowStart);
    first.setUTCMinutes(0, 0, 0);
    for (let t = first.getTime(); t <= windowEnd; t += 3_600_000) {
      const d = new Date(t);
      if (d.getUTCHours() % span.tick !== 0) continue;
      if (t < windowStart) continue;
      out.push({ pct: ((t - windowStart) / windowMs) * 100, label: hhmmUTC(d) });
    }
    return out;
  }, [windowStart, windowEnd, windowMs, span.tick]);

  const nowPct = ((now - windowStart) / windowMs) * 100;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 light:border-zinc-200 light:bg-white">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Timeline &mdash; who&apos;s on, before and after (UTC)
        </h3>
        <div className="flex rounded border border-zinc-700 overflow-hidden light:border-zinc-300">
          {SPANS.map(s => (
            <button
              key={s.hours}
              type="button"
              onClick={() => setSpanHours(s.hours)}
              aria-pressed={spanHours === s.hours}
              className={`px-2 py-0.5 text-[11px] transition-colors ${
                spanHours === s.hours
                  ? 'bg-amber-400 font-semibold text-zinc-900'
                  : 'text-zinc-400 hover:bg-zinc-800 light:text-zinc-600 light:hover:bg-zinc-100'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Legend — identity is never colour-alone, but the fills still need
          naming so the strip reads without hovering. */}
      <div className="mb-2 flex flex-wrap items-center gap-3 text-[10px] text-zinc-500">
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-4 rounded-sm bg-amber-400" /> You
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-4 rounded-sm bg-zinc-600 light:bg-zinc-400" /> Another operator
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-4 rounded-sm border border-dashed border-zinc-600 light:border-zinc-400" /> Finished / released
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-0.5 bg-zinc-100 light:bg-zinc-900" /> Now
        </span>
      </div>

      {lanes.length === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-600 light:text-zinc-400">
          Nothing scheduled in this window.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[560px]">
            {/* Hour axis */}
            <div className="relative mb-1 ml-24 h-4">
              {ticks.map(t => (
                <span
                  key={t.label + t.pct}
                  style={{ left: `${t.pct}%` }}
                  className="absolute -translate-x-1/2 font-mono text-[10px] text-zinc-600 light:text-zinc-400"
                >
                  {t.label}
                </span>
              ))}
            </div>

            <div className="flex flex-col gap-1">
              {lanes.map(lane => (
                <div key={`${lane.band}|${lane.mode}`} className="flex items-center gap-2">
                  {/* Row label carries band AND mode as text — the mode is
                      readable here whether or not colour comes through. */}
                  {/* 5.5rem + the 0.5rem gap lines the lanes up with the
                      axis row's ml-24 (6rem). */}
                  <div className="w-[5.5rem] shrink-0 text-right font-mono text-[11px]">
                    <span className="text-zinc-300 light:text-zinc-700">{lane.band}</span>{' '}
                    <span className={`font-bold ${MODE_COLORS[lane.mode] ?? 'text-zinc-400'}`}>
                      {lane.mode}
                    </span>
                  </div>

                  <div className="relative h-7 flex-1 rounded bg-zinc-900 light:bg-zinc-100">
                    {ticks.map(t => (
                      <span
                        key={`g${t.pct}`}
                        style={{ left: `${t.pct}%` }}
                        className="absolute inset-y-0 w-px bg-zinc-800 light:bg-zinc-200"
                      />
                    ))}

                    {lane.slots.map(r => {
                      const start = new Date(r.starts_at).getTime();
                      const end = r.ends_at ? new Date(r.ends_at).getTime() : windowEnd;
                      const clampedStart = Math.max(start, windowStart);
                      const clampedEnd = Math.min(end, windowEnd);
                      const left = ((clampedStart - windowStart) / windowMs) * 100;
                      const width = Math.max(((clampedEnd - clampedStart) / windowMs) * 100, 0.8);
                      const mine = r.op_call === myOpCall;
                      const done = r.status === 'RELEASED' || end <= now;

                      return (
                        <div
                          key={r.id}
                          title={`${r.op_call} · ${r.band} ${r.mode} · ${stampUTC(r.starts_at)}–${stampUTC(r.ends_at)}${
                            r.status === 'RELEASED' ? ' · released' : ''
                          }${r.planned_freq ? ` · ${r.planned_freq}` : ''}`}
                          style={{ left: `${left}%`, width: `calc(${width}% - 2px)` }}
                          className={`absolute inset-y-1 flex items-center overflow-hidden rounded px-1.5 ${
                            done
                              ? 'border border-dashed border-zinc-600 bg-transparent light:border-zinc-400'
                              : mine
                                ? 'bg-amber-400 ring-2 ring-amber-300/40'
                                : 'bg-zinc-600 light:bg-zinc-400'
                          }`}
                        >
                          <span
                            className={`truncate font-mono text-[10px] font-semibold ${
                              done
                                ? 'text-zinc-500'
                                : mine
                                  ? 'text-zinc-900'
                                  : 'text-zinc-100 light:text-white'
                            }`}
                          >
                            {r.op_call}
                          </span>
                        </div>
                      );
                    })}

                    {/* "Now" marker, drawn last so it sits above the blocks.
                        Deliberately NOT amber: it most often falls inside the
                        operator's own (amber) slot, where an amber line is
                        invisible. Near-white/near-black reads over every
                        block fill in both themes. */}
                    {nowPct >= 0 && nowPct <= 100 && (
                      <span
                        style={{ left: `${nowPct}%` }}
                        className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-zinc-100 light:bg-zinc-900"
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
