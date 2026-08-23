'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useStoredFlag } from '@/lib/useStoredFlag';
import { useOnline } from '@/lib/useOnline';
import { useRouter } from 'next/navigation';
import { calculateScore } from '@/lib/scoring';
import { useRigBridge } from '@/lib/useRigBridge';
import { enqueue, dequeue, loadQueue, type PendingQSO } from '@/lib/offline-queue';
import { applyQsoEvent } from '@/lib/qsoStream';
import { ARRL_SECTIONS } from '@/lib/types';
import type { Event, QSO, Band, Mode, DisplayQSO, SesReservation } from '@/lib/types';
import type { QSOSubmission } from './QSOForm';
import QSOForm from './QSOForm';
import SesCoordination from './SesCoordination';
import QSOTable from './QSOTable';
import Scoreboard from './Scoreboard';
import BandActivity from './BandActivity';
import ClockSkewBanner from './ClockSkewBanner';
import UTCClock from './UTCClock';
import AdifImport from './AdifImport';
import WsjtxSetupHelp from './WsjtxSetupHelp';
import RigControlHelp from './RigControlHelp';
import SectionsNeeded from './SectionsNeeded';
import ThemeToggle from './ThemeToggle';

interface Props {
  event: Event;
  initialQSOs: QSO[];
  operatorCall: string;
  stationNumber: number;
  /** SES with roster approval on, and this operator isn't approved yet.
   *  The server rejects their QSOs; this is the up-front warning. */
  approvalPending?: boolean;
}

function pendingToDisplay(p: PendingQSO, sentClass: string | null, sentSection: string | null): DisplayQSO {
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
    rst_sent: p.rst_sent ?? null,
    rst_rcvd: p.rst_rcvd ?? null,
    rcvd_name: p.rcvd_name ?? null,
    rcvd_qth: p.rcvd_qth ?? null,
    rcvd_grid: p.rcvd_grid ?? null,
    comment: p.comment ?? null,
    adif_mode: null,
    freq_khz: null,
    _pending: true,
    _local_id: p.local_id,
  };
}

/** `replay` marks a QSO coming back off the offline queue. The server always
 *  accepts those, bypassing the SES band/mode gate: by reconnect time the slot
 *  has expired, and a contact that already happened on the air must never be
 *  dropped because the network blipped. */
async function submitQSOToServer(
  eventId: string,
  pending: PendingQSO,
  replay = false,
): Promise<{ qso: QSO | null; error?: string; warning?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch('/api/qso', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        event_id: eventId,
        callsign: pending.callsign,
        band: pending.band,
        mode: pending.mode,
        rcvd_class: pending.rcvd_class,
        rcvd_section: pending.rcvd_section,
        operator_call: pending.operator_call,
        station_number: pending.station_number,
        rst_sent: pending.rst_sent,
        rst_rcvd: pending.rst_rcvd,
        rcvd_name: pending.rcvd_name,
        rcvd_qth: pending.rcvd_qth,
        rcvd_grid: pending.rcvd_grid,
        comment: pending.comment,
        replay,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      return { qso: null, error: body.error ?? `Server error ${res.status}` };
    }
    const qso = await res.json() as QSO & { slot_warning?: string };
    return { qso, warning: qso.slot_warning };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Network error';
    return { qso: null, error: msg.includes('abort') ? 'Request timed out' : msg };
  } finally {
    clearTimeout(timeout);
  }
}

