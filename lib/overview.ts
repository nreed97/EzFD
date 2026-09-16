import type { Band, Mode } from './types';
import type { SlotInfo } from './slotBoard';
import { slotKey } from './slotBoard';

/**
 * What the site display shows, derived once.
 *
 * The overview answers one question for somebody standing in front of a screen
 * at the site rather than sitting at a radio: **what is running, and what is
 * free?** That is not the question the operating position picker answers, even
 * though both read the same board.
 *
 * The picker asks *may I sit here*, so its states are about permission —
 * `claimed` is red because it means you cannot have it, and `mine` exists at
 * all only because one operator is asking. A wall display has no "me": nobody
 * is signed in to it, and a claim is good news rather than a refusal. So the
 * three states here are about **coverage**, and they are deliberately not the
 * picker's four:
 *
 *   * `covered`  — somebody's logging window says they are on it right now.
 *   * `claimed`  — booked, but nobody is there yet. On a contest this is a
 *                  transmitter assignment; on a special event it is who holds
 *                  the callsign.
 *   * `free`     — neither.
 *
 * **Coverage outranks a claim**, which is the one rule in here worth stating.
 * A slot that is both claimed and occupied reads as `covered`, because the
 * person walking up wants to know where the gaps are, and a band with somebody
 * on it is not a gap however its paperwork looks. Reporting it as `claimed`
 * would have the display advertise a free band that is not free.
 *
 * Pure over an already-built board, with no clock of its own — `buildSlotBoard`
 * has already resolved what is active at a given instant, and asking the time
 * twice is how two panels on one screen come to disagree.
 */

export type Coverage = 'covered' | 'claimed' | 'free';

export interface OverviewSlot {
  mode: Mode;
  coverage: Coverage;
  /** Callsigns on air here. Empty unless `coverage` is `covered`. */
  onAir: string[];
  /** Who holds the claim, already formatted — a callsign or `Station N`. */
  heldBy?: string;
  /** When the claim ends, ISO, or null for an open-ended one. */
  until?: string | null;
}

export interface OverviewBand {
  band: Band;
  slots: OverviewSlot[];
  /** Contacts logged on this band, all modes. */
  qsos: number;
  /** True when any mode on this band has somebody on air. */
  live: boolean;
}

export interface CoverageCounts {
  covered: number;
  claimed: number;
  free: number;
}

export interface OverviewBoard extends CoverageCounts {
  bands: OverviewBand[];
  /** Every callsign on air anywhere, sorted, each appearing once. */
  onAir: string[];
}

/**
 * Count coverage over a set of band rows.
 *
 * The board's own totals cover every band the event offers, which is the right
 * number for "how much of the event is running" and the wrong one to print
 * directly above a filtered grid: the first render said *29 free* over five
 * visible rows holding nine free cells, and a reader trying to reconcile the
 * two finds nothing to reconcile. So the display counts the rows it actually
 * draws, and this is the function that does it.
 */
export function countCoverage(bands: OverviewBand[]): CoverageCounts {
  const n: CoverageCounts = { covered: 0, claimed: 0, free: 0 };
  for (const band of bands) for (const slot of band.slots) n[slot.coverage]++;
  return n;
}

function coverageOf(slot: SlotInfo | undefined): Coverage {
  if (!slot) return 'free';
  // Somebody being there beats the paperwork. See the note above.
  if (slot.onAir.length > 0) return 'covered';
  // `mine` is a claim too -- the picker distinguishes it, a wall display has
  // no "me" to distinguish it from.
  if (slot.state === 'claimed' || slot.state === 'mine') return 'claimed';
  return 'free';
}

/**
 * Build the display board.
 *
 * `bands` and `modes` come from `lib/bands.ts` so the rows are the event's own
 * bands in frequency order — a special event's 30m row appears because that
 * list says so, not because somebody remembered to add it here.
 *
 * `qsosByBand` is the per-band contact count the scorer already worked out
 * (`Score.by_band`); counting the log again here would be a second derivation
 * of a number printed elsewhere on the same screen.
 */
export function buildOverview(
  bands: Band[],
  modes: Mode[],
  board: Map<string, SlotInfo>,
  qsosByBand: Partial<Record<Band, { ph: number; cw: number; dig: number }>>,
): OverviewBoard {
  let covered = 0, claimed = 0, free = 0;
  const onAirAll = new Set<string>();

  const rows: OverviewBand[] = bands.map(band => {
    const slots: OverviewSlot[] = modes.map(mode => {
      const slot = board.get(slotKey(band, mode));
      const coverage = coverageOf(slot);

      if (coverage === 'covered') covered++;
      else if (coverage === 'claimed') claimed++;
      else free++;

      const onAir = coverage === 'covered' ? [...(slot?.onAir ?? [])] : [];
      for (const call of onAir) onAirAll.add(call);

      return {
        mode,
        coverage,
        onAir,
        heldBy: slot?.heldBy,
        until: slot?.until,
      };
    });

    const b = qsosByBand[band];
    return {
      band,
      slots,
      qsos: b ? b.ph + b.cw + b.dig : 0,
      live: slots.some(s => s.coverage === 'covered'),
    };
  });

  return {
    bands: rows,
    covered,
    claimed,
    free,
    onAir: [...onAirAll].sort(),
  };
}

/**
 * Drop the bands nobody has touched and nobody is on.
 *
 * Fifteen band rows is right for a picker, where every one of them is a thing
 * you might choose. It is wrong for a display read from across a tent, where
 * eleven empty rows push the four that matter off the bottom. A band earns its
 * row by having contacts on it or somebody on it — and `keep` holds the floor
 * so the board never collapses to nothing at the start of an event, when by
 * definition no band has either.
 */
export function activeBands(board: OverviewBoard, keep: number): OverviewBand[] {
  const active = board.bands.filter(b => b.qsos > 0 || b.live || b.slots.some(s => s.coverage === 'claimed'));
  if (active.length >= keep) return active;
  // Top up in the event's own band order rather than by any notion of which
  // band is "likely", which would be a preference dressed up as a rule.
  const rest = board.bands.filter(b => !active.includes(b));
  return [...active, ...rest.slice(0, keep - active.length)]
    .sort((a, b) => board.bands.indexOf(a) - board.bands.indexOf(b));
}
