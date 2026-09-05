'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { enqueue, dequeue, loadQueue, type PendingQSO } from '@/lib/offline-queue';
import { useOnline } from '@/lib/useOnline';
import type { QSO, DisplayQSO } from '@/lib/types';
import type { QSOSubmission } from '@/components/QSOForm';

/**
 * The offline QSO queue for one event, shared by every window that logs.
 *
 * This exists as a hook rather than as code inside `LoggingClient` because the
 * CW popout is a second, independent document that logs the same event. It
 * used to POST straight to /api/qso with no local copy at all, so a server
 * outage during a CW run destroyed contacts outright — the fetch failed, the
 * form cleared anyway, and nothing anywhere remembered them. Copying the
 * queue into that component would have fixed it once and then drifted; this
 * repo has lost the same argument before with the section list and the backup
 * query, so there is one implementation and both windows call it.
 *
 * The invariant the whole thing serves: a contact reaches localStorage
 * *before* the network is touched, and only leaves once the server has
 * actually taken it.
 */

// Retry schedule for draining the queue, in milliseconds. Backs off because a
// queued contact that can *never* be accepted — the event was deleted, or the
// entry predates a schema change — would otherwise retry at a fixed interval
// for as long as the tab stays open. Progress resets it, so a real outage
// still drains at full speed.
const QUEUE_RETRY_MS = [5_000, 10_000, 20_000, 40_000, 60_000];

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
        is_gota: pending.is_gota ?? false,
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

/** A queued contact rendered as a log row, so a pending QSO looks like any
 *  other in the list while it waits. The sent exchange comes from the event,
 *  since the server stamps it and the queued copy never saw it. */
