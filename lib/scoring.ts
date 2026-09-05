import type { QSO, Score, Band, BandStats, Bonuses, EventType } from './types';
import { MODE_POINTS, DX_EXCHANGE, MX_EXCHANGE, isARRLSection, transmitterCount } from './types';
import { bonusDefs, bonusPoints, objectiveMultiplier, type BonusContext } from './bonuses';

/**
 * ARRL Field Day power multiplier (rule 7.2): QRP ×5, low ×2, high ×1.
 *
 * Field Day only. Winter Field Day has no power multiplier — every station is
 * capped at 100 W PEP and running QRP is an objective worth ×4 in the OM,
 * so a WFD score never passes through here.
 */
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
  let gotaQSOs    = 0;

  for (const qso of validQSOs) {
    const pts = MODE_POINTS[qso.mode] ?? 1;
    // A GOTA contact counts here as well as earning its bonus. Rule 4.1.1.5:
    // "QSOs made by this station may be claimed for credit by its primary
    // Field Day operation. In addition, bonus points may be earned by this
    // station under rule 7.3.13." Excluding them — which this feature's
    // original plan proposed — would quietly deflate the claimed score.
    qsoPoints += pts;
    if (qso.is_gota) gotaQSOs++;

    if (qso.mode === 'PH')  phoneQSOs++;
    else if (qso.mode === 'CW')  cwQSOs++;
    else if (qso.mode === 'DIG') digitalQSOs++;

    if (qso.rcvd_section) {
      const sec = qso.rcvd_section.toUpperCase();
      if (isARRLSection(sec)) sections.add(sec);
      // DX is a legal exchange from outside the US and Canada, and MX is
      // Winter Field Day's for Mexico. Neither is a section, so neither
      // counts — but neither is a mistake either, so neither gets flagged as
      // one. Counting them would move the sections-worked figure off the
      // list it is supposed to measure against.
      else if (sec !== DX_EXCHANGE && sec !== MX_EXCHANGE) unknownSections.add(sec);
    }

    if (!byBand[qso.band]) byBand[qso.band] = { ph: 0, cw: 0, dig: 0 };
    const bs = byBand[qso.band]!;
    if (qso.mode === 'PH')  bs.ph++;
    else if (qso.mode === 'CW')  bs.cw++;
    else if (qso.mode === 'DIG') bs.dig++;
  }

  const sectionsWorked = sections.size;
  const isWfd = entry.eventType === 'WFD';

  // The two contests do not share a scoring model, only a QSO point table.
  //
  //   Field Day:        QSO points × power multiplier, then bonuses added
  //   Winter Field Day: QSO points × (Objective Multiplier + 1), no bonuses
  //
  // Running one formula for both is what made a WFD claimed score a number
  // the WFD rules cannot produce by any route.
  const powerMult = isWfd ? 1 : powerMultiplier(power);
  const objMult   = isWfd ? objectiveMultiplier(bonuses) : 1;
  const totalScore = qsoPoints * powerMult * objMult;

  // Field Day bonuses are added after the multiplier (rule 7.3) and none of
  // them is multiplied — 7.3.13.1 calls that out explicitly for GOTA. WFD has
  // no bonus points at all, so bonusDefs returns nothing for it.
  const bonusTotal = calculateBonusPoints(bonuses, entry.eventType, {
    transmitters: transmitterCount(entry.entryClass),
    gotaQsos: gotaQSOs,
  });

  return {
    total_qsos:      qsos.length,
    gota_qsos:       gotaQSOs,
    valid_qsos:      validQSOs.length,
    phone_qsos:      phoneQSOs,
    cw_qsos:         cwQSOs,
    digital_qsos:    digitalQSOs,
    qso_points:      qsoPoints,
    power_multiplier: powerMult,
    objective_multiplier: objMult,
    sections_worked: sectionsWorked,
    total_score:     totalScore,
    bonus_points:    bonusTotal,
    claimed_score:   totalScore + bonusTotal,
    by_band:         byBand,
    sections:        Array.from(sections).sort(),
    unknown_sections: Array.from(unknownSections).sort(),
  };
}
