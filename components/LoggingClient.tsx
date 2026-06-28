'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import { calculateScore } from '@/lib/scoring';
import type { Event, QSO, Band, Mode } from '@/lib/types';
import { BANDS, MODES } from '@/lib/types';
import QSOForm from './QSOForm';
import QSOTable from './QSOTable';
import Scoreboard from './Scoreboard';

interface Props {
  event: Event;
  initialQSOs: QSO[];
  operatorCall: string;
  stationNumber: number;
}

export default function LoggingClient({ event, initialQSOs, operatorCall, stationNumber }: Props) {
  const router = useRouter();
  const [qsos, setQSOs] = useState<QSO[]>(initialQSOs);
  const [submitting, setSubmitting] = useState(false);
  const [lastLogged, setLastLogged] = useState<QSO | null>(null);
  const supabase = useRef(createClient());

  // Real-time subscription
  useEffect(() => {
    const channel = supabase.current
      .channel(`event-${event.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'qsos', filter: `event_id=eq.${event.id}` },
        (payload) => {
          const newQSO = payload.new as QSO;
          setQSOs(prev => {
            if (prev.some(q => q.id === newQSO.id)) return prev;
            return [newQSO, ...prev];
          });
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'qsos', filter: `event_id=eq.${event.id}` },
        (payload) => {
          setQSOs(prev => prev.filter(q => q.id !== (payload.old as QSO).id));
        }
      )
      .subscribe();

    return () => { supabase.current.removeChannel(channel); };
  }, [event.id]);

  const logQSO = useCallback(async (data: {
    callsign: string; band: Band; mode: Mode;
    rcvd_class: string; rcvd_section: string;
  }) => {
    setSubmitting(true);
    const res = await fetch('/api/qso', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_id: event.id,
        callsign: data.callsign,
        band: data.band,
        mode: data.mode,
        rcvd_class: data.rcvd_class,
        rcvd_section: data.rcvd_section,
        operator_call: operatorCall,
        station_number: stationNumber,
      }),
    });
    const qso = await res.json();
    if (res.ok) {
      setLastLogged(qso);
      // Optimistically add (realtime will dedupe)
      setQSOs(prev => prev.some(q => q.id === qso.id) ? prev : [qso, ...prev]);
    }
    setSubmitting(false);
    return res.ok ? qso : null;
  }, [event.id, operatorCall, stationNumber]);

  const deleteQSO = useCallback(async (id: string) => {
    await fetch(`/api/qso/${id}`, { method: 'DELETE' });
    setQSOs(prev => prev.filter(q => q.id !== id));
  }, []);

  const score = calculateScore(qsos);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900 px-4 py-2">
        <div className="flex items-center gap-3">
          <span className="font-bold text-amber-400 text-lg">{event.club_call}</span>
          <span className="text-zinc-500">|</span>
          <span className="text-zinc-300 text-sm">{event.class} · {event.arrl_section}</span>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-zinc-400">
            <span className="text-zinc-200 font-mono font-bold">{score.valid_qsos}</span> QSOs
            <span className="mx-1 text-zinc-600">·</span>
            <span className="text-zinc-200 font-mono font-bold">{score.sections_worked}</span> sec
            <span className="mx-1 text-zinc-600">·</span>
            <span className="text-amber-400 font-mono font-bold">{score.total_score.toLocaleString()}</span> pts
          </span>
          <span className="text-xs text-zinc-500 font-mono">OP: {operatorCall}</span>
          <button
            onClick={() => router.push(`/event/${event.join_code}/dashboard`)}
            className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
          >
            Dashboard
          </button>
          <a
            href={`/api/export/${event.join_code}`}
            className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
          >
            Export ADIF
          </a>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: form + score */}
        <aside className="flex w-80 flex-col gap-3 border-r border-zinc-800 bg-zinc-900 p-4">
          <QSOForm
            eventId={event.id}
            hasQRZ={!!event.qrz_username}
            onSubmit={logQSO}
            submitting={submitting}
            lastLogged={lastLogged}
            defaultBand="20m"
            defaultMode="PH"
          />
          <div className="mt-2">
            <Scoreboard score={score} />
          </div>
        </aside>

        {/* Right: log */}
        <main className="flex-1 overflow-hidden">
          <QSOTable qsos={qsos} onDelete={deleteQSO} currentOpCall={operatorCall} />
        </main>
      </div>
    </div>
  );
}
