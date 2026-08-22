import type { QSO, Score, Band, BandStats, Bonuses } from './types';
import { MODE_POINTS, ARRL_SECTIONS, DX_EXCHANGE, isARRLSection } from './types';

// ARRL Field Day power multiplier
// QRP (≤5 W) = ×5, Low Power (≤150 W) = ×2, High Power = ×1
export function powerMultiplier(power: 'HIGH' | 'LOW' | 'QRP' | string): number {
  if (power === 'QRP') return 5;
  if (power === 'LOW') return 2;
  return 1;
}

export function calculateBonusPoints(bonuses: Bonuses, baseScore: number, sectionsWorked: number): number {
  let pts = 0;

  // Emergency power doubles the base score (= baseScore added on top)
  if (bonuses.emergency_power) pts += baseScore;

  // Flat 100-point bonuses
  if (bonuses.w1aw_bulletin)     pts += 100;
  if (bonuses.satellite)         pts += 100;
  if (bonuses.natural_power)     pts += 100;
  if (bonuses.public_info_table) pts += 100;
  if (bonuses.media_publicity)   pts += 100;
  if (bonuses.educational)       pts += 100;
  if (bonuses.message_to_sm)     pts += 100;
  if (bonuses.all_licensed)      pts += 100;

  // Flat 50-point bonuses
  if (bonuses.elected_official) pts += 50;
  if (bonuses.web_posting)      pts += 50;
  if (bonuses.social_media)     pts += 50;

  // Flat 25-point bonuses
  if (bonuses.safety_officer) pts += 25;

  // Variable bonuses
  pts += (bonuses.youth_ops      ?? 0) * 20;
  pts += Math.min((bonuses.gota_qsos    ?? 0) * 10, 1000);
  pts += Math.min((bonuses.served_agency ?? 0) * 10, 100);
  pts += Math.min((bonuses.nts_traffic  ?? 0) * 10, 100);

  // Worked All Sections — 100 pts for working every ARRL/RAC section
  if (sectionsWorked >= ARRL_SECTIONS.length) pts += 100;

  return pts;
}

export function calculateScore(
  qsos: QSO[],
  bonuses: Bonuses = {},
  power: 'HIGH' | 'LOW' | 'QRP' | string = 'HIGH',
): Score {
  const validQSOs = qsos.filter(q => !q.is_dupe);
  // Only recognised sections count. The entry form warns on anything else but
  // still logs the QSO — correctly, since the exchange is what was actually
  // sent — so unrecognised values do reach the log, and counting them would
  // let a handful of typos push a station over the Worked All Sections
  // threshold and claim 100 points it never earned.
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
  const bonusPoints  = calculateBonusPoints(bonuses, totalScore, sectionsWorked);

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
    bonus_points:    bonusPoints,
    claimed_score:   totalScore + bonusPoints,
    by_band:         byBand,
    sections:        Array.from(sections).sort(),
    unknown_sections: Array.from(unknownSections).sort(),
  };
}
