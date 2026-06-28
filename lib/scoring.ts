import type { QSO, Score, Band, BandStats } from './types';
import { MODE_POINTS } from './types';

export function calculateScore(qsos: QSO[]): Score {
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

  return {
    total_qsos: qsos.length,
    valid_qsos: validQSOs.length,
    phone_qsos: phoneQSOs,
    cw_qsos: cwQSOs,
    digital_qsos: digitalQSOs,
    qso_points: qsoPoints,
    sections_worked: sectionsWorked,
    total_score: qsoPoints * sectionsWorked,
    by_band: byBand,
    sections: Array.from(sections).sort(),
  };
}