function pendingToDisplay(
  p: PendingQSO,
  sentClass: string | null,
  sentSection: string | null,
): DisplayQSO {
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
    is_gota: p.is_gota ?? false,
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

export interface UseQsoQueueOptions {
  eventId: string;
  /** The event's sent exchange, for rendering queued rows. NULL on an SES. */
  sentClass: string | null;
  sentSection: string | null;
  operatorCall: string;
  stationNumber: number;
  /** This window is logging at the GOTA station, so every contact it takes
   *  carries the flag. Set once at sign-in rather than per contact: an
   *  operator sits at GOTA for a stretch, and a per-QSO checkbox is one more
   *  thing to forget under a pileup. */
  isGota?: boolean;
}

export interface QsoQueue {
  /** Queue the contact, then try to send it. The queued copy is dropped only
   *  once the server has taken it, so a failure here is safe: it stays.
   *  `queued` is the local row, returned so a caller can show the contact
   *  immediately without waiting to learn whether the server took it. */
  submit(data: QSOSubmission): Promise<{
    qso: QSO | null; queued: DisplayQSO; error?: string; warning?: string;
  }>;
  /** Drain now — the Sync button, and what the retry timer calls.
   *  Resolves true if at least one contact was accepted. */
  flush(): Promise<boolean>;
  /** Call from an SSE `onopen` that followed an `onerror`. Reconnecting is the
   *  earliest evidence the server is back — sooner than any retry timer worth
   *  running. Each window owns its own EventSource, so this stays a call the
   *  component makes rather than a connection the hook holds. */
  noteReconnect(): void;
  /** Discard a queued contact without sending it. */
  drop(localId: string): void;
  pending: DisplayQSO[];
  pendingCount: number;
  isOnline: boolean;
}

export function useQsoQueue(
  { eventId, sentClass, sentSection, operatorCall, stationNumber, isGota = false }: UseQsoQueueOptions
): QsoQueue {
  const [pending, setPending] = useState<DisplayQSO[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const isOnline = useOnline();
  const syncingRef = useRef(false);

  // Adopt whatever a previous session left behind. Contacts logged just before
  // the tab closed are still owed to the server.
  useEffect(() => {
    const stored = loadQueue(eventId);
    if (stored.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPending(stored.map(p => pendingToDisplay(p, sentClass, sentSection)));
      setPendingCount(stored.length);
    }
  }, [eventId, sentClass, sentSection]);

  const flush = useCallback(async () => {
    // A flush already running will report its own progress; returning false
    // here can only cost the timer one backoff step, and the next dequeue
    // restarts it at full speed anyway.
    if (syncingRef.current) return false;
    syncingRef.current = true;
    let progressed = false;
    for (const queued of loadQueue(eventId)) {
      const result = await submitQSOToServer(eventId, queued, true);
      // Only drop the queued copy once the server has actually taken it.
      // Checking the wrapper object here instead of result.qso meant a failed
      // submit still dequeued, silently losing the contact.
      if (!result.qso) break;
      dequeue(eventId, queued.local_id);
      progressed = true;
      setPending(prev => prev.filter(p => p._local_id !== queued.local_id));
      setPendingCount(prev => Math.max(0, prev - 1));
    }
    syncingRef.current = false;
    return progressed;
  }, [eventId]);

  // Reached from long-lived callbacks without making either depend on flush's
  // identity — a dependency that would tear down and restart the timer on
  // every unrelated re-render, which is how the auto-CQ timer once failed to
  // complete an interval.
  const flushRef = useRef<(() => Promise<boolean>) | null>(null);
  useEffect(() => { flushRef.current = flush; }, [flush]);

  const noteReconnect = useCallback(() => { flushRef.current?.(); }, []);

  // The connectivity *value* comes from useOnline; this effect exists only for
  // the side effect of draining on the transition back to online.
  useEffect(() => {
    // flush is async: whatever state it sets happens in a promise continuation
    // after an await, never synchronously during the effect, so it cannot
    // cascade a render. The rule cannot see through the async boundary.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isOnline) flush();
  }, [isOnline, flush]);

  // Keep retrying while contacts are still queued.
  //
  // The effect above fires only when the *browser's* link changes, which is
  // the wrong signal for the common case: a server restart, an nginx reload or
  // a brief 502 leaves navigator.onLine true throughout, so there is no
  // transition and the queue would sit untouched until an operator noticed the
  // pending badge and pressed Sync. Mid-contest nobody is watching that badge.
  //
  // The timer reschedules itself rather than relying on the effect re-running,
  // because a failed attempt changes no state the effect depends on. A
  // successful one does — pendingCount drops, this effect restarts, and the
  // backoff is back at its shortest step.
  useEffect(() => {
    if (!isOnline || pendingCount === 0) return;
    let cancelled = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(async () => {
        const progressed = await flushRef.current?.();
        if (cancelled) return;
        attempt = progressed ? 0 : Math.min(attempt + 1, QUEUE_RETRY_MS.length - 1);
        schedule();
      }, QUEUE_RETRY_MS[attempt]);
    };
    schedule();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [isOnline, pendingCount]);

  const submit = useCallback(async (data: QSOSubmission) => {
    // localStorage first, always — this is the line that makes a failed submit
    // survivable, and the reason the CW window used to lose contacts.
    const queued = enqueue(eventId, {
      ...data,
      operator_call: operatorCall,
      station_number: stationNumber,
      is_gota: isGota,
    });
    const display = pendingToDisplay(queued, sentClass, sentSection);
    setPending(prev => [display, ...prev]);
    setPendingCount(prev => prev + 1);

    if (!navigator.onLine) return { qso: null, queued: display };

    const result = await submitQSOToServer(eventId, queued);
    if (result.qso) {
      dequeue(eventId, queued.local_id);
      setPending(prev => prev.filter(p => p._local_id !== queued.local_id));
      setPendingCount(prev => Math.max(0, prev - 1));
    }
    return { ...result, queued: display };
  }, [eventId, sentClass, sentSection, operatorCall, stationNumber, isGota]);

  const drop = useCallback((localId: string) => {
    dequeue(eventId, localId);
    setPending(prev => prev.filter(p => p._local_id !== localId));
    setPendingCount(prev => Math.max(0, prev - 1));
  }, [eventId]);

  return { submit, flush, noteReconnect, drop, pending, pendingCount, isOnline };
}
