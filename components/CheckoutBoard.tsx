'use client';

// Dashboard-level view of every SES call checkout: a band/mode grid for
// taking or assigning the callsign right now, plus the full schedule of
// upcoming slots. Unlike the compact SesCoordination panel on the logging
// page (which only acts on the operator's own current band/mode), this is
// meant for a coordinator managing the whole roster from one screen.

import { useMemo, useState } from 'react';
import type { Band, Mode, SesReservation } from '@/lib/types';
import { BANDS, MODES } from '@/lib/types';
import DateTimeField from './DateTimeField';
import ScheduleTimeline from './ScheduleTimeline';

interface Props {
  eventId: string;
  slotMinutes: number;
  eventStartsAt: string | Date | null;
  eventEndsAt: string | Date | null;
  reservations: SesReservation[];
  onRefresh: () => void;
  /** This viewer's own callsign, if known (recovered from sessionStorage) — prefills the assign form. */
  myOpCall: string;
  /** Callsigns seen logging or present, offered as datalist suggestions when assigning. */
  knownOperators: string[];
  readOnly?: boolean;
  /** Bumped by the parent on every checkout change, so the timeline reloads
   *  its own (history-inclusive) window alongside the live grid. */
  refreshToken: number;
}

const MODE_COLORS: Record<string, string> = {
  PH:  'text-blue-400 light:text-blue-700',
  CW:  'text-yellow-400 light:text-yellow-700',
  DIG: 'text-green-400 light:text-green-700',
};

const DURATIONS = [30, 60, 120, 180, 240];

