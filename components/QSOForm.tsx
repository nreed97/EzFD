'use client';

import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { useStoredFlag } from '@/lib/useStoredFlag';
import type { Band, Mode, DisplayQSO, QSO, EventType, DupeRule } from '@/lib/types';
import { validExchangesFor, isValidExchange } from '@/lib/types';
import { BAND_GRID, EXTRA_BANDS, SES_EXTRA_BANDS, MODES } from '@/lib/bands';

export interface QSOFormHandle {
  getValues: () => {
    callsign: string;
    rcvdClass: string;
    rcvdSection: string;
    rstSent: string;
    rstRcvd: string;
    rcvdName: string;
  };
}

export interface QSOSubmission {
  callsign: string;
  band: Band;
  mode: Mode;
  rcvd_class: string;
  rcvd_section: string;
  rst_sent?: string;
  rst_rcvd?: string;
  rcvd_name?: string;
  rcvd_qth?: string;
  rcvd_grid?: string;
  comment?: string;
}

/** Default signal report per mode — RS for phone, RST for CW and digital.
 *  Prefilled so the common case is a single keystroke away from logged. */
const DEFAULT_RST: Record<Mode, string> = { PH: '59', CW: '599', DIG: '-10' };


const MODE_STYLE: Record<Mode, string> = {
  PH:  'bg-blue-400/15 border-blue-400/40 text-blue-400 light:bg-blue-50 light:border-blue-500 light:text-blue-700',
  CW:  'bg-yellow-400/15 border-yellow-400/40 text-yellow-400 light:bg-yellow-50 light:border-yellow-600 light:text-yellow-700',
  DIG: 'bg-green-400/15 border-green-400/40 text-green-400 light:bg-green-50 light:border-green-600 light:text-green-700',
};

const FD_CLASS_LETTERS  = new Set(['A','B','C','D','E','F']);
// H home, I indoor, O outdoor, M mobile. M was missing, so every contact with
// a mobile WFD station — "2M EPA" — drew a false "invalid class" warning. The
// event-creation page has always offered M in its own copy of this list; two
// copies of the same enumeration, and only one of them was right.
const WFD_CLASS_LETTERS = new Set(['H','I','O','M']);

interface Props {
  eventId: string;
  eventType: EventType;
  /** Governs the client-side "already worked" hint. The server is
   *  authoritative; this only decides how far back to look. */
  dupeRule?: DupeRule;
  hasQRZ: boolean;
  hasCallHistory: boolean;
  hasMasterCall: boolean;
  band: Band;
  mode: Mode;
  onBandChange: (b: Band) => void;
  onModeChange: (m: Mode) => void;
  onSubmit: (data: QSOSubmission) => Promise<void>;
  submitting: boolean;
  lastLogged: DisplayQSO | null;
  submitError: string | null;
  onDigHelp: () => void;
  existingQSOs: QSO[];
  bandOccupancy?: Partial<Record<Band, string[]>>;
  /** Enter Sends Message (N1MM-style) — when set, Enter in the callsign field
   * fires onEsmCall instead of just moving focus, and Enter/submit fires
   * onEsmLog before the QSO is logged. Focus navigation still happens as usual. */
  esm?: boolean;
  onEsmCall?: () => void;
  onEsmLog?: () => void;
  /** Fired on every callsign field keystroke with the current value —
   * used to pause/resume an auto-CQ loop as soon as the operator starts typing. */
  onCallsignInput?: (value: string) => void;
  /** When set, the "Logged ✓" confirmation fades out and disappears this many
   * ms after each lastLogged change, instead of staying until replaced. */
  autoFadeLoggedMs?: number;
  /** When set, the collapsed band/mode chip on the QSY button renders larger —
   * used in the CW popout where it's the sole band/mode display. */
  largeQsyChip?: boolean;
}

