'use client';

import { useState, useEffect, useCallback } from 'react';
import { useNow } from '@/lib/useNow';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { calculateScore } from '@/lib/scoring';
import type { Event, QSO, Bonuses, SesReservation } from '@/lib/types';
import Scoreboard from './Scoreboard';
import SectionGrid from './SectionGrid';
import ThemeToggle from './ThemeToggle';
import UTCClock from './UTCClock';
import BonusTracker from './BonusTracker';
import RateChart from './RateChart';
import BandBreakdown from './BandBreakdown';
import SummarySheet from './SummarySheet';
import SectionsNeeded from './SectionsNeeded';
import CheckoutBoard from './CheckoutBoard';

const MapView = dynamic(() => import('./MapView'), { ssr: false });

type MainView = 'map' | 'sections' | 'rate' | 'bands' | 'needed' | 'checkouts';

interface StationPresence {
  op_call: string;
  station: number;
  band: string;
  mode: string;
  updated_at: string;
}

const PRESENCE_POLL_MS = 15_000;
const INACTIVE_MS = 15 * 60 * 1000;

const MODE_COLORS: Record<string, string> = {
  PH:  'text-blue-400 light:text-blue-600',
  CW:  'text-yellow-400 light:text-yellow-600',
  DIG: 'text-green-400 light:text-green-600',
};