function clockUTC(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}Z`;
}

function dayClockUTC(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const today = new Date();
  const sameDay = d.getUTCDate() === today.getUTCDate() && d.getUTCMonth() === today.getUTCMonth();
  const hhmm = clockUTC(iso);
  return sameDay ? hhmm : `${d.getUTCDate()} ${d.toLocaleString('en', { month: 'short', timeZone: 'UTC' })} ${hhmm}`;
}

export default function CheckoutBoard({
  eventId, slotMinutes, eventStartsAt, eventEndsAt, reservations, onRefresh,
  myOpCall, knownOperators, readOnly = false, refreshToken,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assignCell, setAssignCell] = useState<{ band: Band; mode: Mode } | null>(null);
  const [assignCall, setAssignCall] = useState(myOpCall);
  const [assignMinutes, setAssignMinutes] = useState(slotMinutes);

  const [showSchedule, setShowSchedule] = useState(false);
  const [planBand, setPlanBand] = useState<Band>(BANDS[0]);
  const [planMode, setPlanMode] = useState<Mode>(MODES[0]);
  const [planCall, setPlanCall] = useState(myOpCall);
  const [planStart, setPlanStart] = useState('');
  const [planMinutes, setPlanMinutes] = useState(slotMinutes);

  const eventMinDate = eventStartsAt ? new Date(eventStartsAt).toISOString().slice(0, 10) : undefined;
  const eventMaxDate = eventEndsAt ? new Date(eventEndsAt).toISOString().slice(0, 10) : undefined;

  const now = Date.now();
  const active = useMemo(() => reservations.filter(r => {
    const start = new Date(r.starts_at).getTime();
    const end = r.ends_at ? new Date(r.ends_at).getTime() : Infinity;
    return start <= now && end > now;
  }), [reservations, now]);
  const upcoming = useMemo(
    () => reservations.filter(r => new Date(r.starts_at).getTime() > now).sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
    [reservations, now]
  );

  const holderByCell = useMemo(() => {
    const m = new Map<string, SesReservation>();
    for (const r of active) m.set(`${r.band}|${r.mode}`, r);
    return m;
  }, [active]);

  async function take(band: Band, mode: Mode, opCall: string, minutes: number) {
    const call = opCall.toUpperCase().trim();
    if (!call) { setError('Enter a callsign first.'); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/ses/reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_id: eventId, op_call: call, band, mode, minutes }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error ?? `Could not assign (${res.status})`);
      else setAssignCell(null);
      onRefresh();
    } finally {
      setBusy(false);
    }
  }

  async function release(r: SesReservation) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/ses/reservations/${r.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // Same self-asserted identity model as the rest of the app — a
        // coordinator managing the board acts using the holder's own call.
        body: JSON.stringify({ action: 'release', op_call: r.op_call }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error ?? 'Could not release the slot');
      onRefresh();
    } finally {
      setBusy(false);
    }
  }

  async function schedule() {
    if (!planStart) { setError('Pick a start time first.'); return; }
    const call = planCall.toUpperCase().trim();
    if (!call) { setError('Enter a callsign first.'); return; }
    const planMs = new Date(`${planStart}:00Z`).getTime();
    if (eventStartsAt && planMs < new Date(eventStartsAt).getTime()) {
      setError('That start time is before the event begins.');
      return;
    }
    if (eventEndsAt && planMs > new Date(eventEndsAt).getTime()) {
      setError('That start time is after the event ends.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/ses/reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_id: eventId,
          op_call: call,
          band: planBand,
          mode: planMode,
          starts_at: `${planStart}:00Z`,
          minutes: planMinutes,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `Could not schedule (${res.status})`);
      } else {
        setShowSchedule(false);
        setPlanStart('');
      }
      onRefresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      {error && (
        <div className="rounded-lg border border-red-800 bg-red-900/25 px-3 py-2 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Overview first: the timeline answers "what's covered, and by whom"
          at a glance. The 15-band action grid below is taller than a screen,
          so putting it first buried the thing people come here to read. */}
      <ScheduleTimeline
        eventId={eventId}
        myOpCall={myOpCall}
        refreshToken={refreshToken}
      />

      <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 light:border-zinc-200 light:bg-white">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Band / Mode Checkout
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <thead>
              <tr>
                <th className="p-1 text-left text-xs font-semibold text-zinc-500">Band</th>
                {MODES.map(m => (
                  <th key={m} className={`p-1 text-xs font-bold ${MODE_COLORS[m] ?? 'text-zinc-400'}`}>{m}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {BANDS.map(band => (
                <tr key={band} className="border-t border-zinc-800/60 light:border-zinc-200">
                  <td className="p-1 font-mono text-xs text-zinc-400">{band}</td>
                  {MODES.map(mode => {
                    const holder = holderByCell.get(`${band}|${mode}`);
                    const isAssigning = assignCell?.band === band && assignCell?.mode === mode;
                    return (
                      <td key={mode} className="p-1 align-top">
                        {holder ? (
                          <div className="flex flex-col gap-0.5 rounded border border-zinc-700 bg-zinc-800/60 px-1.5 py-1 text-[11px] light:border-zinc-300 light:bg-zinc-100">
                            <span className="font-mono font-semibold text-amber-400 light:text-amber-700">{holder.op_call}</span>
                            <span className="font-mono text-zinc-500">until {clockUTC(holder.ends_at)}</span>
                            {!readOnly && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => release(holder)}
                                className="mt-0.5 self-start text-[10px] text-red-400 hover:underline disabled:opacity-50"
                              >
                                Release
                              </button>
                            )}
                          </div>
                        ) : isAssigning ? (
                          <div className="flex flex-col gap-1 rounded border border-amber-700 bg-amber-900/10 p-1.5 light:border-amber-500 light:bg-amber-50">
                            <input
                              autoFocus
                              value={assignCall}
                              onChange={e => setAssignCall(e.target.value.toUpperCase())}
                              placeholder="Callsign"
                              list="ckb-known-ops"
                              className="w-full rounded border border-zinc-700 bg-zinc-800 px-1 py-0.5 font-mono text-[11px] text-zinc-200 light:border-zinc-300 light:bg-white light:text-zinc-800"
                            />
                            <select
                              value={assignMinutes}
                              onChange={e => setAssignMinutes(Number(e.target.value))}
                              className="w-full rounded border border-zinc-700 bg-zinc-800 px-1 py-0.5 text-[11px] text-zinc-300 light:border-zinc-300 light:bg-white light:text-zinc-700"
                            >
                              {DURATIONS.map(m => (
                                <option key={m} value={m}>{m >= 60 ? `${m / 60}h` : `${m}m`}</option>
                              ))}
                            </select>
                            <div className="flex gap-1">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => take(band, mode, assignCall, assignMinutes)}
                                className="flex-1 rounded bg-amber-400 py-0.5 text-[10px] font-bold text-zinc-900 hover:bg-amber-300 disabled:opacity-50"
                              >
                                Assign
                              </button>
                              <button
                                type="button"
                                onClick={() => setAssignCell(null)}
                                className="rounded border border-zinc-700 px-1.5 text-[10px] text-zinc-400 hover:bg-zinc-800 light:border-zinc-300"
                              >
                                &times;
                              </button>
                            </div>
                          </div>
                        ) : (
                          !readOnly && (
                            <button
                              type="button"
                              onClick={() => { setAssignCell({ band, mode }); setAssignCall(myOpCall); setAssignMinutes(slotMinutes); }}
                              className="w-full rounded border border-dashed border-zinc-700 py-1.5 text-[10px] text-zinc-600 hover:border-amber-400 hover:text-amber-400 light:border-zinc-300 light:text-zinc-400"
                            >
                              + Take
                            </button>
                          )
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <datalist id="ckb-known-ops">
          {knownOperators.map(op => <option key={op} value={op} />)}
        </datalist>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 light:border-zinc-200 light:bg-white">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Scheduled ({upcoming.length})
          </h3>
          {!readOnly && (
            <button
              type="button"
              onClick={() => setShowSchedule(v => !v)}
              className="rounded border border-zinc-700 px-2 py-1 text-[11px] font-semibold text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 light:border-zinc-300 light:text-zinc-500"
            >
              {showSchedule ? 'Close' : '+ Book a slot'}
            </button>
          )}
        </div>

        {showSchedule && !readOnly && (
          <div className="mb-3 flex flex-col gap-2 rounded border border-zinc-800 bg-zinc-900/60 p-3 light:border-zinc-200 light:bg-zinc-50">
            <div className="flex flex-wrap gap-2">
              <input
                value={planCall}
                onChange={e => setPlanCall(e.target.value.toUpperCase())}
                placeholder="Callsign"
                list="ckb-known-ops"
                className="input w-28 font-mono"
              />
              <select value={planBand} onChange={e => setPlanBand(e.target.value as Band)} className="input">
                {BANDS.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
              <select value={planMode} onChange={e => setPlanMode(e.target.value as Mode)} className="input">
                {MODES.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              <select
                value={planMinutes}
                onChange={e => setPlanMinutes(Number(e.target.value))}
                className="input"
              >
                {DURATIONS.map(m => (
                  <option key={m} value={m}>{m >= 60 ? `${m / 60} hour${m > 60 ? 's' : ''}` : `${m} minutes`}</option>
                ))}
              </select>
            </div>
            <DateTimeField
              label="Start"
              value={planStart}
              onChange={setPlanStart}
              minDate={eventMinDate}
              maxDate={eventMaxDate}
            />
            <button
              type="button"
              disabled={busy}
              onClick={schedule}
              className="self-start rounded border border-amber-700 bg-amber-400/10 px-3 py-1.5 text-sm font-semibold text-amber-400 hover:bg-amber-400/20 disabled:opacity-50 light:border-amber-600 light:text-amber-700"
            >
              Book {planBand} {planMode} (UTC)
            </button>
          </div>
        )}

        {upcoming.length === 0 ? (
          <p className="text-sm text-zinc-600 light:text-zinc-400">Nothing scheduled ahead.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {upcoming.map(r => (
              <div key={r.id} className="flex items-center justify-between rounded px-2 py-1 text-sm bg-zinc-900/60 light:bg-zinc-100">
                <span className="font-mono font-semibold text-zinc-200 light:text-zinc-800">{r.op_call}</span>
                <span className="flex items-center gap-3">
                  <span className="font-mono text-zinc-400 light:text-zinc-600">{r.band}</span>
                  <span className={`font-mono font-bold ${MODE_COLORS[r.mode] ?? 'text-zinc-400'}`}>{r.mode}</span>
                  <span className="font-mono text-xs text-zinc-500">{dayClockUTC(r.starts_at)}</span>
                  {!readOnly && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => release(r)}
                      title="Cancel this booking"
                      className="text-xs text-zinc-600 hover:text-red-400 disabled:opacity-50"
                    >
                      &times;
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