function QSOForm({
  eventId, eventType, dupeRule = 'EVENT', hasQRZ, hasCallHistory, hasMasterCall, band, mode, onBandChange, onModeChange,
  onSubmit, submitting, lastLogged, submitError, onDigHelp, existingQSOs,
  bandOccupancy = {}, esm, onEsmCall, onEsmLog, onCallsignInput, autoFadeLoggedMs, largeQsyChip,
}: Props, ref: React.Ref<QSOFormHandle>) {
  const isSes = eventType === 'SES';

  const [callsign, setCallsign] = useState('');
  const [rcvdClass, setRcvdClass] = useState('');
  const [rcvdSection, setRcvdSection] = useState('');
  // SES exchange — a signal report plus whatever the operator captures.
  const [rstSent, setRstSent] = useState(DEFAULT_RST[mode]);
  const [rstRcvd, setRstRcvd] = useState(DEFAULT_RST[mode]);
  const [rcvdName, setRcvdName] = useState('');
  const [rcvdQth, setRcvdQth] = useState('');
  const [rcvdGrid, setRcvdGrid] = useState('');
  const [comment, setComment] = useState('');

  // Signal report convention follows the mode, so retrack it on QSY — but
  // only when the operator hasn't overtyped the default for this contact.
  const prevModeRef = useRef(mode);
  useEffect(() => {
    const prev = prevModeRef.current;
    if (prev === mode) return;
    prevModeRef.current = mode;
    setRstSent(v => (v === DEFAULT_RST[prev] ? DEFAULT_RST[mode] : v));
    setRstRcvd(v => (v === DEFAULT_RST[prev] ? DEFAULT_RST[mode] : v));
  }, [mode]);

  useImperativeHandle(ref, () => ({
    getValues: () => ({ callsign, rcvdClass, rcvdSection, rstSent, rstRcvd, rcvdName }),
  }), [callsign, rcvdClass, rcvdSection, rstSent, rstRcvd, rcvdName]);
  const [qrzInfo, setQrzInfo] = useState<{ name?: string; state?: string; country?: string } | null>(null);
  const [historyInfo, setHistoryInfo] = useState<{ sentClass: string | null; section: string | null; label: string | null } | null>(null);
  const [knownMaster, setKnownMaster] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [loggedFading, setLoggedFading] = useState(false);
  const [loggedHidden, setLoggedHidden] = useState(false);

  // Resetting the fade when a new QSO is logged is an adjustment to a changed
  // prop, not a side effect, so it happens during render — React's documented
  // pattern for this. Doing it in the effect meant the stale "faded out" state
  // was committed and painted for one frame before the reset landed, so a
  // contact logged just after a fade could flash in already-dimmed.
  const [fadeKey, setFadeKey] = useState(lastLogged);
  if (fadeKey !== lastLogged) {
    setFadeKey(lastLogged);
    setLoggedFading(false);
    setLoggedHidden(false);
  }

  useEffect(() => {
    if (!lastLogged || !autoFadeLoggedMs) return;
    const fadeTimer = setTimeout(() => setLoggedFading(true), Math.max(0, autoFadeLoggedMs - 500));
    const hideTimer = setTimeout(() => setLoggedHidden(true), autoFadeLoggedMs);
    return () => { clearTimeout(fadeTimer); clearTimeout(hideTimer); };
  }, [lastLogged, autoFadeLoggedMs]);
  const [showQSY, setShowQSY] = useState(false);
  const [showExtra, setShowExtra] = useState(false);
  const extraBands = isSes ? SES_EXTRA_BANDS : EXTRA_BANDS;
  // Per-browser preference, not per-event — an operator who likes skipping
  // the exchange wants that everywhere, so it's read/written directly to
  // localStorage rather than threaded through event settings.
  const [quickLog, setQuickLog] = useStoredFlag('ezfd_quicklog');
  // Quick Log submits from the callsign field, taking the exchange boxes as
  // they stand. On a special event that is the whole point — there is no
  // contest exchange to collect. On Field Day and Winter Field Day the class
  // and section are required, per contact, and are the exchange: submitting
  // without them logs whatever is left in the boxes, and the call-history
  // prefill means that is often a *plausible* class and section the station
  // never sent, which goes on to the Cabrillo file unchallenged.
  //
  // The preference is stored per browser rather than per event, so it is not
  // enough to hide the checkbox — an operator who used Quick Log at a special
  // event would carry it into Field Day. The behaviour is gated too.
  const quickLogOn = quickLog && isSes;
  function toggleQuickLog() {
    setQuickLog(prev => !prev);
  }
  const formRef    = useRef<HTMLFormElement>(null);
  const callRef    = useRef<HTMLInputElement>(null);
  const classRef   = useRef<HTMLInputElement>(null);
  const sectionRef = useRef<HTMLInputElement>(null);
  const rstRcvdRef = useRef<HTMLInputElement>(null);
  const nameRef    = useRef<HTMLInputElement>(null);
  const lookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The callsign the form is currently on. Lookups are debounced and then
  // awaited, so a reply can arrive after the operator has already logged the
  // QSO and moved on — every lookup checks this before touching state so a
  // late reply can't prefill or mislabel the *next* station.
  const currentCallRef = useRef('');

  useEffect(() => { callRef.current?.focus(); }, []);

  const lookupCallsign = useCallback(async (call: string) => {
    if (!hasQRZ || call.length < 3) return;
    setLookingUp(true);
    try {
      const res = await fetch(`/api/qrz?callsign=${encodeURIComponent(call)}&event_id=${eventId}`);
      if (res.ok) {
        const data = await res.json();
        if (currentCallRef.current !== call) return;
        setQrzInfo(data.name ? data : null);
        // An SES logs name and QTH rather than a contest exchange, so a QRZ
        // hit can fill them directly. Only empty fields, never over manual
        // entry — same rule the call-history prefill follows.
        if (isSes) {
          if (data.name)  setRcvdName(prev => prev || data.name);
          if (data.state) setRcvdQth(prev => prev || data.state);
          if (data.grid)  setRcvdGrid(prev => prev || data.grid);
        }
      }
    } finally {
      setLookingUp(false);
    }
  }, [eventId, hasQRZ, isSes]);

  const lookupCallHistory = useCallback(async (call: string) => {
    if ((!hasCallHistory && !hasMasterCall) || call.length < 3) return;
    try {
      const res = await fetch(`/api/callhistory?callsign=${encodeURIComponent(call)}&event_id=${eventId}`);
      if (!res.ok) return;
      const data = await res.json();
      if (currentCallRef.current !== call) return;
      const label: string | null = data.name || data.user_text || null;
      setHistoryInfo(
        data.sent_class || data.section || label
          ? { sentClass: data.sent_class, section: data.section, label }
          : null
      );
      setKnownMaster(!!data.known_master);
      // Prefill class/section for a known station — only fields the operator
      // hasn't already typed into, so this never clobbers manual entry.
      // An SES has no class/section exchange, so there is nothing to prefill.
      if (!isSes) {
        if (data.sent_class) setRcvdClass(prev => prev || data.sent_class);
        if (data.section) setRcvdSection(prev => prev || data.section);
      }
    } catch {
      // best-effort — logging must never block on this
    }
  }, [eventId, hasCallHistory, hasMasterCall, isSes]);

  function handleCallChange(val: string) {
    const upper = val.toUpperCase().replace(/[^A-Z0-9/]/g, '');
    setCallsign(upper);
    currentCallRef.current = upper;
    onCallsignInput?.(upper);
    setQrzInfo(null);
    setHistoryInfo(null);
    setKnownMaster(false);
    if (lookupTimer.current) clearTimeout(lookupTimer.current);
    if (upper.length >= 3) {
      lookupTimer.current = setTimeout(() => {
        lookupCallsign(upper);
        lookupCallHistory(upper);
      }, 600);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!callsign || submitting) return;
    if (esm) onEsmLog?.();
    await onSubmit({
      callsign, band, mode,
      rcvd_class: rcvdClass,
      rcvd_section: rcvdSection,
      ...(isSes ? {
        rst_sent:  rstSent,
        rst_rcvd:  rstRcvd,
        rcvd_name: rcvdName,
        rcvd_qth:  rcvdQth,
        rcvd_grid: rcvdGrid,
        comment,
      } : {}),
    });
    if (lookupTimer.current) clearTimeout(lookupTimer.current);
    currentCallRef.current = '';
    setCallsign('');
    onCallsignInput?.('');
    setRcvdClass('');
    setRcvdSection('');
    // Signal reports go back to the mode default rather than blank — the
    // next contact almost always gets the same report.
    setRstSent(DEFAULT_RST[mode]);
    setRstRcvd(DEFAULT_RST[mode]);
    setRcvdName('');
    setRcvdQth('');
    setRcvdGrid('');
    setComment('');
    setQrzInfo(null);
    setHistoryInfo(null);
    setKnownMaster(false);
    callRef.current?.focus();
  }

  function pickBand(b: Band) {
    onBandChange(b);
    setShowQSY(false);
  }

  // Client-side dupe check — server enforces authoritatively, this is just a
  // heads-up. Under the DAY rule only today's contacts count, which is what
  // makes a multi-week special event workable: working the same station again
  // next weekend is normal, not a mistake.
  const todayUTC = new Date().toISOString().slice(0, 10);
  const isDupe = dupeRule !== 'NONE' && callsign.length >= 3 &&
    existingQSOs.some(q => {
      if (q.is_dupe || q.callsign !== callsign || q.band !== band || q.mode !== mode) return false;
      if (dupeRule !== 'DAY') return true;
      const iso = typeof q.datetime_utc === 'string' ? q.datetime_utc : q.datetime_utc.toISOString();
      return iso.slice(0, 10) === todayUTC;
    });

  const callsignInvalid = callsign.length >= 3 && (() => {
    const c = callsign.replace(/\/.*/, '');
    return !/^[A-Z0-9]{3,}$/.test(c) || !/[A-Z]/.test(c) || !/[0-9]/.test(c);
  })();

  const validLetters = eventType === 'WFD' ? WFD_CLASS_LETTERS : FD_CLASS_LETTERS;
  const classInvalid = rcvdClass.length > 0 && (() => {
    const m = rcvdClass.match(/^(\d+)([A-Z]+)$/);
    if (!m) return true;
    const [, num, letter] = m;
    return parseInt(num, 10) < 1 || !validLetters.has(letter);
  })();

  // Checked against VALID_EXCHANGES, not ARRL_SECTIONS: a station outside the
  // US and Canada correctly sends DX, and warning on it sends the operator
  // back to retype an exchange that was right the first time.
  const sectionInvalid = rcvdSection.length > 0 && !isValidExchange(rcvdSection, eventType);

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-3">
      {/* Callsign */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className="block text-xs text-zinc-400 light:text-zinc-600">Callsign</label>
          {isSes && (
            <label className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-300 light:hover:text-zinc-700">
              <input type="checkbox" checked={quickLog} onChange={toggleQuickLog} tabIndex={-1} className="h-3 w-3" />
              Quick Log
              <span
                tabIndex={0}
                title="Log on Enter straight from the callsign field. Special events only — a contest exchange has to be collected per contact."
                className="ml-0.5 flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full border border-zinc-600 text-[9px] leading-none text-zinc-500 hover:border-zinc-400 hover:text-zinc-300"
              >
                ?
              </span>
            </label>
          )}
        </div>
        <input
          ref={callRef}
          value={callsign}
          onChange={e => handleCallChange(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              if (quickLogOn && !esm) {
                if (callsign) {
                  e.preventDefault();
                  formRef.current?.requestSubmit();
                }
                return;
              }
              const firstExchangeField = isSes ? rstRcvdRef : classRef;
              if (esm) {
                e.preventDefault();
                onEsmCall?.();
                if (callsign) firstExchangeField.current?.focus();
                return;
              }
              if (callsign) {
                e.preventDefault();
                firstExchangeField.current?.focus();
              }
            }
          }}
          placeholder="W0NY"
          className="input w-full font-mono text-xl tracking-widest"
          autoComplete="off"
          spellCheck={false}
        />
        {lookingUp && <p className="mt-1 text-xs text-zinc-500">Looking up…</p>}
        {qrzInfo && !isDupe && (
          <p className="mt-1 text-xs text-zinc-400 light:text-zinc-600">
            {qrzInfo.name}
            {qrzInfo.state ? ` · ${qrzInfo.state}` : ''}
            {qrzInfo.country && qrzInfo.country !== 'United States' ? ` · ${qrzInfo.country}` : ''}
          </p>
        )}
        {historyInfo && !isDupe && (
          <p className="mt-1 text-xs text-amber-400/80 light:text-amber-700">
            History: {[historyInfo.sentClass, historyInfo.section, historyInfo.label].filter(Boolean).join(' · ')}
          </p>
        )}
        {knownMaster && !historyInfo && !qrzInfo && !isDupe && (
          <p className="mt-1 text-xs text-zinc-500">✓ known callsign (master list)</p>
        )}
        {isDupe && (
          <p className="mt-1 text-xs text-yellow-500">
            Already worked on {band} {mode}{dupeRule === 'DAY' ? ' today' : ''} — will log as dupe
          </p>
        )}
        {callsignInvalid && !isDupe && (
          <p className="mt-1 text-xs text-orange-400">
            Unusual callsign format — double-check before logging
          </p>
        )}
      </div>

      {/* Exchange — a special event station swaps the contest class/section
          for a signal report and whatever the operator wants to capture. */}
      {isSes ? (
        <>
          <div className="flex gap-2">
            <div className="w-16">
              <label className="block text-xs text-zinc-400 mb-1 light:text-zinc-600">RST S</label>
              <input
                value={rstSent}
                onChange={e => setRstSent(e.target.value.trim())}
                className="input w-full font-mono"
                maxLength={6}
              />
            </div>
            <div className="w-16">
              <label className="block text-xs text-zinc-400 mb-1 light:text-zinc-600">RST R</label>
              <input
                ref={rstRcvdRef}
                value={rstRcvd}
                onChange={e => setRstRcvd(e.target.value.trim())}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    nameRef.current?.focus();
                  }
                }}
                className="input w-full font-mono"
                maxLength={6}
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-zinc-400 mb-1 light:text-zinc-600">Name</label>
              <input
                ref={nameRef}
                value={rcvdName}
                onChange={e => setRcvdName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Tab' && !e.shiftKey) {
                    e.preventDefault();
                    callRef.current?.focus();
                  }
                }}
                placeholder="Dave"
                className="input w-full"
                maxLength={40}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-xs text-zinc-400 mb-1 light:text-zinc-600">QTH</label>
              <input
                value={rcvdQth}
                onChange={e => setRcvdQth(e.target.value)}
                placeholder="MN"
                className="input w-full"
                maxLength={60}
              />
            </div>
            <div className="w-24">
              <label className="block text-xs text-zinc-400 mb-1 light:text-zinc-600">Grid</label>
              <input
                value={rcvdGrid}
                onChange={e => setRcvdGrid(e.target.value.toUpperCase())}
                placeholder="EN34"
                className="input w-full font-mono"
                maxLength={8}
              />
            </div>
            <div className="w-24">
              <label className="block text-xs text-zinc-400 mb-1 light:text-zinc-600">Section</label>
              <input
                list="section-list"
                value={rcvdSection}
                onChange={e => setRcvdSection(e.target.value.toUpperCase())}
                placeholder="MN"
                className="input w-full font-mono"
                maxLength={5}
              />
            </div>
          </div>
          {/* Unlike the contest form this is only a hint, never an error:
              a special event works DX, where no ARRL section applies. */}
          {rcvdSection.length > 0 && sectionInvalid && (
            <p className="text-xs text-zinc-500">
              &ldquo;{rcvdSection}&rdquo; isn&apos;t an ARRL/RAC section &mdash; fine for DX, just noting it.
            </p>
          )}
          <div>
            <label className="block text-xs text-zinc-400 mb-1 light:text-zinc-600">Comment</label>
            <input
              value={comment}
              onChange={e => setComment(e.target.value)}
              placeholder="optional"
              className="input w-full"
              maxLength={120}
            />
          </div>
          <datalist id="section-list">
            {validExchangesFor(eventType).map(sec => <option key={sec} value={sec} />)}
          </datalist>
        </>
      ) : (
      <>
      <div className="flex gap-2">
        <div className="w-20">
          <label className="block text-xs text-zinc-400 mb-1 light:text-zinc-600">Rcvd Class</label>
          <input
            ref={classRef}
            value={rcvdClass}
            onChange={e => setRcvdClass(e.target.value.toUpperCase())}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                sectionRef.current?.focus();
              }
            }}
            placeholder="3A"
            className={`input w-full font-mono ${classInvalid ? 'border-orange-500' : ''}`}
            maxLength={6}
          />
        </div>
        <div className="flex-1">
          <label className="block text-xs text-zinc-400 mb-1 light:text-zinc-600">Rcvd Section</label>
          <input
            ref={sectionRef}
            list="section-list"
            value={rcvdSection}
            onChange={e => setRcvdSection(e.target.value.toUpperCase())}
            onKeyDown={e => {
              if (e.key === 'Tab' && !e.shiftKey) {
                e.preventDefault();
                callRef.current?.focus();
              }
            }}
            placeholder="MN"
            className={`input w-full font-mono ${sectionInvalid ? 'border-orange-500' : ''}`}
            maxLength={5}
          />
          <datalist id="section-list">
            {validExchangesFor(eventType).map(s => <option key={s} value={s} />)}
          </datalist>
        </div>
      </div>
      {classInvalid && (
        <p className="text-xs text-orange-400">
          Invalid class — expected a number + {eventType === 'WFD' ? 'H, I, O, or M' : 'A–F'} (e.g. {eventType === 'WFD' ? '2O' : '3A'})
        </p>
      )}
      {sectionInvalid && (
        <p className="text-xs text-orange-400">
          &ldquo;{rcvdSection}&rdquo; is not a valid ARRL/RAC section
        </p>
      )}
      </>
      )}

      {/* Server error */}
      {submitError && (
        <div className="rounded-lg border border-red-800 bg-red-900/30 p-2 text-xs text-red-400">
          Error: {submitError}
        </div>
      )}

      {/* Post-log feedback */}
      {lastLogged && !loggedHidden && (
        <div className={`rounded-lg border px-3 py-2 transition-opacity duration-500 ${loggedFading ? 'opacity-0' : 'opacity-100'} ${
          lastLogged.is_dupe
            ? 'border-yellow-700 bg-yellow-900/30'
            : lastLogged._pending
              ? 'border-zinc-700 bg-zinc-800/50 light:border-zinc-300 light:bg-zinc-100'
              : 'border-green-800 bg-green-900/20'
        }`}>
          <div className="flex items-baseline justify-between gap-2">
            <span className={`font-mono text-lg font-bold tracking-wider ${
              lastLogged.is_dupe ? 'text-yellow-400' : lastLogged._pending ? 'text-zinc-300 light:text-zinc-700' : 'text-green-400'
            }`}>
              {lastLogged.callsign}
            </span>
            <span className="text-xs text-zinc-500 light:text-zinc-400">
              {lastLogged.band} · {lastLogged.mode}
            </span>
          </div>
          <p className={`text-[11px] mt-0.5 ${
            lastLogged.is_dupe ? 'text-yellow-600' : lastLogged._pending ? 'text-zinc-500' : 'text-green-600'
          }`}>
            {lastLogged.is_dupe ? 'Logged as dupe' : lastLogged._pending ? 'Queued — syncing…' : 'Logged ✓'}
          </p>
        </div>
      )}

      <button
        type="submit"
        disabled={!callsign || submitting}
        className="rounded-lg bg-amber-400 py-3 font-bold text-zinc-900 transition-colors hover:bg-amber-300 disabled:opacity-50 text-base"
      >
        {submitting ? 'Logging…' : 'Log QSO  [Enter]'}
      </button>

      {/* QSY drawer */}
      <div className="border-t border-zinc-800 pt-2 light:border-zinc-200">
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setShowQSY(v => !v)}
          className="flex w-full items-center justify-between rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 hover:border-zinc-500 hover:bg-zinc-750 transition-colors light:border-zinc-300 light:bg-zinc-100 light:hover:bg-zinc-200 light:hover:border-zinc-400"
        >
          <div className="flex items-center gap-2">
            <span className={`rounded border bg-amber-400/15 border-amber-400/40 px-2.5 py-1 font-mono font-bold text-amber-400 light:bg-amber-50 light:border-amber-600 light:text-amber-700 ${largeQsyChip ? 'text-xl tracking-wide' : 'text-sm'}`}>
              {band}
            </span>
            <span className={`rounded border px-2.5 py-1 font-mono font-bold ${MODE_STYLE[mode]} ${largeQsyChip ? 'text-xl tracking-wide' : 'text-sm'}`}>
              {mode}
            </span>
          </div>
          <span className="text-xs font-semibold text-zinc-400 tracking-wide light:text-zinc-600">
            {showQSY ? '▲ DONE' : '▼ QSY'}
          </span>
        </button>

        {showQSY && (
          <div className="mt-2 flex flex-col gap-2">
            <div className="grid grid-cols-3 gap-1">
              {BAND_GRID.flat().map(b => {
                const ops = bandOccupancy[b] ?? [];
                const occupied = ops.length > 0;
                return (
                  <button
                    key={b}
                    type="button"
                    tabIndex={-1}
                    onClick={() => pickBand(b)}
                    title={occupied ? `Active: ${ops.join(', ')}` : undefined}
                    className={`relative rounded py-2.5 text-sm font-mono font-semibold transition-colors ${
                      band === b
                        ? 'bg-amber-400 text-zinc-900'
                        : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 light:bg-zinc-200 light:text-zinc-700 light:hover:bg-zinc-300'
                    }`}
                  >
                    {b}
                    {occupied && band !== b && (
                      <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-orange-400" />
                    )}
                  </button>
                );
              })}
            </div>

            {showExtra ? (
              <div className="flex flex-col gap-1">
                <div className="grid grid-cols-3 gap-1">
                  {extraBands.map(b => {
                    const ops = bandOccupancy[b] ?? [];
                    const occupied = ops.length > 0;
                    return (
                      <button
                        key={b}
                        type="button"
                        tabIndex={-1}
                        onClick={() => pickBand(b)}
                        title={occupied ? `Active: ${ops.join(', ')}` : undefined}
                        className={`relative rounded py-2.5 text-sm font-mono font-semibold transition-colors ${
                          band === b
                            ? 'bg-amber-400 text-zinc-900'
                            : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 light:bg-zinc-200 light:text-zinc-700 light:hover:bg-zinc-300'
                        }`}
                      >
                        {b}
                        {occupied && band !== b && (
                          <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-orange-400" />
                        )}
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowExtra(false)}
                  className="self-start px-1 text-xs text-zinc-500 hover:text-zinc-300 light:text-zinc-600 light:hover:text-zinc-800"
                >
                  ↑ less
                </button>
              </div>
            ) : (
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowExtra(true)}
                className="text-left text-xs text-zinc-600 hover:text-zinc-400 light:text-zinc-500 light:hover:text-zinc-700"
              >
                + {extraBands.join(' / ')}
              </button>
            )}

            <div className="flex rounded-lg overflow-hidden border border-zinc-700 light:border-zinc-300">
              {MODES.map(m => (
                <button
                  key={m}
                  type="button"
                  tabIndex={-1}
                  onClick={() => onModeChange(m)}
                  className={`flex-1 py-3 text-sm font-bold transition-colors ${
                    mode === m
                      ? 'bg-amber-400 text-zinc-900'
                      : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 light:bg-zinc-100 light:text-zinc-700 light:hover:bg-zinc-200'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        )}

        {mode === 'DIG' && (
          <button
            type="button"
            tabIndex={-1}
            onClick={onDigHelp}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-zinc-600 bg-zinc-800/40 px-3 py-2 text-xs text-zinc-400 hover:border-blue-600 hover:text-blue-400 transition-colors"
          >
            <span>📡</span>
            <span>Using WSJT-X or JTDX? Set up auto-import →</span>
          </button>
        )}
      </div>
    </form>
  );
}

export default forwardRef(QSOForm);
