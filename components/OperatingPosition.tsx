'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Band, Event, Mode, SesReservation } from '@/lib/types';
import { bandsFor, MODES } from '@/lib/bands';
import { buildSlotBoard, countOpen, slotKey, type PresenceRow, type SlotInfo } from '@/lib/slotBoard';
import { NO_POSITION, positionKey, suggestPosition, validPosition, type StoredPosition } from '@/lib/lastPosition';
import { useStoredJson } from '@/lib/useStoredJson';
import { useNow } from '@/lib/useNow';

/**
 * Where do you want to operate?
 *
 * The step between signing in and logging. An operator arriving at a busy site
 * needs to know what is free before they sit down, and previously found out by
 * starting on the logger's hard-coded 20m phone default and reading the band
 * activity panel afterwards — which is the wrong order, and on a special event
 * meant transmitting on a band somebody else had checked out.
 *
 * Claiming is optional here on purpose. A contest club that never uses the
 * schedule should be able to pick a band and go; a special event, where the
 * checkout is the point, gets the claim offered on the same screen.
 */

const MODE_LABEL: Record<Mode, string> = { PH: 'Phone', CW: 'CW', DIG: 'Digital' };

const STATE_STYLE: Record<SlotInfo['state'], string> = {
  open:    'border-zinc-700 text-zinc-300 hover:border-amber-400 light:border-zinc-300 light:text-zinc-700',
  mine:    'border-emerald-500/60 bg-emerald-500/10 text-emerald-400 light:border-emerald-600 light:bg-emerald-50 light:text-emerald-700',
  claimed: 'border-red-500/50 bg-red-500/10 text-red-400 light:border-red-500 light:bg-red-50 light:text-red-700',
  busy:    'border-amber-500/50 bg-amber-500/10 text-amber-400 light:border-amber-600 light:bg-amber-50 light:text-amber-700',
};

/** How often to re-ask for presence, which has no notify channel. */
const POLL_MS = 15_000;

/**
 * How often the board re-reads the clock.
 *
 * Separate from the poll, and finer, because `buildSlotBoard` decides whether
 * a claim is live by comparing its window against this value. Tied to the
 * poll it was the limiting factor once checkouts started arriving on the
 * stream: a claim made *now* starts a moment after the last tick, so the
 * refetch landed with fresh data and the board still called it not-yet-active
 * until the clock caught up. It also cuts the lag on the other end — a slot
 * whose window has run out stops looking live within a second instead of
 * sitting there expired.
 */
const CLOCK_MS = 1_000;

interface Props {
  event: Event;
  opCall: string;
  station: number;
  /** Go to the logger on this band and mode. */
  onStart: (band: Band, mode: Mode) => void;
  onDashboard: () => void;
  onBack: () => void;
}

