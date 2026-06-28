'use client';

import { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { createClient } from '@/lib/supabase';
import { calculateScore } from '@/lib/scoring';
import type { Event, QSO } from '@/lib/types';
import Scoreboard from './Scoreboard';

const MapView = dynamic(() => import('./MapView'), { ssr: false });

interface Props {
  event: Event;
  initialQSOs: QSO[];
}

export default function DashboardClient({ event, initialQSOs }: Props) {
  const [qsos, setQSOs] = useState<QSO[]>(initialQSOs);
  const supabase = useRef(createClient());

  useEffect(() => {
    const channel = supabase.current
      .channel(`dashboard-${event.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'qsos', filter: `event_id=eq.${event.id}` },
        () => {
          // Re-fetch on any change
          fetch(`/api/qso?event_id=${event.id}`)
            .then(r => r.json())
            .then(data => setQSOs(data ?? []));
        }
      )
      .subscribe();

    return () => { supabase.current.removeChannel(channel); };
  }, [event.id]);

  const score = calculateScore(qsos);

  // Rate tracking: QSOs per hour (last 60 min)
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const recentQSOs = qsos.filter(q => !q.is_dupe && q.datetime_utc > oneHourAgo).length;

  // Operator breakdown
  const byOp: Record<string, number> = {};
  for (const q of qsos) {
    if (!q.is_dupe && q.operator_call) {
      byOp[q.operator_call] = (byOp[q.operator_call] ?? 0) + 1;
    }
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900 px-6 py-3">
        <div>
          <span className="font-bold text-amber-400 text-xl">{event.club_call}</span>
          <span className="ml-3 text-zinc-400 text-sm">{event.club_name}</span>
          <span className="ml-3 text-zinc-600 text-sm">{event.class} · {event.arrl_section}</span>
        </div>
        <div className="flex gap-3 text-sm">
          <Link href={`/event/${event.join_code}/log?op=&station=1`}
            className="rounded border border-zinc-700 px-3 py-1.5 text-zinc-300 hover:bg-zinc-800">
            ← Logger
          </Link>
          <a href={`/api/export/${event.join_code}`}
            className="rounded border border-amber-700 px-3 py-1.5 text-amber-400 hover:bg-amber-400/10">
            Export ADIF
          </a>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden gap-0">
        {/* Map */}
        <div className="flex-1">
          <MapView workedSections={score.sections} />
        </div>

        {/* Stats sidebar */}
        <aside className="w-72 flex flex-col gap-4 overflow-y-auto border-l border-zinc-800 bg-zinc-900 p-4">
          {/* Rate */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
            <div className="text-xs text-zinc-500 uppercase tracking-wider mb-2">Rate</div>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-bold font-mono text-zinc-100">{recentQSOs}</span>
              <span className="text-zinc-400 text-sm">QSO/hr</span>
            </div>
          </div>

          <Scoreboard score={score} />

          {/* Sections worked */}
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

          {/* Operators */}
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

          {/* Join info */}
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
