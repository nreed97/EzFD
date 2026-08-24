import type { QSO, Score, Band, BandStats, Bonuses, EventType } from './types';
import { MODE_POINTS, DX_EXCHANGE, isARRLSection } from './types';
import { bonusDefs, bonusPoints, transmittersFromClass, type BonusContext } from './bonuses';

// ARRL Field Day power multiplier
// QRP (≤5 W) = ×5, Low Power (≤150 W) = ×2, High Power = ×1
export function powerMultiplier(power: 'HIGH' | 'LOW' | 'QRP' | string): number {
  if (power === 'QRP') return 5;
  if (power === 'LOW') return 2;
  return 1;
}

/**
 * Total bonus points claimed, summed from the schedule in `lib/bonuses.ts`.
 *
 * There is no Worked All Sections bonus. Field Day rule 7.3 runs 7.3.1 through
 * 7.3.18 and none of them concerns sections — this app awarded 100 points for
 * a clean sweep for several releases, which is 100 points an entrant would
 * have transcribed onto a summary sheet and not earned. Sections are still
 * counted and still shown; they are an operating goal, not a bonus.
 */
export function calculateBonusPoints(
  bonuses: Bonuses,
  eventType: EventType = 'FD',
  ctx: BonusContext = {},
): number {
  let pts = 0;
  for (const def of bonusDefs(eventType)) pts += bonusPoints(def, bonuses, ctx);
  return pts;
}

/** The entry details the bonus schedule depends on: which contest's rules
 *  apply, and how many transmitters the class claims (rule 7.3.1 pays per
 *  transmitter). Optional so the common `calculateScore(qsos)` call in tests
 *  and read-only views stays as short as it was. */
export interface EntryDetails {
  eventType?: EventType;
  /** The entry class, e.g. "3A". NULL on an SES. */
  entryClass?: string | null;
}

export function calculateScore(
  qsos: QSO[],
  bonuses: Bonuses = {},
  power: 'HIGH' | 'LOW' | 'QRP' | string = 'HIGH',
  entry: EntryDetails = {},
): Score {
  const validQSOs = qsos.filter(q => !q.is_dupe);
  // Only recognised sections count. The entry form warns on anything else but
  // still logs the QSO — correctly, since the exchange is what was actually
  // sent — so unrecognised values do reach the log. Splitting them out keeps
  // the sections-worked figure honest and lets the UI flag the rest as likely
  // typos, which is the whole point of tracking them separately.
  const sections = new Set<string>();
  const unknownSections = new Set<string>();
  const byBand: Partial<Record<Band, BandStats>> = {};

  let phoneQSOs = 0;
  let cwQSOs    = 0;
  let digitalQSOs = 0;
  let qsoPoints   = 0;

  for (const qso of validQSOs) {
    const pts = MODE_POINTS[qso.mode] ?? 1;
    qsoPoints += pts;

    if (qso.mode === 'PH')  phoneQSOs++;
    else if (qso.mode === 'CW')  cwQSOs++;
    else if (qso.mode === 'DIG') digitalQSOs++;

    if (qso.rcvd_section) {
      const sec = qso.rcvd_section.toUpperCase();
      if (isARRLSection(sec)) sections.add(sec);
      // DX is a legal Field Day exchange from outside the US and Canada. It
      // isn't a section, so it doesn't count — but it isn't a mistake either,
      // so it doesn't get flagged as one.
      else if (sec !== DX_EXCHANGE) unknownSections.add(sec);
    }

    if (!byBand[qso.band]) byBand[qso.band] = { ph: 0, cw: 0, dig: 0 };
    const bs = byBand[qso.band]!;
    if (qso.mode === 'PH')  bs.ph++;
    else if (qso.mode === 'CW')  bs.cw++;
    else if (qso.mode === 'DIG') bs.dig++;
  }

  const mult         = powerMultiplier(power);
  const sectionsWorked = sections.size;
  const totalScore   = qsoPoints * mult;
  // Bonuses are added after the multiplier (rule 7.3) — none of them is
  // multiplied, including GOTA contacts, which 7.3.13.1 calls out explicitly.
  const bonusTotal   = calculateBonusPoints(bonuses, entry.eventType, {
    transmitters: transmittersFromClass(entry.entryClass),
    baseScore: totalScore,
  });

  return {
    total_qsos:      qsos.length,
    valid_qsos:      validQSOs.length,
    phone_qsos:      phoneQSOs,
    cw_qsos:         cwQSOs,
    digital_qsos:    digitalQSOs,
    qso_points:      qsoPoints,
    power_multiplier: mult,
    sections_worked: sectionsWorked,
    total_score:     totalScore,
    bonus_points:    bonusTotal,
    claimed_score:   totalScore + bonusTotal,
    by_band:         byBand,
    sections:        Array.from(sections).sort(),
    unknown_sections: Array.from(unknownSections).sort(),
  };
}