export default function OperatingPosition({ event, opCall, station, onStart, onDashboard, onBack }: Props) {
  const isSes = event.event_type === 'SES';
  const nowMs = useNow(CLOCK_MS);

  const [reservations, setReservations] = useState<SesReservation[]>([]);
  const [presence, setPresence] = useState<PresenceRow[]>([]);
  const [picked, setPicked] = useState<{ band: Band; mode: Mode } | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  const bands = useMemo(() => bandsFor(event.event_type), [event.event_type]);

  const load = useCallback(async () => {
    const [r, p] = await Promise.all([
      fetch(`/api/ses/reservations?event_id=${event.id}`).then(x => x.ok ? x.json() : []).catch(() => []),
      fetch(`/api/presence?event_id=${event.id}`).then(x => x.ok ? x.json() : []).catch(() => []),
    ]);
    setReservations(r);
    setPresence(p);
  }, [event.id]);

  // Both loads are async, so the state they set lands in a promise
  // continuation rather than synchronously during the effect and cannot
  // cascade a render. The rule cannot see through the async boundary.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  // Checkouts arrive live. The realtime route already LISTENs on the event's
  // reservation channel for the logging screen's coordination panel, so a
  // claim made anywhere reaches this document the moment the database says so
  // rather than up to a poll later — and the poll interval was the window in
  // which two operators could both be looking at the same free band.
  //
  // The payload carries the raw range column rather than the timestamps the
  // board wants, exactly as it does for the panel, so this is a "refetch"
  // signal and not a patch.
  //
  // Every document owns its own connection, per the convention in AGENTS.md:
  // the picker is not the logging window, and the CW popout is a third.
  useEffect(() => {
    const es = new EventSource(`/api/realtime/${event.id}`);
    es.addEventListener('reservation', () => { void load(); });

    // A reconnect is the earliest evidence the server was away and is back,
    // and the board is stale by definition across that gap — nothing was
    // delivered while the stream was down.
    let dropped = false;
    es.onerror = () => { dropped = true; };
    es.onopen = () => {
      if (!dropped) return;    // the initial connect is not a recovery
      dropped = false;
      void load();
    };

    return () => es.close();
  }, [event.id, load]);

  // Presence has no notify trigger — a logging window reports itself over
  // HTTP on a heartbeat — so who is on air is still polled. The poll also
  // covers claims a second time, which is not redundant: an SSE stream can
  // die quietly, and this is what makes the board eventually right anyway.
  useEffect(() => {
    const id = setInterval(() => { void load(); }, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const board = useMemo(
    () => buildSlotBoard(bands, MODES, reservations, presence, nowMs,
                         { myCall: opCall, myStation: isSes ? null : station, isSes }),
    [bands, reservations, presence, nowMs, opCall, station, isSes],
  );
  const { open, total } = useMemo(() => countOpen(board), [board]);

  // Where this browser last operated, kept across an operator change because
  // the laptop stays at the radio while the operators rotate.
  const [stored] = useStoredJson<StoredPosition>(
    positionKey(event.join_code, station), NO_POSITION);
  const remembered = useMemo(
    () => validPosition(stored, event.event_type), [stored, event.event_type]);
  const suggestion = useMemo(
    () => suggestPosition(board, remembered), [board, remembered]);

  // An explicit click always wins. Until there is one, the suggestion stands
  // in — derived rather than written into state, so it needs no effect and
  // cannot get stuck holding a band that has since been claimed by somebody
  // else while the operator was reading the screen.
  const active = picked ?? suggestion;

  const current = active ? board.get(slotKey(active.band, active.mode)) : null;
  const takenByOther = current?.state === 'claimed';

  async function claimAndStart() {
    if (!active) return;
    setClaiming(true);
    setClaimError(null);
    const res = await fetch('/api/ses/reservations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_id: event.id,
        op_call: opCall,
        band: active.band,
        mode: active.mode,
        // A contest claim is held by the station; a special event claim by the
        // operator. Same split the logging gate uses, so a claim made here is
        // one checkSlot will recognise as yours.
        station_number: isSes ? null : station,
      }),
    }).catch(() => null);
    setClaiming(false);

    if (!res || !res.ok) {
      const body = await res?.json().catch(() => ({})) as { error?: string };
      // A 409 means somebody claimed it between the board loading and this
      // click. Refresh so the operator sees who, rather than a bare error.
      setClaimError(body.error ?? 'Could not check out that band and mode.');
      void load();
      return;
    }
    onStart(active.band, active.mode);
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 light:border-zinc-200 light:bg-zinc-50">
      <div className="mb-1 flex items-baseline justify-between">
        <h2 className="font-semibold text-zinc-200 light:text-zinc-800">Where are you operating?</h2>
        <span className="font-mono text-xs text-zinc-500">{open} of {total} free</span>
      </div>
      <p className="mb-4 text-xs text-zinc-500">
        {isSes
          ? 'Pick a band and mode, then check it out so nobody else signs the callsign there at the same time.'
          : 'Pick where you are starting. Checking out is optional on a contest — it warns the next station that this band and mode is taken.'}
      </p>

      <div className="flex flex-col gap-3">
        {MODES.map(mode => (
          <div key={mode}>
            <div className="mb-1 text-2xs font-semibold uppercase tracking-wider text-zinc-500">
              {MODE_LABEL[mode]}
            </div>
            <div className="flex flex-wrap gap-1">
              {bands.map(band => {
                const slot = board.get(slotKey(band, mode))!;
                const isPicked = active?.band === band && active?.mode === mode;
                const title = slot.state === 'claimed' || slot.state === 'mine'
                  ? `${slot.heldBy} holds this${slot.onAir.length ? ` · on air: ${slot.onAir.join(', ')}` : ''}`
                  : slot.onAir.length
                    ? `On air: ${slot.onAir.join(', ')}`
                    : 'Open';
                return (
                  <button
                    key={band}
                    type="button"
                    title={title}
                    onClick={() => { setPicked({ band, mode }); setClaimError(null); }}
                    className={`rounded border px-2 py-1 font-mono text-xs transition-colors ${
                      isPicked
                        ? 'border-amber-400 bg-amber-400 font-semibold text-zinc-900'
                        : STATE_STYLE[slot.state]
                    }`}
                  >
                    {band}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Swatches are styled boxes rather than a box-drawing character: a real
          element renders sharply at any size and does not depend on the
          reader's font having the glyph. */}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-2xs text-zinc-500">
        {([
          ['border-zinc-600 light:border-zinc-400', 'open'],
          ['border-amber-500/60 bg-amber-500/20', 'someone on air, not checked out'],
          ['border-red-500/60 bg-red-500/20', 'checked out by someone else'],
          ['border-emerald-500/60 bg-emerald-500/20', 'yours'],
        ] as const).map(([style, label]) => (
          <span key={label} className="flex items-center gap-1">
            <span className={`inline-block h-2.5 w-2.5 rounded-sm border ${style}`} />
            {label}
          </span>
        ))}
      </div>

      {active && (
        <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950 p-3 light:border-zinc-200 light:bg-white">
          <p className="text-sm text-zinc-300 light:text-zinc-700">
            <span className="font-mono font-semibold text-amber-400">{active.band} {MODE_LABEL[active.mode]}</span>
            {current?.state === 'open' && ' — open.'}
            {current?.state === 'mine' && ' — already yours.'}
            {current?.state === 'busy' && ` — ${current.onAir.join(', ')} on air here, not checked out.`}
            {takenByOther && ` — ${current?.heldBy} has this checked out.`}
          </p>

          {/* Say why it is already selected. A band that highlights itself with
              no explanation reads as a bug, and an operator who disagrees with
              the guess needs to know what it was guessing from. */}
          {!picked && suggestion && (
            <p className="mt-1 text-2xs text-zinc-500">
              {suggestion.reason === 'held'
                ? 'Picked for you — you have this checked out. Choose another band to change it.'
                : 'Picked for you — this radio was last on it. Choose another band to change it.'}
            </p>
          )}

          {claimError && (
            <p className="mt-2 text-xs text-red-400">{claimError}</p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {!takenByOther && current?.state !== 'mine' && (
              <button
                type="button"
                onClick={claimAndStart}
                disabled={claiming}
                className="rounded-lg bg-amber-400 px-3 py-1.5 text-sm font-semibold text-zinc-900 hover:bg-amber-300 disabled:opacity-60"
              >
                {claiming ? 'Checking out…' : 'Check out and start logging'}
              </button>
            )}
            <button
              type="button"
              onClick={() => onStart(active.band, active.mode)}
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 light:border-zinc-300 light:text-zinc-700 light:hover:bg-zinc-100"
            >
              {takenByOther ? 'Start here anyway' : 'Start without checking out'}
            </button>
          </div>

          {takenByOther && (
            <p className="mt-2 text-2xs text-zinc-500">
              {isSes
                ? 'Two signals on one band and mode under the same callsign is what the checkout exists to prevent — but a contact that already happened still needs logging, so this is a warning, not a block.'
                : 'One transmitted signal per band and mode is a contest rule. Starting here anyway is allowed; the log will warn on each contact.'}
            </p>
          )}
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800 pt-4 light:border-zinc-200">
        <button
          type="button"
          onClick={onBack}
          className="text-xs text-zinc-500 underline hover:text-zinc-300"
        >
          ← Change callsign
        </button>
        <button
          type="button"
          onClick={onDashboard}
          className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 light:border-zinc-300 light:text-zinc-700 light:hover:bg-zinc-100"
        >
          Just show me the dashboard
        </button>
      </div>
    </div>
  );
}