export default function LoggingClient({ event, initialQSOs, operatorCall, stationNumber, approvalPending = false }: Props) {
  const router = useRouter();
  const [confirmedQSOs, setConfirmedQSOs] = useState<QSO[]>(initialQSOs);
  const [pendingQSOs, setPendingQSOs] = useState<DisplayQSO[]>([]);
  const isOnline = useOnline();
  const [pendingCount, setPendingCount] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [lastLogged, setLastLogged] = useState<DisplayQSO | null>(null);
  const [nightMode, setNightMode] = useStoredFlag('ezfd_night');
  const [currentBand, setCurrentBand] = useState<Band>('20m');
  const [currentMode, setCurrentMode] = useState<Mode>('PH');
  const [mobileTab, setMobileTab] = useState<'log' | 'qsos'>('log');
  const [showAdifImport, setShowAdifImport] = useState(false);
  const [showWsjtxHelp, setShowWsjtxHelp] = useState(false);
  const [showNeeds, setShowNeeds] = useState(false);
  const [bandConflict, setBandConflict] = useState(false);
  const [bandOccupancy, setBandOccupancy] = useState<Partial<Record<Band, string[]>>>({});
  const [showRigHelp, setShowRigHelp] = useState(false);
  // SES: advisory notice when a QSO was logged on a band/mode this operator
  // hasn't checked out. Under SOFT enforcement the QSO is still logged.
  const [slotWarning, setSlotWarning] = useState<string | null>(null);
  const [holdsSlot, setHoldsSlot] = useState(false);
  // Bumped on each SSE reservation event so SesCoordination refetches without
  // opening a second EventSource for the same event.
  const [reservationVersion, setReservationVersion] = useState(0);
  const syncingRef = useRef(false);

  const isSes = event.event_type === 'SES';

  const rig = useRigBridge({ onBand: setCurrentBand, onMode: setCurrentMode });
  const rigConnected = rig.connected;
  const rigFreq = rig.freq;

  function toggleNight() {
    setNightMode(prev => !prev);
  }

  // Restore any pending QSOs from localStorage on mount
  // Web storage does not exist during SSR, so this genuinely cannot be read
  // while rendering and has to happen on mount. It runs once and settles; the
  // extra render is the unavoidable cost of the value being client-only.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const stored = loadQueue(event.id);
    if (stored.length > 0) {
      setPendingQSOs(stored.map(p => pendingToDisplay(p, event.class, event.arrl_section)));
      setPendingCount(stored.length);
    }
  }, [event.id, event.class, event.arrl_section]);
  /* eslint-enable react-hooks/set-state-in-effect */


  // SSE subscription for real-time QSO updates
  useEffect(() => {
    const es = new EventSource(`/api/realtime/${event.id}`);

    es.addEventListener('qso', (e: MessageEvent) => {
      const { op, record } = JSON.parse(e.data) as { op: string; record: QSO };
      setConfirmedQSOs(prev => applyQsoEvent(prev, op, record, true));
    });

    // Call checkouts arrive on the same stream (the realtime route LISTENs on
    // both channels). The payload carries the raw range column rather than the
    // decomposed timestamps the UI wants, so this just signals "refetch".
    es.addEventListener('reservation', () => setReservationVersion(v => v + 1));

    es.onerror = () => {
      // Browser will auto-reconnect for SSE; errors here are transient
    };

    return () => es.close();
  }, [event.id]);

  // If this operator already holds a live checkout when they sign in — e.g.
  // arriving right at the start of their scheduled slot — start the form on
  // that band/mode instead of the 20m/PH default, since that's what they're
  // here to work.
  useEffect(() => {
    if (!isSes) return;
    let cancelled = false;
    fetch(`/api/ses/reservations?event_id=${event.id}`)
      .then(r => r.ok ? r.json() as Promise<SesReservation[]> : null)
      .then(rows => {
        if (cancelled || !rows) return;
        const now = Date.now();
        const mine = rows.find(r => {
          if (r.op_call !== operatorCall) return false;
          const start = new Date(r.starts_at).getTime();
          const end = r.ends_at ? new Date(r.ends_at).getTime() : Infinity;
          return start <= now && end > now;
        });
        if (mine) {
          setCurrentBand(mine.band);
          setCurrentMode(mine.mode);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isSes, event.id, operatorCall]);

  const flushQueue = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    for (const pending of loadQueue(event.id)) {
      // replay=true — the server accepts these unconditionally.
      const result = await submitQSOToServer(event.id, pending, true);
      // Only drop the queued copy once the server has actually taken it.
      // Checking the wrapper object here instead of result.qso meant a failed
      // submit still dequeued, silently losing the contact.
      if (!result.qso) break;
      dequeue(event.id, pending.local_id);
      setPendingQSOs(prev => prev.filter(p => p._local_id !== pending.local_id));
      setPendingCount(prev => Math.max(0, prev - 1));
    }
    syncingRef.current = false;
  }, [event.id]);

  // The connectivity *value* comes from useOnline; this effect exists only
  // for the side effect of draining the offline queue on the transition back
  // to online. flushQueue is deliberately not in the deps — see its own note.
  useEffect(() => {
    // the loader is async: whatever state it sets happens in a promise
    // continuation after an await, never synchronously during the effect, so
    // it cannot cascade a render. The rule cannot see through the async
    // boundary.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isOnline) flushQueue();
  }, [isOnline, flushQueue]);

  const logQSO = useCallback(async (data: QSOSubmission) => {
    setSubmitting(true);
    setSubmitError(null);
    setSlotWarning(null);
    try {
      const pending = enqueue(event.id, {
        ...data,
        rcvd_class: data.rcvd_class,
        rcvd_section: data.rcvd_section,
        operator_call: operatorCall,
        station_number: stationNumber,
      });
      const display = pendingToDisplay(pending, event.class, event.arrl_section);
      setPendingQSOs(prev => [display, ...prev]);
      setPendingCount(prev => prev + 1);
      setLastLogged(display);

      if (navigator.onLine) {
        const { qso, error, warning } = await submitQSOToServer(event.id, pending);
        if (warning) setSlotWarning(warning);
        if (qso) {
          dequeue(event.id, pending.local_id);
          setPendingQSOs(prev => prev.filter(p => p._local_id !== pending.local_id));
          setPendingCount(prev => Math.max(0, prev - 1));
          setLastLogged(qso as DisplayQSO);
          // On mobile, briefly flip to the QSO list so the operator sees it land
          if (window.innerWidth < 768) setMobileTab('qsos');
        } else if (error) {
          setSubmitError(error);
        }
      }
    } finally {
      setSubmitting(false);
    }
  }, [event.id, event.class, event.arrl_section, operatorCall, stationNumber]);

  const handleHoldingChange = useCallback((holding: boolean) => setHoldsSlot(holding), []);

  const updateQSO = useCallback((updated: QSO) => {
    setConfirmedQSOs(prev => prev.map(q => q.id === updated.id ? updated : q));
  }, []);

  const deleteQSO = useCallback(async (id: string, localId?: string) => {
    if (localId) {
      dequeue(event.id, localId);
      setPendingQSOs(prev => prev.filter(p => p._local_id !== localId));
      setPendingCount(prev => Math.max(0, prev - 1));
      return;
    }
    // The actor rides along so the audit trail records who claimed to do it.
    await fetch(`/api/qso/${id}?operator_call=${encodeURIComponent(operatorCall)}`, { method: 'DELETE' });
    setConfirmedQSOs(prev => prev.filter(q => q.id !== id));
  }, [event.id]);

  const displayQSOs: DisplayQSO[] = [
    ...pendingQSOs,
    ...confirmedQSOs.map(q => q as DisplayQSO),
  ];
  const score = calculateScore(confirmedQSOs, {}, event.power);

  // Most recent confirmed QSO by this operator — SesCoordination auto-extends
  // a slot only for someone actually working the band.
  const myLastQsoAt = confirmedQSOs.reduce<string | null>((latest, q) => {
    if (q.operator_call !== operatorCall) return latest;
    const iso = typeof q.datetime_utc === 'string' ? q.datetime_utc : q.datetime_utc.toISOString();
    return !latest || iso > latest ? iso : latest;
  }, null);

  return (
    <div data-night={nightMode ? 'true' : undefined} className="night-scope flex h-screen flex-col overflow-hidden bg-zinc-950 light:bg-white">
      <header className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900 px-4 py-2 flex-shrink-0 light:border-zinc-200 light:bg-zinc-50">
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-bold text-amber-400 text-lg shrink-0">{event.club_call}</span>
          <span className="text-zinc-600 hidden sm:inline">|</span>
          <span className="text-zinc-300 text-sm shrink-0 hidden sm:inline">
            {isSes ? 'Special Event' : `${event.class} · ${event.arrl_section}`}
          </span>
          {event.location && (
            <span className="text-zinc-500 text-sm truncate hidden lg:block">{event.location}</span>
          )}
        </div>

        <div className="flex items-center gap-2 text-sm flex-shrink-0">
          <UTCClock />
          {rigConnected && (
            <button
              onClick={() => setShowRigHelp(true)}
              title="Rig control active — click for details"
              className="hidden sm:inline-flex items-center gap-1.5 rounded border border-green-700 bg-green-900/30 px-2 py-0.5 text-[10px] font-semibold text-green-400 hover:bg-green-900/50 transition-colors">
              <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse shrink-0" />
              <span className="uppercase tracking-wide">RIG</span>
              {rigFreq && (
                <span className="font-mono font-normal text-green-300 tracking-tight">
                  {(rigFreq / 1e6).toFixed(3)}
                </span>
              )}
            </button>
          )}
          {rigConnected && rig.canCw && (
            <button
              onClick={() => window.open(
                `/event/${event.join_code}/cw?op=${encodeURIComponent(operatorCall)}&station=${stationNumber}`,
                `ezfd_cw_${event.join_code}`,
                'width=520,height=880,noopener'
              )}
              title="Open the CW macro + keying window"
              className="hidden sm:inline-flex items-center gap-1 rounded border border-amber-700 bg-amber-900/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-400 hover:bg-amber-900/40 transition-colors">
              ⚡ CW
            </button>
          )}
          <span className="text-zinc-600 hidden sm:inline">|</span>
          {/* A special event station has no contest score — just a QSO count. */}
          <span className="text-zinc-400 hidden sm:inline light:text-zinc-500">
            <span className="text-zinc-200 font-mono font-bold light:text-zinc-800">{score.valid_qsos}</span>
            <span className="text-zinc-600 mx-1">Q</span>
            {!isSes && (
              <>
                <span className="text-zinc-200 font-mono font-bold light:text-zinc-800">{score.sections_worked}</span>
                <span className="text-zinc-600 mx-1">×</span>
                <span className="text-amber-400 font-mono font-bold">{score.total_score.toLocaleString()}</span>
              </>
            )}
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

          <button
            onClick={() => {
              sessionStorage.removeItem(`ezfd_op_${event.join_code}`);
              router.push(`/event/${event.join_code}`);
            }}
            title="Change operator"
            className="hidden md:inline-flex items-center gap-1.5 rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-500 hover:bg-zinc-800 light:border-zinc-300 light:text-zinc-600 light:hover:bg-zinc-100"
          >
            <span className="text-zinc-500 light:text-zinc-400 text-[10px] font-semibold uppercase tracking-wide">Op On</span>
            <span className="font-mono font-semibold">{operatorCall}</span>
            <span className="text-zinc-500">⇄</span>
          </button>

          {/* ThemeToggle hidden on mobile — moved to mobile tab bar */}
          <span className="hidden sm:contents"><ThemeToggle /></span>

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
            className="hidden sm:block rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800 light:border-zinc-300 light:text-zinc-600 light:hover:bg-zinc-100">
            Dashboard
          </button>

          <div className="hidden sm:flex gap-1">
            <button
              onClick={() => setShowAdifImport(true)}
              className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
              title="Import QSOs from WSJT-X / JTDX ADIF file"
            >
              Import ADIF
            </button>
            <a href={`/api/export/${event.join_code}`}
              className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800">
              ADIF
            </a>
            {/* Cabrillo is a contest submission format — nothing to submit for an SES. */}
            {!isSes && (
              <a href={`/api/export/${event.join_code}?format=cabrillo`}
                className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800">
                Cabrillo
              </a>
            )}
          </div>
        </div>
      </header>

      {/* Mobile tab bar */}
      <div className="shrink-0 border-b border-zinc-800 bg-zinc-900 md:hidden light:border-zinc-200 light:bg-zinc-50">
        <div className="flex items-center justify-between px-3 py-1 border-b border-zinc-800/50 light:border-zinc-200">
          <span className="font-mono text-xs text-zinc-400 light:text-zinc-600">
            <span className="text-zinc-200 font-bold light:text-zinc-800">{score.valid_qsos}</span>
            <span className="text-zinc-600 mx-1">Q</span>
            {!isSes && (
              <>
                <span className="text-zinc-200 font-bold light:text-zinc-800">{score.sections_worked}</span>
                <span className="text-zinc-600 mx-1">×</span>
                <span className="text-amber-400 font-bold">{score.total_score.toLocaleString()}</span>
              </>
            )}
          </span>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <button
              onClick={() => router.push(`/event/${event.join_code}/dashboard`)}
              className="rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-400 hover:bg-zinc-800 light:border-zinc-300 light:text-zinc-600"
            >
              Dashboard
            </button>
            <button
              onClick={() => {
                sessionStorage.removeItem(`ezfd_op_${event.join_code}`);
                router.push(`/event/${event.join_code}`);
              }}
              className="flex items-center gap-1.5 text-xs border border-zinc-700 rounded px-2 py-0.5 light:border-zinc-300 light:text-zinc-600"
            >
              <span className="text-zinc-500 light:text-zinc-400 text-[10px] font-semibold uppercase tracking-wide">Op On</span>
              <span className="font-mono font-semibold text-zinc-300 light:text-zinc-700">{operatorCall}</span>
              <span className="text-zinc-500">⇄</span>
            </button>
          </div>
        </div>
        <div className="flex">
          <button
            onClick={() => setMobileTab('log')}
            className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
              mobileTab === 'log'
                ? 'border-b-2 border-amber-400 text-amber-400'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            Log QSO
          </button>
          <button
            onClick={() => setMobileTab('qsos')}
            className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
              mobileTab === 'qsos'
                ? 'border-b-2 border-amber-400 text-amber-400'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            QSOs ({displayQSOs.length})
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <aside className={`${mobileTab === 'log' ? 'flex' : 'hidden'} md:flex w-full md:w-80 flex-col gap-3 overflow-y-auto border-r border-zinc-800 bg-zinc-900 p-4 shrink-0 light:border-zinc-200 light:bg-zinc-50`}>
          {/* For an SES the checkout panel is authoritative about who may
              transmit, so the presence-based conflict warning would just be
              noise on top of it. */}
          {/* A wrong server clock mis-stamps every QSO and looks like nothing is
              wrong, so it outranks the band/slot warnings below it. */}
          <ClockSkewBanner />
          {bandConflict && !isSes && (
            <div className="flex items-center gap-2 rounded-lg border border-yellow-600 bg-yellow-900/30 px-3 py-2 text-xs text-yellow-400">
              <span className="text-base">⚠</span>
              <span>Another station is on <strong>{currentBand} {currentMode}</strong> — band conflict!</span>
            </div>
          )}
          {approvalPending && (
            <div className="flex items-start gap-2 rounded-lg border border-red-700 bg-red-900/30 px-3 py-2 text-xs text-red-400">
              <span className="text-base leading-none">⛔</span>
              <span>
                <strong>{operatorCall}</strong> isn&apos;t approved to operate this event yet.
                QSOs will be refused until the coordinator approves you.
              </span>
            </div>
          )}
          {isSes && slotWarning && (
            <div className="flex items-start gap-2 rounded-lg border border-yellow-600 bg-yellow-900/30 px-3 py-2 text-xs text-yellow-400">
              <span className="text-base leading-none">⚠</span>
              <span>{slotWarning} The QSO was logged anyway.</span>
            </div>
          )}
          {isSes && !holdsSlot && !slotWarning && (
            <div className="rounded-lg border border-zinc-700 bg-zinc-800/40 px-3 py-2 text-xs text-zinc-400 light:border-zinc-300 light:bg-zinc-100 light:text-zinc-600">
              You haven&apos;t checked out <strong>{currentBand} {currentMode}</strong> — check it out below before calling.
            </div>
          )}
          <QSOForm
            eventId={event.id}
            eventType={event.event_type}
            dupeRule={event.dupe_rule}
            hasQRZ={!!event.qrz_username}
            hasCallHistory={!!event.use_call_history}
            hasMasterCall={!!event.use_master_callsign_file}
            band={currentBand}
            mode={currentMode}
            onBandChange={setCurrentBand}
            onModeChange={setCurrentMode}
            onSubmit={logQSO}
            submitting={submitting}
            lastLogged={lastLogged}
            submitError={submitError}
            onDigHelp={() => setShowWsjtxHelp(true)}
            existingQSOs={confirmedQSOs}
            bandOccupancy={bandOccupancy}
          />
          {/* Contests get the same panel. Field Day has the same
              one-signal-per-band-per-mode rule and a multi-transmitter club
              has exactly this coordination problem — the difference is that
              the holder is the station rather than the operator, so it reads
              as a station schedule rather than a call checkout. */}
          <SesCoordination
            eventId={event.id}
            myOpCall={operatorCall}
            stationNumber={isSes ? null : stationNumber}
            currentBand={currentBand}
            currentMode={currentMode}
            slotMinutes={event.slot_minutes ?? 120}
            eventStartsAt={event.starts_at}
            eventEndsAt={event.ends_at}
            refreshToken={reservationVersion}
            lastQsoAt={myLastQsoAt}
            onHoldingChange={handleHoldingChange}
          />
          <BandActivity
            eventId={event.id}
            myOpCall={operatorCall}
            myStation={stationNumber}
            currentBand={currentBand}
            currentMode={currentMode}
            qsos={displayQSOs}
            onConflict={setBandConflict}
            onBandOccupancy={setBandOccupancy}
            rigConnected={rigConnected}
            onRigHelp={() => setShowRigHelp(true)}
          />
          {/* Contest scoring and section chasing don't apply to an SES. */}
          {!isSes && (
            <>
              <Scoreboard score={score} />
              <button
                type="button"
                onClick={() => setShowNeeds(true)}
                className="w-full rounded-lg border border-zinc-700 py-2 text-xs font-semibold text-zinc-400 hover:border-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 transition-colors light:border-zinc-300 light:text-zinc-600 light:hover:bg-zinc-100"
              >
                Sections Needed ({Math.max(0, ARRL_SECTIONS.length - score.sections_worked)})
              </button>
            </>
          )}
        </aside>

        <main className={`${mobileTab === 'qsos' ? 'flex flex-col' : 'hidden'} md:flex md:flex-col flex-1 overflow-hidden`}>
          <QSOTable qsos={displayQSOs} onDelete={deleteQSO} onUpdate={updateQSO} currentOpCall={operatorCall} eventId={event.id} />
        </main>
      </div>

      {showAdifImport && (
        <AdifImport
          eventId={event.id}
          operatorCall={operatorCall}
          stationNumber={stationNumber}
          onClose={() => setShowAdifImport(false)}
        />
      )}

      {showWsjtxHelp && (
        <WsjtxSetupHelp
          joinCode={event.join_code}
          operatorCall={operatorCall}
          stationNumber={stationNumber}
          onClose={() => setShowWsjtxHelp(false)}
        />
      )}

      {showRigHelp && (
        <RigControlHelp
          rigConnected={rigConnected}
          canCw={rig.canCw}
          onClose={() => setShowRigHelp(false)}
        />
      )}

      {showNeeds && (
        <div
          className="fixed inset-0 z-[1000] flex items-start justify-center bg-black/75 p-4 overflow-y-auto"
          onClick={e => { if (e.target === e.currentTarget) setShowNeeds(false); }}
        >
          <div className="w-full max-w-lg my-8 rounded-xl border border-zinc-700 bg-zinc-900 light:border-zinc-200 light:bg-white">
            <div className="flex items-center justify-between border-b border-zinc-800 light:border-zinc-200 px-4 py-3">
              <h2 className="font-semibold text-zinc-200 light:text-zinc-800">Sections Needed</h2>
              <button
                onClick={() => setShowNeeds(false)}
                className="rounded border border-zinc-700 px-3 py-1 text-xs text-zinc-400 hover:bg-zinc-800 light:border-zinc-300 light:text-zinc-500"
              >
                Close
              </button>
            </div>
            <SectionsNeeded workedSections={score.sections} unknownSections={score.unknown_sections} />
          </div>
        </div>
      )}
    </div>
  );
}
