'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useStoredFlag } from '@/lib/useStoredFlag';
import { useRouter } from 'next/navigation';
import { calculateScore } from '@/lib/scoring';
import { useRigBridge, rigPortForStation } from '@/lib/useRigBridge';
import { useQsoQueue } from '@/lib/useQsoQueue';
import { applyQsoEvent } from '@/lib/qsoStream';
import { ARRL_SECTIONS, transmitterCount } from '@/lib/types';
import { bandsFor, MODES } from '@/lib/bands';
import { rememberPosition } from '@/lib/lastPosition';
import type { Event, QSO, Band, Mode, DisplayQSO, SesReservation } from '@/lib/types';
import type { QSOSubmission } from './QSOForm';
import QSOForm from './QSOForm';
import NavDrawer, { type NavHandlers } from './NavDrawer';
import { toggleLightMode } from '@/lib/useLightMode';
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

interface Props {
  event: Event;
  initialQSOs: QSO[];
  operatorCall: string;
  stationNumber: number;
  /** This window is logging at the GOTA station (#23). Every contact it takes
   *  carries the flag, and the header signs the GOTA call. */
  isGota?: boolean;
  /** SES with roster approval on, and this operator isn't approved yet.
   *  The server rejects their QSOs; this is the up-front warning. */
  approvalPending?: boolean;
  /** Where the operator said they were sitting, from the position picker.
   *  Validated here rather than trusted: these arrive in the URL, so a typo
   *  or a stale bookmark must fall back rather than put the form on a band
   *  the event does not offer. */
  initialBand?: string;
  initialMode?: string;
}

