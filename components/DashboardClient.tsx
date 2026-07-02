'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { calculateScore } from '@/lib/scoring';
import type { Event, QSO, Bonuses } from '@/lib/types';
import Scoreboard from './Scoreboard';
import SectionGrid from './SectionGrid';
import ThemeToggle from './ThemeToggle';
import UTCClock from './UTCClock';
import BonusTracker from './BonusTracker';
import RateChart from './RateChart';
import BandBreakdown from './BandBreakdown';
import SummarySheet from './SummarySheet';
import SectionsNeeded from './SectionsNeeded';

const MapView = dynamic(() => import('./MapView'), { ssr: false });

type MainView = 'map' | 'sections' | 'rate' | 'bands' | 'needed';

interface Props {
  event: Event;
  initialQSOs: QSO[];
  isVisitor?: boolean;
}

export default function DashboardClient({ event, initialQSOs, isVisitor = false }: Props) {
  const [qsos, setQSOs] = useState<QSO[]>(initialQSOs);
  const [mainView, setMainView] = useState<MainView>('map');
  const [bonuses, setBonuses] = useState<Bonuses>(event.bonuses ?? {});
  const [showSummary, setShowSummary] = useState(false);

  useEffect(() => {
    const es = new EventSource(`/api/realtime/${event.id}`);
    es.addEventListener('qso', (e: MessageEvent) => {
      const { op, record } = JSON.parse(e.data) as { op: string; record: QSO };
      if (op === 'INSERT') setQSOs(prev => prev.some(q => q.id === record.id) ? prev : [...prev, record]);
      else if (op === 'UPDATE') setQSOs(prev => prev.map(q => q.id === record.id ? record : q));
      else if (op === 'DELETE') setQSOs(prev => prev.filter(q => q.id !== record.id));
    });
    return () => es.close();
  }, [event.id]);

  const score = calculateScore(qsos, bonuses, event.power);
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
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

  const VIEW_TABS: { id: MainView; label: string }[] = [
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
          <span className="text-zinc-600 text-sm light:text-zinc-400">{event.class} · {event.arrl_section}</span>
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

          <button
            onClick={() => setShowSummary(true)}
            className="rounded border border-zinc-700 px-3 py-1.5 text-zinc-300 hover:bg-zinc-800 light:border-zinc-300 light:text-zinc-600 light:hover:bg-zinc-100"
          >
            Summary
          </button>
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
              <a href={`/api/export/${event.join_code}?format=cabrillo`}
                className="rounded border border-amber-700 px-3 py-1.5 text-amber-400 hover:bg-amber-400/10 light:border-amber-600 light:text-amber-700">
                Cabrillo
              </a>
            </>
          )}
          <ThemeToggle />
        </div>
      </header>

      <div className="flex flex-col flex-1 overflow-hidden md:flex-row">
        <div className="h-56 shrink-0 md:h-auto md:flex-1">
          {mainView === 'map'      && <MapView workedSections={score.sections} />}
          {mainView === 'sections' && <SectionGrid workedSections={score.sections} />}
          {mainView === 'needed'   && <SectionsNeeded workedSections={score.sections} />}
          {mainView === 'rate'     && <RateChart qsos={qsos} />}
          {mainView === 'bands'    && <BandBreakdown score={score} />}
        </div>

        <aside className="w-full md:w-72 flex flex-col gap-3 overflow-y-auto border-t md:border-t-0 md:border-l border-zinc-800 bg-zinc-900 p-4 light:border-zinc-200 light:bg-zinc-50">
          <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3 light:border-zinc-200 light:bg-white">
            <div className="text-xs text-zinc-500 uppercase tracking-wider mb-2">Rate</div>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-bold font-mono text-zinc-100 light:text-zinc-900">{recentQSOs}</span>
              <span className="text-zinc-400 text-sm light:text-zinc-600">QSO/hr</span>
            </div>
          </div>

          <Scoreboard score={score} bonusPoints={score.bonus_points} />

          <BonusTracker
            joinCode={event.join_code}
            initialBonuses={bonuses}
            baseScore={score.total_score}
            onBonusesChange={setBonuses}
            readOnly={isVisitor}
          />

          {score.sections.length > 0 && (
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

          {Object.keys(opStats).length > 0 && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3 light:border-zinc-200 light:bg-white">
              <div className="text-xs text-zinc-500 uppercase tracking-wider mb-2">Operators</div>
              {Object.entries(opStats)
                .sort((a, b) => b[1].total - a[1].total)
                .map(([op, s]) => {
                  const windowHours = Math.max((s.last - s.first) / 3_600_000, 1);
                  const qhr = Math.round(s.total / windowHours);
                  return (
                    <div key={op} className="py-1 border-b border-zinc-800/50 last:border-0 light:border-zinc-200">
                      <div className="flex items-baseline justify-between">
                        <span className="font-mono text-xs font-bold text-zinc-200 light:text-zinc-800">{op}</span>
                        <span className="font-mono text-xs text-zinc-400 light:text-zinc-500">{s.total} Q · {qhr}/hr</span>
                      </div>
                      {s.total > 0 && (
                        <div className="mt-0.5 flex gap-1">
                          {s.ph > 0 && <span className="text-[10px] text-blue-400 light:text-blue-600">{s.ph} PH</span>}
                          {s.cw > 0 && <span className="text-[10px] text-yellow-400 light:text-yellow-600">{s.cw} CW</span>}
                          {s.dig > 0 && <span className="text-[10px] text-green-400 light:text-green-600">{s.dig} DIG</span>}
                        </div>
                      )}
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

      {showSummary && (
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
