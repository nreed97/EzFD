'use client';

import { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { buildSlotBoard } from '@/lib/slotBoard';
import { buildOverview, activeBands, countCoverage } from '@/lib/overview';
import { orderedBandsFor, MODES } from '@/lib/bands';
import { slotWords } from '@/lib/slotWords';
import type { Coverage, OverviewSlot } from '@/lib/overview';
import type { PresenceRow } from '@/lib/slotBoard';
import type { Event, Score, SesReservation } from '@/lib/types';

const MapView = dynamic(() => import('./MapView'), { ssr: false });

/**
 * The view you put on a screen at the site.
 *
 * Every other dashboard view answers a question somebody asked. This one is
 * for a person who has not asked anything: they walked past a monitor in the
 * tent, and it should tell them, without being read closely, how the event is
 * going, how to join it, and which bands are free.
 *
 * That is why it is the one view that hides the sidebar. The sidebar is a
 * reference column you scan when you want a number; this is a poster. Keeping
 * both would also print the join code twice on the same screen, which is the
 * kind of thing that makes a reader trust neither copy.
 *
 * Nothing here is a new derivation. The score comes from the scorer, the band
 * board from `buildSlotBoard` (the same one the position picker reads) through
 * `buildOverview`, and the vocabulary from `lib/slotWords.ts`. A display that
 * computed its own version of a number shown elsewhere is how this codebase
 * has gone wrong repeatedly.
 */

/** Enough rows that the board never looks broken before the event starts. */
const MIN_BAND_ROWS = 5;

/**
 * Three states, three colours, and they are deliberately not the position
 * picker's.
 *
 * The picker paints a claim **red**, because there it means "you cannot sit
 * here". On a display nobody is asking permission, and a claim is somebody
 * coordinating properly — painting that as an alarm would make a
 * well-organised event look like a wall of problems. Green is somebody on the
 * air, amber is booked and empty, and free is quiet on purpose: the eye should
 * land on what is running, and the gaps should be findable without shouting.
 */
const COVERAGE_STYLE: Record<Coverage, string> = {
  covered: 'border-emerald-500/60 bg-emerald-500/10 light:border-emerald-600 light:bg-emerald-50',
  claimed: 'border-amber-500/50 bg-amber-500/10 light:border-amber-600 light:bg-amber-50',
  free:    'border-zinc-800 bg-zinc-950/40 light:border-zinc-200 light:bg-zinc-50',
};

/**
 * The mode letter in each cell.
 *
 * "Quiet" and "unreadable" are not the same thing, and the first cut had them
 * confused: a free cell's letter measured **2.42:1** in dark and 2.46:1 in
 * light, and the word *free* under it 1.79:1 and 1.42:1 — so the cells a
 * reader is scanning for, on a view whose whole question is *what is free*,
 * were the only ones they could not read. That is the same failure as the map
 * labels, where unworked sections sat at 2.32:1 while worked ones were at
 * 10.48:1.
 *
 * Free is still the quiet state, but by being **neutral** rather than faint:
 * it is grey where the others are green and amber, and the hierarchy comes
 * from colour instead of from legibility. Measured against each cell's own
 * blended background — 7.30:1 dark and 7.41:1 light here, and the covered and
 * claimed text between 4.84 and 10.44.
 */
const MODE_LABEL: Record<Coverage, string> = {
  covered: 'text-emerald-300 light:text-emerald-800',
  claimed: 'text-amber-300 light:text-amber-800',
  free:    'text-zinc-400 light:text-zinc-600',
};

function until(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}Z`;
}

function Figure({ value, label, tone }: { value: string | number; label: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <div className={`font-mono text-3xl font-bold leading-none tabular-nums lg:text-4xl ${tone ?? 'text-zinc-100 light:text-zinc-900'}`}>
        {value}
      </div>
      <div className="mt-1 truncate text-2xs uppercase tracking-wider text-zinc-500">{label}</div>
    </div>
  );
}

function SlotCell({ slot, heldLabel }: { slot: OverviewSlot; heldLabel: string }) {
  const ends = until(slot.until);
  return (
    <div className={`min-w-0 rounded border px-2 py-1.5 ${COVERAGE_STYLE[slot.coverage]}`}>
      <div className={`font-mono text-xs font-bold ${MODE_LABEL[slot.coverage]}`}>{slot.mode}</div>
      {slot.coverage === 'covered' && (
        // Who is actually there. Two callsigns happen — one operator on two
        // radios, or a handover in progress — and both belong on screen.
        <div className="truncate font-mono text-2xs text-emerald-400 light:text-emerald-700">
          {slot.onAir.join(' · ')}
        </div>
      )}
      {slot.coverage === 'claimed' && (
        <>
          {/* Holder and end time stack rather than sharing a line. Together
              they overran the cell and `truncate` ate the half that names who
              -- "Station 2…" with the time gone entirely. */}
          <div className="truncate font-mono text-2xs text-amber-400 light:text-amber-700">
            {slot.heldBy ?? heldLabel}
          </div>
          {ends && <div className="truncate font-mono text-2xs text-zinc-500">to {ends}</div>}
        </>
      )}
      {slot.coverage === 'free' && (
        // zinc-500 in both themes: 3.87:1 dark, 4.63:1 light. Quieter than the
        // mode letter above it, which is the hierarchy that was wanted, and
        // legible, which the 1.79:1 it replaced was not.
        <div className="font-mono text-2xs text-zinc-500">free</div>
      )}
    </div>
  );
}

interface Props {
  event: Event;
  score: Score;
  reservations: SesReservation[];
  presence: PresenceRow[];
  nowMs: number;
  /** Contacts in the last rolling hour, the same figure the sidebar prints. */
  recentQSOs: number;
}

export default function SiteOverview({ event, score, reservations, presence, nowMs, recentQSOs }: Props) {
  const isSes = event.event_type === 'SES';
  const words = slotWords(event.event_type);

  const board = useMemo(
    () => buildOverview(
      orderedBandsFor(event.event_type),
      MODES,
      // No `myCall`: a screen on a wall has no operator signed in to it, and a
      // claim reading differently depending on whose browser is driving the
      // display is exactly the inconsistency this view exists to avoid.
      buildSlotBoard(orderedBandsFor(event.event_type), MODES, reservations, presence, nowMs, { isSes }),
      score.by_band,
    ),
    [event.event_type, reservations, presence, nowMs, isSes, score.by_band],
  );

  const rows = useMemo(() => activeBands(board, MIN_BAND_ROWS), [board]);
  // Counted over the drawn rows, not the whole board -- see countCoverage.
  const counts = useMemo(() => countCoverage(rows), [rows]);

  return (
    <div className="h-full overflow-y-auto bg-zinc-950 light:bg-white">
      <div className="flex min-h-full flex-col gap-3 p-3 lg:p-4">

        {/* The headline figures, across the top so they read first. An SES has
            no contest score, no multiplier and no sections — a QSO total is
            the whole story there, and printing an empty Score box would
            invent a number the event does not have. */}
        <div className="grid shrink-0 grid-cols-2 gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4 light:border-zinc-200 light:bg-zinc-50 sm:grid-cols-4">
          <Figure value={score.valid_qsos} label="Contacts" tone="text-amber-400" />
          <Figure value={recentQSOs} label="QSO / hr" />
          {isSes ? (
            <>
              <Figure value={score.phone_qsos} label="Phone" tone="text-blue-400 light:text-blue-600" />
              <Figure value={score.cw_qsos + score.digital_qsos} label="CW + Digital" tone="text-green-400 light:text-green-600" />
            </>
          ) : (
            <>
              <Figure value={score.total_score.toLocaleString()} label="Claimed score" tone="text-amber-400" />
              <Figure value={score.sections.length} label="Sections" />
            </>
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
          {/* The map, on a contest. A special event has no sections worked
              and no map tab, so it gets the band board full width instead of
              a panel with nothing in it. */}
          {/* A *definite* height below lg, not a min-height. MapContainer is
              `height: 100%`, and a percentage height resolves against the
              parent's height -- which `min-h-*` does not set. The first cut
              used `min-h-64` and the map measured 0px tall on a phone: all 173
              polygons drew into a zero-height box, so the panel was an empty
              rectangle with nothing on screen to say why. */}
          {!isSes && (
            <div className="h-72 shrink-0 overflow-hidden rounded-xl border border-zinc-800 light:border-zinc-200 lg:h-auto lg:min-h-0 lg:flex-1 lg:shrink">
              <MapView workedSections={score.sections} />
            </div>
          )}

          {/* Beside the map this is a rail; without one (a special event) it is
              the whole view, and letting it fill stretched each band cell to
              most of a 1440px screen to hold the word "free". Bounded and
              centred instead, so the cells stay the size the eye expects. */}
          <div className={`flex shrink-0 flex-col gap-3 ${isSes ? 'mx-auto w-full max-w-3xl flex-1' : 'lg:w-[26rem]'}`}>
            {/* The join code, large enough to read from across a tent and
                copy onto a phone without asking anybody. This is the single
                most-asked question at a site, and the reason a screen gets
                put up at all. */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-center light:border-zinc-200 light:bg-zinc-50">
              <div className="text-2xs uppercase tracking-wider text-zinc-500">Join at this code</div>
              <div className="mt-1 font-mono text-4xl font-bold tracking-[0.25em] text-amber-400 lg:text-5xl">
                {event.join_code}
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-zinc-800 bg-zinc-900 p-4 light:border-zinc-200 light:bg-zinc-50">
              <div className="mb-2 flex shrink-0 items-baseline justify-between gap-2">
                <span className="text-xs uppercase tracking-wider text-zinc-500">Bands</span>
                <span className="font-mono text-2xs text-zinc-500">
                  <span className="text-emerald-400 light:text-emerald-700">{counts.covered} on air</span>
                  {counts.claimed > 0 && (
                    <span className="text-amber-400 light:text-amber-700"> · {counts.claimed} {words.heldLabel.toLowerCase()}</span>
                  )}
                  {' · '}{counts.free} free
                </span>
              </div>

              <div className="min-h-0 overflow-y-auto">
                {rows.map(row => (
                  <div key={row.band} className="flex items-center gap-2 border-b border-zinc-800/50 py-1.5 last:border-0 light:border-zinc-200">
                    <div className="w-16 shrink-0">
                      <div className={`font-mono text-sm font-bold ${row.live ? 'text-zinc-100 light:text-zinc-900' : 'text-zinc-500'}`}>
                        {row.band}
                      </div>
                      <div className="font-mono text-2xs text-zinc-600 light:text-zinc-400">
                        {row.qsos > 0 ? `${row.qsos} Q` : '—'}
                      </div>
                    </div>
                    <div className="grid min-w-0 flex-1 grid-cols-3 gap-1.5">
                      {row.slots.map(slot => (
                        <SlotCell key={slot.mode} slot={slot} heldLabel={words.heldLabel} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {board.onAir.length > 0 && (
                <div className="mt-3 shrink-0 border-t border-zinc-800 pt-2 light:border-zinc-200">
                  <div className="text-2xs uppercase tracking-wider text-zinc-500">On the air now</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {board.onAir.map(call => (
                      <span key={call} className="rounded bg-emerald-500/10 px-1.5 py-0.5 font-mono text-xs font-bold text-emerald-400 light:bg-emerald-50 light:text-emerald-700">
                        {call}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
