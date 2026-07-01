'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRigBridge } from '@/lib/useRigBridge';
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
  const [confirmedQSOs, setConfirmedQSOs] = useState<QSO[]>(initialQSOs);
  const [currentBand, setCurrentBand] = useState<Band>('20m');
  const [currentMode, setCurrentMode] = useState<Mode>('CW');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [lastLogged, setLastLogged] = useState<DisplayQSO | null>(null);
  const [esm, setEsm] = useState(true);
  const formRef = useRef<QSOFormHandle>(null);
  const macroPanelRef = useRef<CwMacroPanelHandle>(null);

  const esmStorageKey = `ezfd_cw_esm_${event.id}_${operatorCall}`;
  useEffect(() => {
    const saved = localStorage.getItem(esmStorageKey);
    if (saved !== null) setEsm(saved === '1');
  }, [esmStorageKey]);

  function toggleEsm() {
    setEsm(prev => {
      const next = !prev;
      localStorage.setItem(esmStorageKey, next ? '1' : '0');
      return next;
    });
  }

  const rig = useRigBridge({ onBand: setCurrentBand, onMode: setCurrentMode });

  // SSE subscription — keeps this window's dupe checks and score current with
  // QSOs logged from the main tab (or any other operator on the event).
  useEffect(() => {
    const es = new EventSource(`/api/realtime/${event.id}`);
    es.addEventListener('qso', (e: MessageEvent) => {
      const { op, record } = JSON.parse(e.data) as { op: string; record: QSO };
      if (op === 'INSERT') {
        setConfirmedQSOs(prev => prev.some(q => q.id === record.id) ? prev : [record, ...prev]);
      } else if (op === 'UPDATE') {
        setConfirmedQSOs(prev => prev.map(q => q.id === record.id ? record : q));
      } else if (op === 'DELETE') {
        setConfirmedQSOs(prev => prev.filter(q => q.id !== record.id));
      }
    });
    es.onerror = () => { /* browser auto-reconnects SSE */ };
    return () => es.close();
  }, [event.id]);

  const logQSO = useCallback(async (data: {
    callsign: string; band: Band; mode: Mode;
    rcvd_class: string; rcvd_section: string;
  }) => {
    setSubmitting(true);
    setSubmitError(null);
    try {
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
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setSubmitError(body.error ?? `Server error ${res.status}`);
        return;
      }
      const qso = await res.json() as QSO;
      setConfirmedQSOs(prev => prev.some(q => q.id === qso.id) ? prev : [qso, ...prev]);
      setLastLogged(qso as DisplayQSO);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setSubmitting(false);
    }
  }, [event.id, operatorCall, stationNumber]);

  return (
    <div className="night-scope flex h-screen flex-col overflow-hidden bg-zinc-950 text-zinc-100">
      <header className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900 px-3 py-1.5 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-bold text-amber-400 text-sm shrink-0">{event.club_call}</span>
          <span className="text-zinc-600">|</span>
          <span className="font-mono text-xs text-zinc-300">{operatorCall}</span>
        </div>
        {rig.connected ? (
          <span className="inline-flex items-center gap-1.5 rounded border border-green-700 bg-green-900/30 px-2 py-0.5 text-[10px] font-semibold text-green-400">
            <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse shrink-0" />
            RIG
            {rig.freq && (
              <span className="font-mono font-normal text-green-300">{(rig.freq / 1e6).toFixed(3)}</span>
            )}
          </span>
        ) : (
          <span className="rounded border border-zinc-700 px-2 py-0.5 text-[10px] font-semibold text-zinc-500">RIG OFFLINE</span>
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
          hasQRZ={!!event.qrz_username}
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
            getFormValues={() => formRef.current?.getValues() ?? { callsign: '', rcvdClass: '', rcvdSection: '' }}
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