export default function LoggingClient({
  event, initialQSOs, operatorCall, stationNumber, isGota = false, approvalPending = false,
  initialBand, initialMode,
}: Props) {
  const router = useRouter();
  const [confirmedQSOs, setConfirmedQSOs] = useState<QSO[]>(initialQSOs);
  // One implementation of the offline queue, shared with the CW popout.
  const queue = useQsoQueue({
    eventId: event.id,
    sentClass: event.class,
    sentSection: event.arrl_section,
    operatorCall,
    stationNumber,
    isGota,
  });
  // Destructured rather than used as `queue.x`: the callbacks are
  // useCallback-stable, so effects and memoized props can depend on them
  // individually. Depending on the returned object would change identity every
  // render — which would tear down and reopen the EventSource below each time.
  const {
    submit: submitQSO, flush: flushQueue, drop: dropQueued,
    noteReconnect, pending: pendingQSOs, pendingCount, isOnline,
  } = queue;
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [lastLogged, setLastLogged] = useState<DisplayQSO | null>(null);
  const [nightMode, setNightMode] = useStoredFlag('ezfd_night');
  // 20m phone is the fallback, not the default: an operator who came through
  // the position picker has already said where they are sitting. The values
  // arrive in the URL, so they are validated rather than trusted — a stale
  // bookmark must not put the form on a band this event does not offer.
  const askedFor = useMemo(() => {
    const band = (bandsFor(event.event_type) as string[]).includes(initialBand ?? '')
      ? initialBand as Band : null;
    const mode = (MODES as string[]).includes(initialMode ?? '')
      ? initialMode as Mode : null;
    return { band, mode, explicit: band !== null || mode !== null };
  }, [event.event_type, initialBand, initialMode]);

  const [currentBand, setCurrentBand] = useState<Band>(askedFor.band ?? '20m');
  const [currentMode, setCurrentMode] = useState<Mode>(askedFor.mode ?? 'PH');
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

  const isSes = event.event_type === 'SES';

  // Which station this window is. An operator picks it at sign-in and, until
  // now, nothing on the logging screen said it back to them — so a mis-click
  // there tagged a whole shift's contacts with the wrong transmitter and the
  // only clue was the Cabrillo export afterwards.
  //
  // Shown when the number can be wrong: a multi-transmitter entry, where the
  // choice was real, or any window past the first, which is what the "+ Radio"
  // button opens. A 1A club, or an SES on its only radio, has nothing to
  // confuse and gets no extra chrome.
  const showStation = transmitterCount(event.class) > 1 || stationNumber > 1;

  // One bridge process per radio, each on its own port, so a second window
  // drives a second rig instead of both fighting over one connection.
  const rig = useRigBridge({
    onBand: setCurrentBand,
    onMode: setCurrentMode,
    port: rigPortForStation(stationNumber),
  });
  const rigConnected = rig.connected;
  const rigFreq = rig.freq;

  function toggleNight() {
    setNightMode(prev => !prev);
  }

  // Every action the drawer offers for this surface. `NavHandlers` is keyed by
  // the action ids in lib/nav.ts, so adding an entry there without wiring it
  // here is a type error rather than a menu item that does nothing.
  const navHandlers: NavHandlers = {
    switchOperator: () => {
      sessionStorage.removeItem(`ezfd_op_${event.join_code}`);
      router.push(`/event/${event.join_code}`);
    },
    // A second radio is a second full logging window at the next station
    // number, with its own bridge on its own port (#30). Named so the two
    // windows land on the same tab if reopened rather than stacking.
    secondRadio: () => window.open(
      `/event/${event.join_code}/log?op=${encodeURIComponent(operatorCall)}&station=${stationNumber + 1}`,
      `ezfd_radio_${event.join_code}_${stationNumber + 1}`,
      'width=1100,height=900,noopener',
    ),
    cwWindow: () => window.open(
      `/event/${event.join_code}/cw?op=${encodeURIComponent(operatorCall)}&station=${stationNumber}`,
      `ezfd_cw_${event.join_code}`,
      'width=520,height=880,noopener',
    ),
    rigDetails: () => setShowRigHelp(true),
    importAdif: () => setShowAdifImport(true),
    toggleTheme: toggleLightMode,
    toggleNight,
  };

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

    // A dropped stream is the earliest signal available that the server went
    // away, and the reconnect is the earliest that it came back — sooner than
    // any retry timer worth running. navigator.onLine says nothing about
    // either: it tracks this machine's link, which stays up across a server
    // restart, an nginx reload or a 502.
    let dropped = false;
    es.onerror = () => {
      // Browser will auto-reconnect for SSE; errors here are transient
      dropped = true;
    };
    es.onopen = () => {
      if (!dropped) return;   // the initial connect is not a recovery
      dropped = false;
      noteReconnect();
    };

    return () => es.close();
  }, [event.id, noteReconnect]);

  // If this operator already holds a live checkout when they sign in — e.g.
  // arriving right at the start of their scheduled slot — start the form on
  // that band/mode instead of the 20m/PH fallback, since that's what they're
  // here to work.
  //
  // Skipped when they came through the position picker having named a band and
  // mode. That is a deliberate, more recent statement of where they are
  // sitting; an older claim on a different band must not silently pull the
  // form away from it. Someone who picked the band they already hold sees no
  // difference either way.
  useEffect(() => {
    if (!isSes || askedFor.explicit) return;
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
  }, [isSes, event.id, operatorCall, askedFor.explicit]);

  // Keep the remembered position in step with where the operator actually is.
  // The picker writes it at sign-in, but they QSY afterwards, and a reload
  // should come back to the band they are on rather than the one they started
  // on an hour ago.
  //
  // Two records, because they answer different questions. The session one is
  // *this operator's* position and is cleared when they sign out. The durable
  // one is *this radio's*, and outliving the sign-out is the point: the next
  // operator at the same laptop gets offered the band it is already on.
  useEffect(() => {
    rememberPosition(event.join_code, stationNumber, currentBand, currentMode);
    const key = `ezfd_op_${event.join_code}`;
    try {
      const saved = sessionStorage.getItem(key);
      if (!saved) return;
      const rec = JSON.parse(saved) as Record<string, unknown>;
      sessionStorage.setItem(key, JSON.stringify({ ...rec, band: currentBand, mode: currentMode }));
    } catch {
      // Private mode, or a corrupt record. The position just isn't remembered.
    }
  }, [event.join_code, stationNumber, currentBand, currentMode]);

  /** Drain the offline queue. Resolves true if at least one contact was
   *  accepted, which is what tells the retry timer it is making progress. */
  const logQSO = useCallback(async (data: QSOSubmission) => {
    setSubmitting(true);
    setSubmitError(null);
    setSlotWarning(null);
    try {
      // The queue takes the contact before the network is touched, so a failed
      // submit leaves it safely on disk rather than losing it.
      const { qso, queued, error, warning } = await submitQSO(data);
      setLastLogged(queued);
      if (warning) setSlotWarning(warning);
      if (qso) {
        setLastLogged(qso as DisplayQSO);
        // On mobile, briefly flip to the QSO list so the operator sees it land
        if (window.innerWidth < 768) setMobileTab('qsos');
      } else if (error) {
        setSubmitError(error);
      }
    } finally {
      setSubmitting(false);
    }
  }, [submitQSO]);

  const handleHoldingChange = useCallback((holding: boolean) => setHoldsSlot(holding), []);

  const updateQSO = useCallback((updated: QSO) => {
    setConfirmedQSOs(prev => prev.map(q => q.id === updated.id ? updated : q));
  }, []);

  const deleteQSO = useCallback(async (id: string, localId?: string) => {
    if (localId) {
      dropQueued(localId);
      return;
    }
    // The actor rides along so the audit trail records who claimed to do it.
    await fetch(`/api/qso/${id}?operator_call=${encodeURIComponent(operatorCall)}`, { method: 'DELETE' });
    setConfirmedQSOs(prev => prev.filter(q => q.id !== id));
  }, [dropQueued, operatorCall]);

  const displayQSOs: DisplayQSO[] = [
    ...pendingQSOs,
    ...confirmedQSOs.map(q => q as DisplayQSO),
  ];
  const score = calculateScore(confirmedQSOs, {}, event.power, { eventType: event.event_type, entryClass: event.class });

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
          {/* The call actually being signed. A GOTA operator working under a
              different callsign needs that on screen — it is what they say on
              the air, and it is what their contacts export as. */}
          <span className="font-bold text-amber-400 text-lg shrink-0">
            {isGota && event.gota_call ? event.gota_call : event.club_call}
          </span>
          {isGota && event.gota_call && (
            <span
              title={`Get On The Air station — contacts count for ${event.club_call} and earn 5 bonus points each`}
              className="hidden sm:inline-flex shrink-0 rounded border border-sky-700 bg-sky-900/30 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-400"
            >
              GOTA
            </span>
          )}
          <span className="text-zinc-600 hidden sm:inline">|</span>
          <span className="text-zinc-300 text-sm shrink-0 hidden sm:inline">
            {isSes ? 'Special Event' : `${event.class} · ${event.arrl_section}`}
          </span>
          {event.location && (
            <span className="text-zinc-500 text-sm truncate hidden lg:block">{event.location}</span>
          )}
        </div>

        <div className="flex items-center gap-2 text-sm flex-shrink-0">
          {/* What is left in the header is *status* — things an operator reads
              without acting on. Everything actionable moved into the drawer,
              which is why this row no longer has to choose what to drop at
              each breakpoint. */}
          <UTCClock />

          {rigConnected && (
            <span
              title={`Rig control active${rigFreq ? ` — ${(rigFreq / 1e6).toFixed(3)} MHz` : ''}`}
              className="hidden sm:inline-flex items-center gap-1.5 rounded border border-green-700 bg-green-900/30 px-2 py-0.5 text-[10px] font-semibold text-green-400">
              <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse shrink-0" />
              <span className="uppercase tracking-wide">RIG</span>
              {rigFreq && (
                <span className="font-mono font-normal text-green-300 tracking-tight">
                  {(rigFreq / 1e6).toFixed(3)}
                </span>
              )}
            </span>
          )}

          {/* The score reads on every width now. It is the number an operator
              glances at most and it used to vanish below 640px, where a second
              copy in a separate bar took over. */}
          <span className="text-zinc-400 light:text-zinc-500">
            <span className="text-zinc-200 font-mono font-bold light:text-zinc-800">{score.valid_qsos}</span>
            <span className="text-zinc-600 mx-1">Q</span>
            {!isSes && (
              <>
                <span className="text-zinc-200 font-mono font-bold light:text-zinc-800">{score.sections_worked}</span>
                <span className="text-zinc-600 mx-1">\u00d7</span>
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
              title="Contacts waiting to reach the server. They send themselves; this retries now."
              className="rounded bg-yellow-900/50 border border-yellow-700 px-2 py-0.5 text-xs text-yellow-400 hover:bg-yellow-900">
              {pendingCount} pending{isOnline ? ' \u2191' : ''}
            </button>
          )}

          <NavDrawer
            ctx={{
              surface: 'logger',
              joinCode: event.join_code,
              eventType: event.event_type,
              stationNumber,
              operatorCall,
              rigConnected,
              canCw: rig.canCw,
            }}
            handlers={navHandlers}
            heading={
              <span className="block truncate font-mono text-xs text-zinc-400 light:text-zinc-600">
                {operatorCall}{showStation ? ` \u00b7 station ${stationNumber}` : ''}
              </span>
            }
          />
        </div>
      </header>

      {/* The Log QSO / QSOs switcher. This is a *view* switcher, so it stays
          on screen: flipping between the entry form and the list is the loop
          an operator repeats all night, and it is only needed where the two
          panes cannot sit side by side.

          Everything else that used to live in this bar — a second copy of the
          score, the theme toggle, Dashboard, Docs and the operator chip — is
          in the drawer now. That copy was the drift: it carried a Docs link
          the desktop header never had, and lacked the exports the desktop
          header did. */}
      <div className="shrink-0 border-b border-zinc-800 bg-zinc-900 md:hidden light:border-zinc-200 light:bg-zinc-50">
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
            myStation={stationNumber}
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
