'use client';

import { useState, useEffect, useCallback } from 'react';
import { useNow } from '@/lib/useNow';
import dynamic from 'next/dynamic';
import { calculateScore } from '@/lib/scoring';
import { applyQsoEvent } from '@/lib/qsoStream';
import { operatorStats, UNATTRIBUTED } from '@/lib/opStats';
import { toggleLightMode } from '@/lib/useLightMode';
import type { Event, QSO, Bonuses, SesReservation } from '@/lib/types';
import Scoreboard from './Scoreboard';
import SectionGrid from './SectionGrid';
import UTCClock from './UTCClock';
import BonusTracker from './BonusTracker';
import RateChart from './RateChart';
import BandBreakdown from './BandBreakdown';
import SummarySheet from './SummarySheet';
import SectionsNeeded from './SectionsNeeded';
import CheckoutBoard from './CheckoutBoard';
import LogView from './LogView';
import OperatorStats from './OperatorStats';
import NavDrawer from './NavDrawer';

const MapView = dynamic(() => import('./MapView'), { ssr: false });

type MainView = 'map' | 'sections' | 'rate' | 'bands' | 'needed' | 'checkouts' | 'log' | 'ops';

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
  // The log opens first, for both event types. It is the thing a dashboard is
  // usually put up to show — contacts arriving — and it is the only view that
  // answers a question about a specific QSO. The section map and the rate
  // chart are a tab away and cost nothing to reach; a log that needs a click
  // is the wrong way round on a screen nobody is standing at.
  const [mainView, setMainView] = useState<MainView>('log');
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
      setQSOs(prev => applyQsoEvent(prev, op, record, false));
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

  const score = calculateScore(qsos, bonuses, event.power, { eventType: event.event_type, entryClass: event.class });
  const oneHourAgo = new Date(nowMs - 60 * 60 * 1000).toISOString();
  const recentQSOs = qsos.filter(q => !q.is_dupe && (typeof q.datetime_utc === 'string' ? q.datetime_utc : q.datetime_utc.toISOString()) > oneHourAgo).length;

  // One table, read by both the sidebar panel and the Operators tab. It used
  // to be counted inline here and the panel divided by a clamped span for its
  // rate; the tab would have been a second derivation of the same figures,
  // which is how the section list and the bonus schedule came to disagree
  // with themselves. lib/opStats.ts is the only place any of this is worked
  // out now.
  const opTable = operatorStats(qsos, event.event_type);
  const opRows = new Map(opTable.rows.map(r => [r.call, r]));
  const operators = opTable.rows
    .map(r => r.call)
    .filter((c): c is string => c !== UNATTRIBUTED)
    .sort();

  const presenceByOp: Record<string, StationPresence> = {};
  for (const p of presence) presenceByOp[p.op_call] = p;

  // Union of ops who've logged a QSO and ops who are currently present but
  // haven't logged one yet (e.g. just signed on) — everyone gets a row.
  const allOpCalls = Array.from(new Set([...operators, ...presence.map(p => p.op_call)]));

  const activeReservations = reservations.filter(r => {
    const start = new Date(r.starts_at).getTime();
    const end = r.ends_at ? new Date(r.ends_at).getTime() : Infinity;
    return start <= nowMs && end > nowMs;
  });

  const VIEW_TABS: { id: MainView; label: string }[] = isSes
    ? [
        { id: 'log',       label: 'Log' },
        { id: 'rate',      label: 'Rate' },
        { id: 'bands',     label: 'Bands' },
        { id: 'ops',       label: 'Operators' },
        { id: 'checkouts', label: 'Checkouts' },
      ]
    : [
        { id: 'log',      label: 'Log' },
        { id: 'map',      label: 'Map' },
        { id: 'sections', label: 'Sections' },
        { id: 'needed',   label: 'Needed' },
        { id: 'rate',     label: 'Rate' },
        { id: 'bands',    label: 'Bands' },
        { id: 'ops',      label: 'Operators' },
      ];

  // Built once and rendered into whichever header row is visible, so there is
  // only ever one hamburger on the page and only one set of handlers.
  const navMenu = (
    <NavDrawer
      ctx={{
        surface: 'dashboard',
        joinCode: event.join_code,
        eventType: event.event_type,
        isVisitor,
      }}
      handlers={{
        summary: () => setShowSummary(true),
        toggleTheme: toggleLightMode,
      }}
      heading={
        <span className="block truncate font-mono text-xs text-zinc-400 light:text-zinc-600">
          {event.club_call} · {isSes ? 'Special Event' : `${event.class} · ${event.arrl_section}`}
        </span>
      }
    />
  );

  // How tall the content pane is on a phone, where the page scrolls. Three
  // cases, and the difference is whether the view has a natural size:
  //
  //   * the map and the rate chart *need* a definite box — neither has an
  //     intrinsic height, and both would collapse without one;
  //   * the log, the operators table and the checkout board are unbounded, so
  //     they keep their own scroll rather than turning a thousand contacts
  //     into a 27,000px document;
  //   * the section grids are bounded by the section list, so they simply
  //     render, and the page scrolls past them. A 224px window onto an 812px
  //     grid was the same peephole the sidebar used to be.
  //
  // On a desktop none of this applies: md:h-auto md:flex-1 md:overflow-hidden
  // restores the fixed two-pane shell.
  const mobilePane =
    mainView === 'map' || mainView === 'rate'
      ? 'h-56 overflow-hidden'
      : mainView === 'log' || mainView === 'ops' || mainView === 'checkouts'
        ? 'h-[70vh] overflow-hidden'
        : 'h-auto';

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 light:bg-white md:h-screen md:overflow-hidden">
      {/* Two rows on a phone, one on a desktop. Identity, clock and the menu
          share the first; the view tabs get the second to themselves and
          scroll sideways rather than wrapping.

          Six action buttons used to sit up here as well — Summary, Logger,
          ADIF, Cabrillo, Backup and the theme toggle — mixed in with the seven
          view tabs. Two different kinds of thing in one row gave a reader no
          way to scan for either, and on a 390px phone the lot wrapped to four
          rows: 199px of an 844px screen gone before the filter bar started.
          The actions are in the drawer now, which has room to say what each
          one is. */}
      <header className="sticky top-0 z-30 flex shrink-0 flex-col gap-2 border-b border-zinc-800 bg-zinc-900 px-4 py-2 light:border-zinc-200 light:bg-zinc-50 md:static md:flex-row md:items-center md:justify-between md:gap-3 md:px-6 md:py-3">
      {/* `md:contents` dissolves this wrapper on a desktop so identity, tabs
          and the clock/menu become three flex children of the header in
          `order` sequence. On a phone it stays a real row, holding the
          identity beside the clock and the menu. Either way the drawer is
          rendered exactly once — two instances would be two components with
          separate state, which is the duplication this whole change removes. */}
        <div className="flex min-w-0 items-center gap-3 md:contents">
          <span className="shrink-0 text-xl font-bold text-amber-400 md:order-1">{event.club_call}</span>
          <span className="truncate text-sm text-zinc-400 light:text-zinc-600 md:order-1">{event.club_name}</span>
          <span className="hidden shrink-0 text-sm text-zinc-600 light:text-zinc-400 sm:inline md:order-1">
            {isSes ? 'Special Event Station' : `${event.class} · ${event.arrl_section}`}
          </span>
          {isVisitor && (
            <span
              title="Read-only visitor mode — no sign-in, no logging, no operator actions"
              className="shrink-0 rounded border border-sky-700 bg-sky-900/30 px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide text-sky-400 md:order-1"
            >
              Visitor
            </span>
          )}
          {/* On a phone these ride the identity line so the tab strip below
              gets the full width to scroll in; on a desktop `order` sends them
              to the far end of the single row. */}
          <span className="ml-auto flex shrink-0 items-center gap-2 md:order-3 md:ml-0">
            <UTCClock />
            {navMenu}
          </span>
        </div>

        <div className="flex min-w-0 items-center gap-2 text-sm md:order-2">
          {/* Seven tabs will never fit across a phone. One scrollable row
              keeps every view one tap away without costing a second line. */}
          <div className="ezfd-tabstrip flex min-w-0 flex-1 overflow-x-auto rounded border border-zinc-700 light:border-zinc-300 md:flex-none">
            {VIEW_TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setMainView(tab.id)}
                className={`shrink-0 whitespace-nowrap px-3 py-1.5 text-xs transition-colors md:px-2 md:py-1 ${
                  mainView === tab.id
                    ? 'bg-amber-400 font-semibold text-zinc-900'
                    : 'text-zinc-400 hover:bg-zinc-800 light:text-zinc-600 light:hover:bg-zinc-100'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

        </div>
      </header>

      {/* On a desktop this is two panes that each scroll inside a page that
          does not. On a phone that shape produced two stacked peepholes and no
          page scroll at all: a 413px window onto the log, and below it a
          *194px* window onto 1170px of rate, score, bonuses, sections,
          operators and the join code. Reading the join code meant scrolling a
          box the size of two lines.

          So the phone scrolls the page instead. The log keeps its own scroll,
          because a table is a thing you scroll and it is unbounded — a
          thousand-contact log rendered at natural height is a 27,000px
          document on a handset — but everything below it is laid out in full
          and reached by scrolling the page, which is what a thumb expects. */}
      <div className="flex flex-1 flex-col md:flex-row md:overflow-hidden">
        {/* overflow-hidden + a definite height give the pane's child a box to
            scroll inside; without it the Checkouts board grew past the
            flex row and was silently clipped by its overflow-hidden parent.
            Checkouts is a tall interactive form, so it gets more of the
            viewport than the at-a-glance map/chart views do on mobile. */}
        <div className={`shrink-0 md:h-auto md:flex-1 md:overflow-hidden ${mobilePane}`}>
          {mainView === 'log'      && <LogView event={event} qsos={qsos} />}
          {mainView === 'map'      && <MapView workedSections={score.sections} />}
          {mainView === 'sections' && <SectionGrid workedSections={score.sections} />}
          {mainView === 'needed'   && <SectionsNeeded workedSections={score.sections} unknownSections={score.unknown_sections} />}
          {mainView === 'rate'     && <RateChart qsos={qsos} />}
          {mainView === 'bands'    && <BandBreakdown score={score} />}
          {mainView === 'ops'      && (
            <OperatorStats
              qsos={qsos}
              eventType={event.event_type}
              presence={presence}
              nowMs={nowMs}
            />
          )}
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

        {/* No scroll of its own on a phone — it is part of the page there, and
            giving it one is what made it a peephole. The desktop pane keeps
            its own, since it sits beside the content rather than under it. */}
        <aside className="flex w-full shrink-0 flex-col gap-3 border-t border-zinc-800 bg-zinc-900 p-4 light:border-zinc-200 light:bg-zinc-50 md:w-72 md:shrink md:overflow-y-auto md:border-t-0 md:border-l">
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
              <div className="mt-1 flex items-center gap-2 text-2xs">
                {score.phone_qsos > 0 && <span className="text-blue-400 light:text-blue-600">{score.phone_qsos} PH</span>}
                {score.cw_qsos > 0 && <span className="text-yellow-400 light:text-yellow-600">{score.cw_qsos} CW</span>}
                {score.digital_qsos > 0 && <span className="text-green-400 light:text-green-600">{score.digital_qsos} DIG</span>}
              </div>
            </div>
          ) : (
            <>
              <Scoreboard score={score} bonusPoints={score.bonus_points} isWfd={event.event_type === 'WFD'} />

              <BonusTracker
                gotaQsos={score.gota_qsos}
                joinCode={event.join_code}
                initialBonuses={bonuses}
                eventType={event.event_type}
                entryClass={event.class}
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
                <p className="text-2xs text-zinc-600 light:text-zinc-400">
                  Nobody has the call checked out.
                </p>
              ) : (
                activeReservations.map(r => (
                  <div key={r.id} className="flex items-baseline justify-between gap-2 py-1 border-b border-zinc-800/50 last:border-0 light:border-zinc-200">
                    <span className="font-mono text-xs font-bold text-zinc-200 light:text-zinc-800">{r.op_call}</span>
                    <span className="flex items-center gap-1.5 font-mono text-2xs">
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
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <span className="text-xs text-zinc-500 uppercase tracking-wider">Operators</span>
                <button
                  onClick={() => setMainView('ops')}
                  className="text-2xs text-zinc-500 underline decoration-dotted underline-offset-2 hover:text-amber-400 light:hover:text-amber-700"
                >
                  Details
                </button>
              </div>
              {allOpCalls
                .map(op => ({ op, s: opRows.get(op) }))
                .sort((a, b) => (b.s?.qsos ?? 0) - (a.s?.qsos ?? 0))
                .map(({ op, s }) => {
                  // The panel's rate is the operator's best hour, the same
                  // figure the Operators tab prints. It used to be their
                  // total divided by however long they had been sitting
                  // there, clamped to an hour — which reads a 60-in-the-first
                  // -hour run as 15/hr once the band goes quiet, and would
                  // have disagreed with the tab on the same screen.
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
                        <span
                          title="Contacts logged, and the most this operator worked in any 60 minutes"
                          className="font-mono text-xs text-zinc-400 light:text-zinc-500 shrink-0"
                        >
                          {s?.qsos ?? 0} Q · {s?.bestHour ?? 0}/hr
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
                        {p && (
                          <span className="flex items-center gap-1 text-2xs font-mono">
                            <span className="text-amber-400 light:text-amber-700">{p.band}</span>
                            <span className={MODE_COLORS[p.mode] ?? 'text-zinc-400'}>{p.mode}</span>
                          </span>
                        )}
                        {(s?.ph ?? 0) > 0 && <span className="text-2xs text-blue-400 light:text-blue-600">{s!.ph} PH</span>}
                        {(s?.cw ?? 0) > 0 && <span className="text-2xs text-yellow-400 light:text-yellow-600">{s!.cw} CW</span>}
                        {(s?.dig ?? 0) > 0 && <span className="text-2xs text-green-400 light:text-green-600">{s!.dig} DIG</span>}
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
          qsos={qsos}
          bonuses={bonuses}
          operators={operators}
          onClose={() => setShowSummary(false)}
        />
      )}
    </div>
  );
}
