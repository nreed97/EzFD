import type { QSO, Score, Band, BandStats, Bonuses } from './types';
import { MODE_POINTS } from './types';

export function calculateBonusPoints(bonuses: Bonuses, baseScore: number): number {
  let pts = 0;
  if (bonuses.emergency_power) pts += baseScore;
  if (bonuses.w1aw_bulletin)   pts += 100;
  if (bonuses.satellite)       pts += 100;
  if (bonuses.natural_power)   pts += 100;
  if (bonuses.public_info_table) pts += 100;
  if (bonuses.media_publicity) pts += 100;
  if (bonuses.educational)     pts += 100;
  if (bonuses.message_to_sm)   pts += 100;
  if (bonuses.all_licensed)    pts += 100;
  if (bonuses.elected_official) pts += 50;
  if (bonuses.web_posting)     pts += 50;
  if (bonuses.social_media)    pts += 50;
  if (bonuses.safety_officer)  pts += 25;
  pts += (bonuses.youth_ops    ?? 0) * 20;
  pts += Math.min((bonuses.gota_qsos   ?? 0) * 10, 1000);
  pts += Math.min((bonuses.served_agency ?? 0) * 10, 100);
  pts += Math.min((bonuses.nts_traffic ?? 0) * 10, 100);
  return pts;
}

export function calculateScore(qsos: QSO[], bonuses: Bonuses = {}): Score {
  const validQSOs = qsos.filter(q => !q.is_dupe);
  const sections = new Set<string>();
  const byBand: Partial<Record<Band, BandStats>> = {};

  let phoneQSOs = 0;
  let cwQSOs = 0;
  let digitalQSOs = 0;
  let qsoPoints = 0;

  for (const qso of validQSOs) {
    const pts = MODE_POINTS[qso.mode] ?? 1;
    qsoPoints += pts;

    if (qso.mode === 'PH') phoneQSOs++;
    else if (qso.mode === 'CW') cwQSOs++;
    else if (qso.mode === 'DIG') digitalQSOs++;

    if (qso.rcvd_section) sections.add(qso.rcvd_section.toUpperCase());

    if (!byBand[qso.band]) byBand[qso.band] = { ph: 0, cw: 0, dig: 0 };
    const bs = byBand[qso.band]!;
    if (qso.mode === 'PH') bs.ph++;
    else if (qso.mode === 'CW') bs.cw++;
    else if (qso.mode === 'DIG') bs.dig++;
  }

  const sectionsWorked = sections.size;
  const totalScore = qsoPoints * sectionsWorked;
  const bonusPoints = calculateBonusPoints(bonuses, totalScore);

  return {
    total_qsos: qsos.length,
    valid_qsos: validQSOs.length,
    phone_qsos: phoneQSOs,
    cw_qsos: cwQSOs,
    digital_qsos: digitalQSOs,
    qso_points: qsoPoints,
    sections_worked: sectionsWorked,
    total_score: totalScore,
    bonus_points: bonusPoints,
    claimed_score: totalScore + bonusPoints,
    by_band: byBand,
    sections: Array.from(sections).sort(),
  };
}
