'use client';

import { bandsFor, MODES } from './bands';
import { slotKey, type SlotInfo } from './slotBoard';
import type { Band, EventType, Mode } from './types';

/**
 * Where this browser last operated, and what the position picker should open
 * on because of it.
 *
 * The picker opened with nothing chosen, so every operator started by hunting
 * for their band in a grid of forty-five buttons — including the operator who
 * had just been sitting on it, and the one whose shift the checkout schedule
 * had already assigned. Neither had to be asked.
 *
 * Two separate signals, and they are not the same thing:
 *
 *   a *claim* is a booking. On a special event it is yours personally and is
 *   the whole point of the checkout; on a contest it belongs to the station.
 *
 *   the *last position* is where this browser was actually logging, which is
 *   usually the radio sitting in front of whoever is signing in next.
 *
 * A claim wins, because it is a statement about who should be where, whereas
 * the last position is only a record of who was. The picker says which reason
 * it used, so a preselected band is never mysterious.
 *
 * Deliberately `localStorage`, not `sessionStorage`. The session record is
 * cleared by "change operator" — which is exactly the moment this is worth
 * having, because a club's laptop stays at the same radio while the operators
 * rotate through it.
 */

export interface StoredPosition {
  band?: string;
  mode?: string;
}

/** Module-level so the identity is stable for `useStoredJson`'s fallback. */
export const NO_POSITION: StoredPosition = {};

/** Keyed by station as well as event: one club laptop is one radio, and the
 *  band station 2 was last on says nothing about where station 1 should sit. */
export function positionKey(joinCode: string, station: number): string {
  return `ezfd_pos_${joinCode}_${station}`;
}

/**
 * A stored position, validated against what this event actually offers.
 *
 * Both halves must be good. Unlike the logger's URL parsing — which keeps a
 * valid band even when the mode is junk, because those are two independent
 * requests — a remembered position is a single fact about where somebody sat,
 * and half of one is not worth preselecting.
 *
 * The band list is per event type, so a 30m position remembered on a special
 * event does not survive into a contest that cannot score it.
 */
export function validPosition(
  stored: StoredPosition | null | undefined,
  eventType: EventType | undefined,
): { band: Band; mode: Mode } | null {
  if (!stored) return null;
  const bands = bandsFor(eventType) as string[];
  const modes = MODES as string[];
  if (typeof stored.band !== 'string' || !bands.includes(stored.band)) return null;
  if (typeof stored.mode !== 'string' || !modes.includes(stored.mode)) return null;
  return { band: stored.band as Band, mode: stored.mode as Mode };
}

export interface Suggestion {
  band: Band;
  mode: Mode;
  /** Why this one — the picker shows it, so the choice is never unexplained. */
  reason: 'held' | 'last';
}

/**
 * What the picker should open on, given the board and the remembered position.
 *
 * Returns null when there is nothing to suggest, which is the first-ever
 * sign-in on a browser with no claim — the operator picks for themselves,
 * exactly as before.
 */
export function suggestPosition(
  board: Map<string, SlotInfo>,
  remembered: { band: Band; mode: Mode } | null,
): Suggestion | null {
  // Board order is bands then modes, so holding two slots preselects the
  // earlier band. Any deterministic answer will do here; an operator holding
  // two slots at once is picking between two bands they already own.
  for (const slot of board.values()) {
    if (slot.state === 'mine') return { band: slot.band, mode: slot.mode, reason: 'held' };
  }
  if (remembered) {
    const slot = board.get(slotKey(remembered.band, remembered.mode));
    // Never nudge somebody onto a band another holder has booked. They can
    // still choose it — "start here anyway" exists because a contact that
    // already happened has to be logged — but choosing it should be their
    // decision, not a default they have to notice and undo.
    //
    // Presence alone does not disqualify it. A slot reads as busy from the
    // operator's own row left behind by a previous window as readily as from
    // somebody else's, and suppressing the memory then would break the
    // commonest case there is: signing back in at the radio you just left.
    if (slot && slot.state !== 'claimed') return { ...remembered, reason: 'last' };
  }
  return null;
}

/**
 * Record where the operator is now.
 *
 * Written straight rather than through `useStoredJson` because the callers are
 * an event handler and an effect, not a render. `useStoredJson` compares the
 * raw string it last parsed against what storage holds, so a write from here
 * can never leave a reader holding a stale parse — it only means a component
 * already mounted in *this* document is not re-rendered by it, and nothing
 * reads this key in the same document that writes it.
 */
export function rememberPosition(
  joinCode: string,
  station: number,
  band: Band,
  mode: Mode,
): void {
  try {
    localStorage.setItem(positionKey(joinCode, station), JSON.stringify({ band, mode }));
  } catch {
    // Private mode, or storage disabled. The position just isn't remembered.
  }
}