function formatUntil(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}Z`;
}

interface Props {
  event: Event;
  initialQSOs: QSO[];
  isVisitor?: boolean;
}

export default function DashboardClient({ event, initialQSOs, isVisitor = false }: Props) {
  const isSes = event.event_type === 'SES';

  const [qsos, setQSOs] = useState<QSO[]>(initialQSOs);
  // Map, Sections and Needed all chart the contest section multiplier, which
  // an SES doesn't have — its default view is the rate chart instead.
  const [mainView, setMainView] = useState<MainView>(isSes ? 'rate' : 'map');
  const [reservations, setReservations] = useState<SesReservation[]>([]);
  const [bonuses, setBonuses] = useState<Bonuses>(event.bonuses ?? {});
  const [showSummary, setShowSummary] = useState(false);
  const [presence, setPresence] = useState<StationPresence[]>([]);
  // Recovered from sessionStorage, same convention the join page uses — lets
  // the checkout board prefill "assign to me" for whoever is viewing.
  const [myOpCall, setMyOpCall] = useState('');

  // Web storage does not exist during SSR, so this genuinely cannot be read
  // while rendering and has to happen on mount. It runs once and settles; the
  // extra render is the unavoidable cost of the value being client-only.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const saved = sessionStorage.getItem(`ezfd_op_${event.join_code}`);
    if (saved) {
      try {
        const { call } = JSON.parse(saved);
        if (call) setMyOpCall(call);
      } catch {}
    }
  }, [event.join_code]);
  /* eslint-enable react-hooks/set-state-in-effect */


  // Bumped whenever checkouts change, so the timeline (which fetches its own
  // wider window, including past and released slots) reloads in step without
  // this component having to hold two differently-shaped reservation lists.
  const [reservationVersion, setReservationVersion] = useState(0);

  const refreshReservations = useCallback(async () => {
    if (!isSes) return;
    const res = await fetch(`/api/ses/reservations?event_id=${event.id}`).catch(() => null);
    if (res?.ok) {
      setReservations(await res.json());
      setReservationVersion(v => v + 1);
    }
  }, [event.id, isSes]);

  useEffect(() => {
    const es = new EventSource(`/api/realtime/${event.id}`);
    es.addEventListener('qso', (e: MessageEvent) => {
      const { op, record } = JSON.parse(e.data) as { op: string; record: QSO };
      if (op === 'INSERT') setQSOs(prev => prev.some(q => q.id === record.id) ? prev : [...prev, record]);
      else if (op === 'UPDATE') setQSOs(prev => prev.map(q => q.id === record.id ? record : q));
      else if (op === 'DELETE') setQSOs(prev => prev.filter(q => q.id !== record.id));
    });
    // Call checkouts ride the same stream; the payload carries the raw range
    // column, so this just signals "refetch".
    es.addEventListener('reservation', () => { void refreshReservations(); });
    return () => es.close();
  }, [event.id, refreshReservations]);

  useEffect(() => {
    if (!isSes) return;
    // the loader is async: whatever state it sets happens in a promise
    // continuation after an await, never synchronously during the effect, so
    // it cannot cascade a render. The rule cannot see through the async
    // boundary.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshReservations();
    const id = setInterval(refreshReservations, PRESENCE_POLL_MS);
    return () => clearInterval(id);
  }, [isSes, refreshReservations]);

  // Live band/mode per operator — same presence table BandActivity uses on
  // the logging page. Dashboard is read-only here: it polls but never
  // publishes its own presence row.
  useEffect(() => {
    let cancelled = false;
    async function fetchPresence() {
      const res = await fetch(`/api/presence?event_id=${event.id}`).catch(() => null);
      if (!cancelled && res?.ok) setPresence(await res.json());
    }
    fetchPresence();
    const id = setInterval(fetchPresence, PRESENCE_POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [event.id]);

  // One ticking clock for the whole dashboard: the "last hour" QSO count, the
  // active-reservation filter and the per-operator active dot all read it, and
  // all three previously only updated when something else forced a render.
  const nowMs = useNow(PRESENCE_POLL_MS);

  const score = calculateScore(qsos, bonuses, event.power);
  const oneHourAgo = new Date(nowMs - 60 * 60 * 1000).toISOString();
  const recentQSOs = qsos.filter(q => !q.is_dupe && (typeof q.datetime_utc === 'string' ? q.datetime_utc : q.datetime_utc.toISOString()) > oneHourAgo).length;

  const opStats: Record<string, { total: number; ph: number; cw: number; dig: number; first: number; last: number }> = {};
  for (const q of qsos) {
    if (q.is_dupe || !q.operator_call) continue;
    const op = q.operator_call;
    const t = new Date(q.datetime_utc).getTime();
    if (!opStats[op]) opStats[op] = { total: 0, ph: 0, cw: 0, dig: 0, first: t, last: t };
    const s = opStats[op];
    s.total++;
    if (q.mode === 'PH') s.ph++;
    else if (q.mode === 'CW') s.cw++;
    else s.dig++;
    if (t < s.first) s.first = t;
    if (t > s.last) s.last = t;
  }
  const operators = Object.keys(opStats).sort();

  const presenceByOp: Record<string, StationPresence> = {};
  for (const p of presence) presenceByOp[p.op_call] = p;

  // Union of ops who've logged a QSO and ops who are currently present but
  // haven't logged one yet (e.g. just signed on) — everyone gets a row.
  const allOpCalls = Array.from(new Set([...Object.keys(opStats), ...presence.map(p => p.op_call)]));

  const activeReservations = reservations.filter(r => {
    const start = new Date(r.starts_at).getTime();
    const end = r.ends_at ? new Date(r.ends_at).getTime() : Infinity;
    return start <= nowMs && end > nowMs;
  });

  const VIEW_TABS: { id: MainView; label: string }[] = isSes
    ? [
        { id: 'rate',      label: 'Rate' },
        { id: 'bands',     label: 'Bands' },
        { id: 'checkouts', label: 'Checkouts' },
      ]
    : [
        { id: 'map',      label: 'Map' },
        { id: 'sections', label: 'Sections' },
        { id: 'needed',   label: 'Needed' },
        { id: 'rate',     label: 'Rate' },
        { id: 'bands',    label: 'Bands' },
      ];

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-zinc-950 light:bg-white">
      <header className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900 px-6 py-3 light:border-zinc-200 light:bg-zinc-50 shrink-0 flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <span className="font-bold text-amber-400 text-xl">{event.club_call}</span>
          <span className="text-zinc-400 text-sm light:text-zinc-600">{event.club_name}</span>
          <span className="text-zinc-600 text-sm light:text-zinc-400">
            {isSes ? 'Special Event Station' : `${event.class} · ${event.arrl_section}`}
          </span>
          {isVisitor && (
            <span
              title="Read-only visitor mode — no sign-in, no logging, no operator actions"
              className="rounded border border-sky-700 bg-sky-900/30 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-400"
            >
              Visitor
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-sm flex-wrap">
          <UTCClock />

          <div className="flex rounded border border-zinc-700 overflow-hidden light:border-zinc-300">
            {VIEW_TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setMainView(tab.id)}
                className={`px-2 py-1 text-xs transition-colors ${
                  mainView === tab.id
                    ? 'bg-amber-400 text-zinc-900 font-semibold'
                    : 'text-zinc-400 hover:bg-zinc-800 light:text-zinc-600 light:hover:bg-zinc-100'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* The summary sheet is an ARRL entry submission worksheet. */}
          {!isSes && (
            <button
              onClick={() => setShowSummary(true)}
              className="rounded border border-zinc-700 px-3 py-1.5 text-zinc-300 hover:bg-zinc-800 light:border-zinc-300 light:text-zinc-600 light:hover:bg-zinc-100"
            >
              Summary
            </button>
          )}
          <Link href={`/event/${event.join_code}`}
            className="rounded border border-zinc-700 px-3 py-1.5 text-zinc-300 hover:bg-zinc-800 light:border-zinc-300 light:text-zinc-600 light:hover:bg-zinc-100">
            {isVisitor ? '← Exit' : '← Logger'}
          </Link>
          {!isVisitor && (
            <>
              <a href={`/api/export/${event.join_code}`}
                className="rounded border border-amber-700 px-3 py-1.5 text-amber-400 hover:bg-amber-400/10 light:border-amber-600 light:text-amber-700">
                ADIF
              </a>
              {!isSes && (
                <a href={`/api/export/${event.join_code}?format=cabrillo`}
                  className="rounded border border-amber-700 px-3 py-1.5 text-amber-400 hover:bg-amber-400/10 light:border-amber-600 light:text-amber-700">
                  Cabrillo
                </a>
              )}
            </>
          )}
          <ThemeToggle />
        </div>
      </header>

      <div className="flex flex-col flex-1 overflow-hidden md:flex-row">
        {/* overflow-hidden + a definite height give the pane's child a box to
            scroll inside; without it the Checkouts board grew past the
            flex row and was silently clipped by its overflow-hidden parent.
            Checkouts is a tall interactive form, so it gets more of the
            viewport than the at-a-glance map/chart views do on mobile. */}
        <div className={`shrink-0 overflow-hidden md:h-auto md:flex-1 ${
          mainView === 'checkouts' ? 'h-[65vh]' : 'h-56'
        }`}>
          {mainView === 'map'      && <MapView workedSections={score.sections} />}
          {mainView === 'sections' && <SectionGrid workedSections={score.sections} />}
          {mainView === 'needed'   && <SectionsNeeded workedSections={score.sections} unknownSections={score.unknown_sections} />}
          {mainView === 'rate'     && <RateChart qsos={qsos} />}
          {mainView === 'bands'    && <BandBreakdown score={score} />}
          {mainView === 'checkouts' && (
            <CheckoutBoard
              eventId={event.id}
              slotMinutes={event.slot_minutes ?? 120}
              eventStartsAt={event.starts_at}
              eventEndsAt={event.ends_at}
              reservations={reservations}
              onRefresh={refreshReservations}
              myOpCall={myOpCall}
              knownOperators={allOpCalls}
              readOnly={isVisitor}
              refreshToken={reservationVersion}
            />
          )}
        </div>

        <aside className="w-full md:w-72 flex flex-col gap-3 overflow-y-auto border-t md:border-t-0 md:border-l border-zinc-800 bg-zinc-900 p-4 light:border-zinc-200 light:bg-zinc-50">
          <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3 light:border-zinc-200 light:bg-white">
            <div className="text-xs text-zinc-500 uppercase tracking-wider mb-2">Rate</div>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-bold font-mono text-zinc-100 light:text-zinc-900">{recentQSOs}</span>
              <span className="text-zinc-400 text-sm light:text-zinc-600">QSO/hr</span>
            </div>
          </div>

          {/* An SES has no contest score, no power multiplier, no bonus
              points and no section multiplier — a QSO total is the whole
              story. */}
          {isSes ? (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3 light:border-zinc-200 light:bg-white">
              <div className="text-xs text-zinc-500 uppercase tracking-wider mb-2">Contacts</div>
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-bold font-mono text-amber-400">{score.valid_qsos}</span>
                <span className="text-zinc-400 text-sm light:text-zinc-600">QSOs</span>
              </div>
              <div className="mt-1 flex items-center gap-2 text-[11px]">
                {score.phone_qsos > 0 && <span className="text-blue-400 light:text-blue-600">{score.phone_qsos} PH</span>}
                {score.cw_qsos > 0 && <span className="text-yellow-400 light:text-yellow-600">{score.cw_qsos} CW</span>}
                {score.digital_qsos > 0 && <span className="text-green-400 light:text-green-600">{score.digital_qsos} DIG</span>}
              </div>
            </div>
          ) : (
            <>
              <Scoreboard score={score} bonusPoints={score.bonus_points} />

              <BonusTracker
                joinCode={event.join_code}
                initialBonuses={bonuses}
                baseScore={score.total_score}
                onBonusesChange={setBonuses}
                readOnly={isVisitor}
              />
            </>
          )}

          {/* Who currently has the shared callsign, read-only. */}
          {isSes && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3 light:border-zinc-200 light:bg-white">
              <div className="text-xs text-zinc-500 uppercase tracking-wider mb-2">On The Air</div>
              {activeReservations.length === 0 ? (
                <p className="text-[11px] text-zinc-600 light:text-zinc-400">
                  Nobody has the call checked out.
                </p>
              ) : (
                activeReservations.map(r => (
                  <div key={r.id} className="flex items-baseline justify-between gap-2 py-1 border-b border-zinc-800/50 last:border-0 light:border-zinc-200">
                    <span className="font-mono text-xs font-bold text-zinc-200 light:text-zinc-800">{r.op_call}</span>
                    <span className="flex items-center gap-1.5 font-mono text-[11px]">
                      <span className="text-amber-400 light:text-amber-700">{r.band}</span>
                      <span className={MODE_COLORS[r.mode] ?? 'text-zinc-400'}>{r.mode}</span>
                      <span className="text-zinc-500">{formatUntil(r.ends_at)}</span>
                    </span>
                  </div>
                ))
              )}
            </div>
          )}

          {!isSes && score.sections.length > 0 && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3 light:border-zinc-200 light:bg-white">
              <div className="text-xs text-zinc-500 uppercase tracking-wider mb-2">
                Sections Worked ({score.sections.length})
              </div>
              <div className="flex flex-wrap gap-1">
                {score.sections.map(s => (
                  <span key={s} className="rounded bg-amber-400/10 px-1.5 py-0.5 font-mono text-xs text-amber-400 light:bg-amber-50 light:text-amber-700">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}

          {allOpCalls.length > 0 && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3 light:border-zinc-200 light:bg-white">
              <div className="text-xs text-zinc-500 uppercase tracking-wider mb-2">Operators</div>
              {allOpCalls
                .map(op => ({ op, s: opStats[op] ?? { total: 0, ph: 0, cw: 0, dig: 0, first: 0, last: 0 } }))
                .sort((a, b) => b.s.total - a.s.total)
                .map(({ op, s }) => {
                  const windowHours = Math.max((s.last - s.first) / 3_600_000, 1);
                  const qhr = s.total > 0 ? Math.round(s.total / windowHours) : 0;
                  const p = presenceByOp[op];
                  const active = p ? (nowMs - new Date(p.updated_at).getTime()) <= INACTIVE_MS : false;
                  return (
                    <div key={op} className={`py-1 border-b border-zinc-800/50 last:border-0 light:border-zinc-200 ${p && !active ? 'opacity-40' : ''}`}>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="flex items-center gap-1.5 min-w-0">
                          {p && (
                            <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${active ? 'bg-green-400' : 'bg-zinc-600'}`} />
                          )}
                          <span className="font-mono text-xs font-bold text-zinc-200 light:text-zinc-800 truncate">{op}</span>
                        </span>
                        <span className="font-mono text-xs text-zinc-400 light:text-zinc-500 shrink-0">{s.total} Q · {qhr}/hr</span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
                        {p && (
                          <span className="flex items-center gap-1 text-[10px] font-mono">
                            <span className="text-amber-400 light:text-amber-700">{p.band}</span>
                            <span className={MODE_COLORS[p.mode] ?? 'text-zinc-400'}>{p.mode}</span>
                          </span>
                        )}
                        {s.ph > 0 && <span className="text-[10px] text-blue-400 light:text-blue-600">{s.ph} PH</span>}
                        {s.cw > 0 && <span className="text-[10px] text-yellow-400 light:text-yellow-600">{s.cw} CW</span>}
                        {s.dig > 0 && <span className="text-[10px] text-green-400 light:text-green-600">{s.dig} DIG</span>}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}

          <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3 light:border-zinc-200 light:bg-white">
            <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Join Code</div>
            <div className="font-mono text-2xl font-bold tracking-[0.3em] text-amber-400">{event.join_code}</div>
            <div className="text-xs text-zinc-500 mt-1">Share this with your operators</div>
          </div>
        </aside>
      </div>

      {showSummary && !isSes && (
        <SummarySheet
          event={event}
          score={score}
          bonuses={bonuses}
          operators={operators}
          onClose={() => setShowSummary(false)}
        />
      )}
    </div>
  );
}
