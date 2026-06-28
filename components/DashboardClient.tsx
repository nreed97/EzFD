'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { calculateScore } from '@/lib/scoring';
import type { Event, QSO } from '@/lib/types';
import Scoreboard from './Scoreboard';
import UTCClock from './UTCClock';

const MapView = dynamic(() => import('./MapView'), { ssr: false });

interface Props {
  event: Event;
  initialQSOs: QSO[];
}

export default function DashboardClient({ event, initialQSOs }: Props) {
  const [qsos, setQSOs] = useState<QSO[]>(initialQSOs);

  // SSE subscription — same endpoint as the logger
  useEffect(() => {
    const es = new EventSource(`/api/realtime/${event.id}`);

    es.addEventListener('qso', (e: MessageEvent) => {
      const { op, record } = JSON.parse(e.data) as { op: string; record: QSO };
      if (op === 'INSERT') {
        setQSOs(prev => prev.some(q => q.id === record.id) ? prev : [...prev, record]);
      } else if (op === 'DELETE') {
        setQSOs(prev => prev.filter(q => q.id !== record.id));
      }
    });

    return () => es.close();
  }, [event.id]);

  const score = calculateScore(qsos);
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const recentQSOs = qsos.filter(q => !q.is_dupe && q.datetime_utc > oneHourAgo).length;

  const byOp: Record<string, number> = {};
  for (const q of qsos) {
    if (!q.is_dupe && q.operator_call) {
      byOp[q.operator_call] = (byOp[q.operator_call] ?? 0) + 1;
    }
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900 px-6 py-3">
        <div className="flex items-center gap-3">
          <span className="font-bold text-amber-400 text-xl">{event.club_call}</span>
          <span className="text-zinc-400 text-sm">{event.club_name}</span>
          <span className="text-zinc-600 text-sm">{event.class} · {event.arrl_section}</span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <UTCClock />
          <Link href={`/event/${event.join_code}/log?op=&station=1`}
            className="rounded border border-zinc-700 px-3 py-1.5 text-zinc-300 hover:bg-zinc-800">
            ← Logger
          </Link>
          <a href={`/api/export/${event.join_code}`}
            className="rounded border border-amber-700 px-3 py-1.5 text-amber-400 hover:bg-amber-400/10">
            ADIF
          </a>
          <a href={`/api/export/${event.join_code}?format=cabrillo`}
            className="rounded border border-amber-700 px-3 py-1.5 text-amber-400 hover:bg-amber-400/10">
            Cabrillo
          </a>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1">
          <MapView workedSections={score.sections} />
        </div>

        <aside className="w-72 flex flex-col gap-4 overflow-y-auto border-l border-zinc-800 bg-zinc-900 p-4">
          <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
            <div className="text-xs text-zinc-500 uppercase tracking-wider mb-2">Rate</div>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-bold font-mono text-zinc-100">{recentQSOs}</span>
              <span className="text-zinc-400 text-sm">QSO/hr</span>
            </div>
          </div>

          <Scoreboard score={score} />

          {score.sections.length > 0 && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
              <div className="text-xs text-zinc-500 uppercase tracking-wider mb-2">
                Sections Worked ({score.sections.length})
              </div>
              <div className="flex flex-wrap gap-1">
                {score.sections.map(s => (
                  <span key={s} className="rounded bg-amber-400/10 px-1.5 py-0.5 font-mono text-xs text-amber-400">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}

          {Object.keys(byOp).length > 0 && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
              <div className="text-xs text-zinc-500 uppercase tracking-wider mb-2">Operators</div>
              {Object.entries(byOp)
                .sort((a, b) => b[1] - a[1])
                .map(([op, count]) => (
                  <div key={op} className="flex items-center justify-between py-0.5">
                    <span className="font-mono text-xs text-zinc-300">{op}</span>
                    <span className="font-mono text-xs text-zinc-400">{count} QSOs</span>
                  </div>
                ))}
            </div>
          )}

          <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
            <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Join Code</div>
            <div className="font-mono text-2xl font-bold tracking-[0.3em] text-amber-400">{event.join_code}</div>
            <div className="text-xs text-zinc-500 mt-1">Share this with your operators</div>
          </div>
        </aside>
      </div>
    </div>
  );
}
