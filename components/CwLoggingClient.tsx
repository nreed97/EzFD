'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useStoredFlag } from '@/lib/useStoredFlag';
import { applyQsoEvent } from '@/lib/qsoStream';
import { useRigBridge } from '@/lib/useRigBridge';
import { useQsoQueue } from '@/lib/useQsoQueue';
import { transmitterCount } from '@/lib/types';
import type { Event, QSO, Band, Mode, DisplayQSO } from '@/lib/types';
import QSOForm, { type QSOFormHandle } from './QSOForm';
import CwMacroPanel, { type CwMacroPanelHandle } from './CwMacroPanel';

interface Props {
  event: Event;
  initialQSOs: QSO[];
  operatorCall: string;
  stationNumber: number;
}

export default function CwLoggingClient({ event, initialQSOs, operatorCall, stationNumber }: Props) {
  const showStation = transmitterCount(event.class) > 1 || stationNumber > 1;
  const [confirmedQSOs, setConfirmedQSOs] = useState<QSO[]>(initialQSOs);
  const [currentBand, setCurrentBand] = useState<Band>('20m');
  const [currentMode, setCurrentMode] = useState<Mode>('CW');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [lastLogged, setLastLogged] = useState<DisplayQSO | null>(null);
  const formRef = useRef<QSOFormHandle>(null);
  const macroPanelRef = useRef<CwMacroPanelHandle>(null);
  // The same offline queue the main tab uses. Before this, the CW window
  // POSTed straight to /api/qso with no local copy, so a server outage during
  // a run destroyed contacts: the fetch failed, QSOForm cleared the fields
  // anyway, and nothing remembered them. CW running is the highest-rate
  // operating this app supports, which made it the worst place for it.
  const {
    submit: submitQSO, flush: flushQueue, noteReconnect,
    pendingCount, isOnline,
  } = useQsoQueue({
    eventId: event.id,
    sentClass: event.class,
    sentSection: event.arrl_section,
    operatorCall,
    stationNumber,
  });


  const esmStorageKey = `ezfd_cw_esm_${event.id}_${operatorCall}`;
  // Defaults to on, as before, and now also stays in step with the main
  // logging window rather than each document holding its own copy.
  const [esm, setEsm] = useStoredFlag(esmStorageKey, true);

  function toggleEsm() {
    setEsm(prev => !prev);
  }

  const rig = useRigBridge({ onBand: setCurrentBand, onMode: setCurrentMode });

  const getFormValues = useCallback(
    () => formRef.current?.getValues() ?? {
      callsign: '', rcvdClass: '', rcvdSection: '', rstSent: '', rstRcvd: '', rcvdName: '',
    },
    []
  );

  // SSE subscription — keeps this window's dupe checks and score current with
  // QSOs logged from the main tab (or any other operator on the event).
  useEffect(() => {
    const es = new EventSource(`/api/realtime/${event.id}`);
    es.addEventListener('qso', (e: MessageEvent) => {
      const { op, record } = JSON.parse(e.data) as { op: string; record: QSO };
      setConfirmedQSOs(prev => applyQsoEvent(prev, op, record, true));
    });
    // A reconnect is the earliest evidence the server is back — navigator
    // .onLine says nothing about it, since this machine's link stays up across
    // a server restart, an nginx reload or a 502.
    let dropped = false;
    es.onerror = () => { dropped = true; /* browser auto-reconnects SSE */ };
    es.onopen = () => {
      if (!dropped) return;   // the initial connect is not a recovery
      dropped = false;
      noteReconnect();
    };
    return () => es.close();
  }, [event.id, noteReconnect]);

  const logQSO = useCallback(async (data: {
    callsign: string; band: Band; mode: Mode;
    rcvd_class: string; rcvd_section: string;
  }) => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      // Queued to localStorage before the network is touched, so a failure
      // here leaves the contact on disk instead of losing it. QSOForm clears
      // the fields either way, which is only safe because of this.
      const { qso, queued, error } = await submitQSO(data);
      setLastLogged(queued);
      if (qso) {
        setConfirmedQSOs(prev => prev.some(q => q.id === qso.id) ? prev : [qso, ...prev]);
        setLastLogged(qso as DisplayQSO);
      } else if (error) {
        setSubmitError(error);
      }
    } finally {
      setSubmitting(false);
    }
  }, [submitQSO]);

  return (
    <div className="night-scope flex h-screen flex-col overflow-hidden bg-zinc-950 text-zinc-100">
      <header className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900 px-3 py-1.5 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-bold text-amber-400 text-sm shrink-0">{event.club_call}</span>
          <span className="text-zinc-600">|</span>
          <span className="font-mono text-xs text-zinc-300">{operatorCall}</span>
          {/* Two radios means two of these windows, otherwise identical. The
              station number is the only thing telling them apart. */}
          {showStation && (
            <span
              title={`Station ${stationNumber}`}
              className="rounded bg-zinc-800 px-1 font-mono text-2xs font-semibold text-amber-400 shrink-0">
              ST{stationNumber}
            </span>
          )}
          {!isOnline && (
            <span className="rounded bg-red-900/50 border border-red-700 px-1.5 py-0.5 text-2xs font-semibold text-red-400 shrink-0">
              OFFLINE
            </span>
          )}
          {/* A queued contact has to be visible here. The whole failure this
              fixes was contacts that existed nowhere the operator could see. */}
          {pendingCount > 0 && (
            <button
              type="button"
              onClick={flushQueue}
              className="rounded bg-yellow-900/50 border border-yellow-700 px-1.5 py-0.5 text-2xs font-semibold text-yellow-400 hover:bg-yellow-900 shrink-0"
            >
              {pendingCount} pending{isOnline ? ' ↑' : ''}
            </button>
          )}
        </div>
        {rig.connected ? (
          <span className="inline-flex items-center gap-1.5 rounded border border-green-700 bg-green-900/30 px-2 py-0.5 text-2xs font-semibold text-green-400">
            <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse shrink-0" />
            RIG
            {rig.freq && (
              <span className="font-mono font-normal text-green-300">{(rig.freq / 1e6).toFixed(3)}</span>
            )}
          </span>
        ) : (
          <span className="rounded border border-zinc-700 px-2 py-0.5 text-2xs font-semibold text-zinc-500">RIG OFFLINE</span>
        )}
      </header>

      {!rig.connected && (
        <div className="shrink-0 border-b border-yellow-800 bg-yellow-900/20 px-3 py-1.5 text-xs text-yellow-400">
          Lost connection to the rig bridge. Reconnecting… keep this window open.
        </div>
      )}
      {rig.connected && !rig.canCw && (
        <div className="shrink-0 border-b border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-xs text-zinc-400">
          This rig doesn&apos;t report CAT CW-keying support — macro panel unavailable.
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2.5 flex flex-col gap-2.5">
        <QSOForm
          ref={formRef}
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
          onDigHelp={() => {}}
          existingQSOs={confirmedQSOs}
          autoFadeLoggedMs={4000}
          largeQsyChip
          esm={rig.canCw && esm}
          onEsmCall={() => {
            const { callsign } = formRef.current?.getValues() ?? { callsign: '' };
            macroPanelRef.current?.fireEsm(callsign ? 'call' : 'cq');
          }}
          onEsmLog={() => macroPanelRef.current?.fireEsm('log')}
          onCallsignInput={(value) => macroPanelRef.current?.setAutoCqActive(!value)}
        />

        {rig.canCw && (
          <CwMacroPanel
            ref={macroPanelRef}
            onSend={rig.sendCw}
            onStop={rig.stopCw}
            cwError={rig.cwError}
            getFormValues={getFormValues}
            myCall={event.club_call}
            eventClass={event.class}
            eventSection={event.arrl_section}
            storageKey={`ezfd_cw_macros_${event.id}_${operatorCall}`}
            esm={esm}
            onToggleEsm={toggleEsm}
          />
        )}
      </div>
    </div>
  );
}
