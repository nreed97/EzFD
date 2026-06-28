'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import { calculateScore } from '@/lib/scoring';
import { enqueue, dequeue, loadQueue, type PendingQSO } from '@/lib/offline-queue';
import type { Event, QSO, Band, Mode, DisplayQSO } from '@/lib/types';
import QSOForm from './QSOForm';
import QSOTable from './QSOTable';
import Scoreboard from './Scoreboard';

interface Props {
  event: Event;
  initialQSOs: QSO[];
  operatorCall: string;
  stationNumber: number;
}

function pendingToDisplay(p: PendingQSO, sentClass: string, sentSection: string): DisplayQSO {
  return {
    id: p.local_id,
    event_id: p.event_id,
    callsign: p.callsign,
    band: p.band,
    mode: p.mode,
    datetime_utc: p.submitted_at,
    sent_class: sentClass,
    sent_section: sentSection,
    rcvd_class: p.rcvd_class || null,
    rcvd_section: p.rcvd_section || null,
    operator_call: p.operator_call,
    station_number: p.station_number,
    is_dupe: false,
    created_at: p.submitted_at,
    _pending: true,
    _local_id: p.local_id,
  };
}

async function submitQSOToServer(eventId: string, pending: PendingQSO): Promise<QSO | null> {
  try {
    const res = await fetch('/api/qso', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_id: eventId,
        callsign: pending.callsign,
        band: pending.band,
        mode: pending.mode,
        rcvd_class: pending.rcvd_class,
        rcvd_section: pending.rcvd_section,
        operator_call: pending.operator_call,
        station_number: pending.station_number,
      }),
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export default function LoggingClient({ event, initialQSOs, operatorCall, stationNumber }: Props) {
  const router = useRouter();
  const [confirmedQSOs, setConfirmedQSOs] = useState<QSO[]>(initialQSOs);
  // Pending = queued locally, not yet confirmed by server
  const [pendingQSOs, setPendingQSOs] = useState<DisplayQSO[]>([]);
  const [isOnline, setIsOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [lastLogged, setLastLogged] = useState<DisplayQSO | null>(null);
  const supabase = useRef(createClient());
  const syncingRef = useRef(false);

  // Load any leftover pending QSOs from storage on mount
  useEffect(() => {
    const stored = loadQueue(event.id);
    if (stored.length > 0) {
      const displays = stored.map(p => pendingToDisplay(p, event.class, event.arrl_section));
      setPendingQSOs(displays);
      setPendingCount(stored.length);
    }
  }, [event.id, event.class, event.arrl_section]);

  // Real-time subscription for confirmed QSOs from all ops
  useEffect(() => {
    const client = supabase.current;
    const channel = client
      .channel(`event-${event.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'qsos', filter: `event_id=eq.${event.id}` },
        (payload) => {
          const newQSO = payload.new as QSO;
          setConfirmedQSOs(prev => prev.some(q => q.id === newQSO.id) ? prev : [newQSO, ...prev]);
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'qsos', filter: `event_id=eq.${event.id}` },
        (payload) => {
          setConfirmedQSOs(prev => prev.filter(q => q.id !== (payload.old as QSO).id));
        }
      )
      .subscribe();

    return () => { client.removeChannel(channel); };
  }, [event.id]);

  // Sync queue to server, processing in order
  const flushQueue = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;

    const queue = loadQueue(event.id);
    for (const pending of queue) {
      const result = await submitQSOToServer(event.id, pending);
      if (!result) break; // Still offline — stop and wait for next online event

      dequeue(event.id, pending.local_id);
      setPendingQSOs(prev => prev.filter(p => p._local_id !== pending.local_id));
      setPendingCount(prev => Math.max(0, prev - 1));
      // Real QSO will arrive via Realtime subscription
    }

    syncingRef.current = false;
  }, [event.id]);

  // Online/offline detection
  useEffect(() => {
    function onOnline() {
      setIsOnline(true);
      flushQueue();
    }
    function onOffline() { setIsOnline(false); }

    setIsOnline(navigator.onLine);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [flushQueue]);

  const logQSO = useCallback(async (data: {
    callsign: string; band: Band; mode: Mode;
    rcvd_class: string; rcvd_section: string;
  }) => {
    setSubmitting(true);

    // 1. Always write to local queue first
    const pending = enqueue(event.id, {
      callsign: data.callsign,
      band: data.band,
      mode: data.mode,
      rcvd_class: data.rcvd_class,
      rcvd_section: data.rcvd_section,
      operator_call: operatorCall,
      station_number: stationNumber,
    });

    const display = pendingToDisplay(pending, event.class, event.arrl_section);
    setPendingQSOs(prev => [display, ...prev]);
    setPendingCount(prev => prev + 1);
    setLastLogged(display);

    // 2. Try to sync immediately
    if (navigator.onLine) {
      const result = await submitQSOToServer(event.id, pending);
      if (result) {
        dequeue(event.id, pending.local_id);
        setPendingQSOs(prev => prev.filter(p => p._local_id !== pending.local_id));
        setPendingCount(prev => Math.max(0, prev - 1));
        setLastLogged({ ...result });
      }
      // If failed despite being "online", it stays in queue; next flush will retry
    }

    setSubmitting(false);
  }, [event.id, event.class, event.arrl_section, operatorCall, stationNumber]);

  const deleteQSO = useCallback(async (id: string, localId?: string) => {
    // Delete from pending queue
    if (localId) {
      dequeue(event.id, localId);
      setPendingQSOs(prev => prev.filter(p => p._local_id !== localId));
      setPendingCount(prev => Math.max(0, prev - 1));
      return;
    }
    // Delete from server
    await fetch(`/api/qso/${id}`, { method: 'DELETE' });
    setConfirmedQSOs(prev => prev.filter(q => q.id !== id));
  }, [event.id]);

  // Merge pending + confirmed for display (pending first, then confirmed, deduped)
  const confirmedIds = new Set(confirmedQSOs.map(q => q.id));
  const displayQSOs: DisplayQSO[] = [
    ...pendingQSOs,
    ...confirmedQSOs.map(q => q as DisplayQSO),
  ];

  // Score only counts confirmed QSOs (pending ones aren't duped-checked yet)
  const score = calculateScore(confirmedQSOs);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900 px-4 py-2">
        <div className="flex items-center gap-3">
          <span className="font-bold text-amber-400 text-lg">{event.club_call}</span>
          <span className="text-zinc-500">|</span>
          <span className="text-zinc-300 text-sm">{event.class} · {event.arrl_section}</span>
          {event.location && <span className="text-zinc-500 text-sm hidden md:inline">{event.location}</span>}
        </div>

        <div className="flex items-center gap-3 text-sm">
          {/* Live score */}
          <span className="text-zinc-400">
            <span className="text-zinc-200 font-mono font-bold">{score.valid_qsos}</span>
            <span className="text-zinc-600 mx-1">QSOs</span>
            <span className="text-zinc-200 font-mono font-bold">{score.sections_worked}</span>
            <span className="text-zinc-600 mx-1">sec</span>
            <span className="text-amber-400 font-mono font-bold">{score.total_score.toLocaleString()}</span>
            <span className="text-zinc-600 mx-1">pts</span>
          </span>

          {/* Offline / pending indicator */}
          {!isOnline && (
            <span className="rounded bg-red-900/50 border border-red-700 px-2 py-0.5 text-xs text-red-400">
              OFFLINE
            </span>
          )}
          {pendingCount > 0 && (
            <button
              onClick={flushQueue}
              className="rounded bg-yellow-900/50 border border-yellow-700 px-2 py-0.5 text-xs text-yellow-400 hover:bg-yellow-900"
              title="Click to retry syncing"
            >
              {pendingCount} pending{isOnline ? ' — click to sync' : ''}
            </button>
          )}

          <span className="text-xs text-zinc-500 font-mono">OP: {operatorCall} / STN {stationNumber}</span>

          <button
            onClick={() => router.push(`/event/${event.join_code}/dashboard`)}
            className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
          >
            Dashboard
          </button>

          <div className="flex gap-1">
            <a
              href={`/api/export/${event.join_code}`}
              className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
            >
              ADIF
            </a>
            <a
              href={`/api/export/${event.join_code}?format=cabrillo`}
              className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
            >
              Cabrillo
            </a>
          </div>
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
          <QSOTable qsos={displayQSOs} onDelete={deleteQSO} currentOpCall={operatorCall} />
        </main>
      </div>
    </div>
  );
}
