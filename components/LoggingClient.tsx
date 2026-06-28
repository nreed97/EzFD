'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { calculateScore } from '@/lib/scoring';
import { enqueue, dequeue, loadQueue, type PendingQSO } from '@/lib/offline-queue';
import type { Event, QSO, Band, Mode, DisplayQSO } from '@/lib/types';
import QSOForm from './QSOForm';
import QSOTable from './QSOTable';
import Scoreboard from './Scoreboard';
import BandActivity from './BandActivity';
import UTCClock from './UTCClock';

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
  const [pendingQSOs, setPendingQSOs] = useState<DisplayQSO[]>([]);
  const [isOnline, setIsOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [lastLogged, setLastLogged] = useState<DisplayQSO | null>(null);
  const [nightMode, setNightMode] = useState(false);
  const [currentBand, setCurrentBand] = useState<Band>('20m');
  const [currentMode, setCurrentMode] = useState<Mode>('PH');
  const syncingRef = useRef(false);

  useEffect(() => {
    setNightMode(localStorage.getItem('ezfd_night') === '1');
  }, []);

  function toggleNight() {
    setNightMode(prev => {
      const next = !prev;
      localStorage.setItem('ezfd_night', next ? '1' : '0');
      return next;
    });
  }

  // Restore any pending QSOs from localStorage on mount
  useEffect(() => {
    const stored = loadQueue(event.id);
    if (stored.length > 0) {
      setPendingQSOs(stored.map(p => pendingToDisplay(p, event.class, event.arrl_section)));
      setPendingCount(stored.length);
    }
  }, [event.id, event.class, event.arrl_section]);

  // SSE subscription for real-time QSO updates
  useEffect(() => {
    const es = new EventSource(`/api/realtime/${event.id}`);

    es.addEventListener('qso', (e: MessageEvent) => {
      const { op, record } = JSON.parse(e.data) as { op: string; record: QSO };
      if (op === 'INSERT') {
        setConfirmedQSOs(prev => prev.some(q => q.id === record.id) ? prev : [record, ...prev]);
      } else if (op === 'DELETE') {
        setConfirmedQSOs(prev => prev.filter(q => q.id !== record.id));
      }
    });

    es.onerror = () => {
      // Browser will auto-reconnect for SSE; errors here are transient
    };

    return () => es.close();
  }, [event.id]);

  const flushQueue = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    for (const pending of loadQueue(event.id)) {
      const result = await submitQSOToServer(event.id, pending);
      if (!result) break;
      dequeue(event.id, pending.local_id);
      setPendingQSOs(prev => prev.filter(p => p._local_id !== pending.local_id));
      setPendingCount(prev => Math.max(0, prev - 1));
    }
    syncingRef.current = false;
  }, [event.id]);

  useEffect(() => {
    const onOnline  = () => { setIsOnline(true); flushQueue(); };
    const onOffline = () => setIsOnline(false);
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
    const pending = enqueue(event.id, { ...data, operator_call: operatorCall, station_number: stationNumber });
    const display = pendingToDisplay(pending, event.class, event.arrl_section);
    setPendingQSOs(prev => [display, ...prev]);
    setPendingCount(prev => prev + 1);
    setLastLogged(display);

    if (navigator.onLine) {
      const result = await submitQSOToServer(event.id, pending);
      if (result) {
        dequeue(event.id, pending.local_id);
        setPendingQSOs(prev => prev.filter(p => p._local_id !== pending.local_id));
        setPendingCount(prev => Math.max(0, prev - 1));
        setLastLogged(result as DisplayQSO);
      }
    }
    setSubmitting(false);
  }, [event.id, event.class, event.arrl_section, operatorCall, stationNumber]);

  const deleteQSO = useCallback(async (id: string, localId?: string) => {
    if (localId) {
      dequeue(event.id, localId);
      setPendingQSOs(prev => prev.filter(p => p._local_id !== localId));
      setPendingCount(prev => Math.max(0, prev - 1));
      return;
    }
    await fetch(`/api/qso/${id}`, { method: 'DELETE' });
    setConfirmedQSOs(prev => prev.filter(q => q.id !== id));
  }, [event.id]);

  const displayQSOs: DisplayQSO[] = [
    ...pendingQSOs,
    ...confirmedQSOs.map(q => q as DisplayQSO),
  ];
  const score = calculateScore(confirmedQSOs);

  return (
    <div data-night={nightMode ? 'true' : undefined} className="night-scope flex h-screen flex-col overflow-hidden bg-zinc-950">
      <header className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900 px-4 py-2 flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-bold text-amber-400 text-lg shrink-0">{event.club_call}</span>
          <span className="text-zinc-600">|</span>
          <span className="text-zinc-300 text-sm shrink-0">{event.class} · {event.arrl_section}</span>
          {event.location && (
            <span className="text-zinc-500 text-sm truncate hidden lg:block">{event.location}</span>
          )}
        </div>

        <div className="flex items-center gap-2 text-sm flex-shrink-0">
          <UTCClock />
          <span className="text-zinc-600 hidden sm:inline">|</span>
          <span className="text-zinc-400 hidden sm:inline">
            <span className="text-zinc-200 font-mono font-bold">{score.valid_qsos}</span>
            <span className="text-zinc-600 mx-1">Q</span>
            <span className="text-zinc-200 font-mono font-bold">{score.sections_worked}</span>
            <span className="text-zinc-600 mx-1">×</span>
            <span className="text-amber-400 font-mono font-bold">{score.total_score.toLocaleString()}</span>
          </span>

          {!isOnline && (
            <span className="rounded bg-red-900/50 border border-red-700 px-2 py-0.5 text-xs text-red-400">
              OFFLINE
            </span>
          )}
          {pendingCount > 0 && (
            <button onClick={flushQueue}
              className="rounded bg-yellow-900/50 border border-yellow-700 px-2 py-0.5 text-xs text-yellow-400 hover:bg-yellow-900">
              {pendingCount} pending{isOnline ? ' ↑' : ''}
            </button>
          )}

          <span className="text-xs text-zinc-500 font-mono hidden md:inline">
            {operatorCall}
          </span>

          <button onClick={toggleNight}
            title={nightMode ? 'Exit night mode' : 'Enter night mode (preserves dark adaptation)'}
            className={`rounded border px-2 py-1 text-xs transition-colors ${
              nightMode
                ? 'border-red-800 bg-red-900/40 text-red-400 hover:bg-red-900/60'
                : 'border-zinc-700 text-zinc-400 hover:bg-zinc-800'
            }`}>
            {nightMode ? '☀ Day' : '☾ Night'}
          </button>

          <button onClick={() => router.push(`/event/${event.join_code}/dashboard`)}
            className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800">
            Dashboard
          </button>

          <div className="flex gap-1">
            <a href={`/api/export/${event.join_code}`}
              className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800">
              ADIF
            </a>
            <a href={`/api/export/${event.join_code}?format=cabrillo`}
              className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800">
              Cabrillo
            </a>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="flex w-80 flex-col gap-3 overflow-y-auto border-r border-zinc-800 bg-zinc-900 p-4 flex-shrink-0">
          <QSOForm
            eventId={event.id}
            hasQRZ={!!event.qrz_username}
            band={currentBand}
            mode={currentMode}
            onBandChange={setCurrentBand}
            onModeChange={setCurrentMode}
            onSubmit={logQSO}
            submitting={submitting}
            lastLogged={lastLogged}
          />
          <BandActivity
            eventId={event.id}
            myOpCall={operatorCall}
            myStation={stationNumber}
            currentBand={currentBand}
            currentMode={currentMode}
          />
          <Scoreboard score={score} />
        </aside>

        <main className="flex-1 overflow-hidden">
          <QSOTable qsos={displayQSOs} onDelete={deleteQSO} currentOpCall={operatorCall} />
        </main>
      </div>
    </div>
  );
}
