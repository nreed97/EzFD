'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { calculateScore, calculateBonusPoints } from '@/lib/scoring';
import type { Event, QSO, Bonuses } from '@/lib/types';
import Scoreboard from './Scoreboard';
import SectionGrid from './SectionGrid';
import ThemeToggle from './ThemeToggle';
import UTCClock from './UTCClock';
import BonusTracker from './BonusTracker';
import RateChart from './RateChart';
import BandBreakdown from './BandBreakdown';
import SummarySheet from './SummarySheet';

const MapView = dynamic(() => import('./MapView'), { ssr: false });

type MainView = 'map' | 'sections' | 'rate' | 'bands';

interface Props {
  event: Event;
  initialQSOs: QSO[];
}

export default function DashboardClient({ event, initialQSOs }: Props) {
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

  const score = calculateScore(qsos, bonuses);
  const bonusPoints = calculateBonusPoints(bonuses, score.total_score);
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const recentQSOs = qsos.filter(q => !q.is_dupe && q.datetime_utc > oneHourAgo).length;

  const byOp: Record<string, number> = {};
  for (const q of qsos) {
    if (!q.is_dupe && q.operator_call) {
      byOp[q.operator_call] = (byOp[q.operator_call] ?? 0) + 1;
    }
  }
  const operators = Object.keys(byOp).sort();

  const VIEW_TABS: { id: MainView; label: string }[] = [
    { id: 'map',      label: 'Map' },
    { id: 'sections', label: 'Sections' },
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
            ← Logger
          </Link>
          <a href={`/api/export/${event.join_code}`}
            className="rounded border border-amber-700 px-3 py-1.5 text-amber-400 hover:bg-amber-400/10 light:border-amber-600 light:text-amber-700">
            ADIF
          </a>
          <a href={`/api/export/${event.join_code}?format=cabrillo`}
            className="rounded border border-amber-700 px-3 py-1.5 text-amber-400 hover:bg-amber-400/10 light:border-amber-600 light:text-amber-700">
            Cabrillo
          </a>
          <ThemeToggle />
        </div>
      </header>

      <div className="flex flex-col flex-1 overflow-hidden md:flex-row">
        <div className="h-56 shrink-0 md:h-auto md:flex-1">
          {mainView === 'map'      && <MapView workedSections={score.sections} />}
          {mainView === 'sections' && <SectionGrid workedSections={score.sections} />}
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

          <Scoreboard score={score} bonusPoints={bonusPoints} />

          <BonusTracker
            joinCode={event.join_code}
            initialBonuses={bonuses}
            baseScore={score.total_score}
            onBonusesChange={setBonuses}
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

          {Object.keys(byOp).length > 0 && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3 light:border-zinc-200 light:bg-white">
              <div className="text-xs text-zinc-500 uppercase tracking-wider mb-2">Operators</div>
              {Object.entries(byOp)
                .sort((a, b) => b[1] - a[1])
                .map(([op, count]) => (
                  <div key={op} className="flex items-center justify-between py-0.5">
                    <span className="font-mono text-xs text-zinc-300 light:text-zinc-700">{op}</span>
                    <span className="font-mono text-xs text-zinc-400 light:text-zinc-500">{count} QSOs</span>
                  </div>
                ))}
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
