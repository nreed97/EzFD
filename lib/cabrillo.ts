import type { QSO, Event } from './types';
import { MODE_POINTS } from './types';

function bandToKhz(band: string): string {
  const map: Record<string, string> = {
    '160m': '1800', '80m': '3500', '40m': '7000', '20m': '14000',
    '15m': '21000', '10m': '28000', '6m': '50000', '2m': '144000',
    '1.25m': '222000', '70cm': '432000', 'SAT': '145825',
  };
  return map[band] ?? '14000';
}

function modeToCab(mode: string): string {
  return mode === 'PH' ? 'PH' : mode === 'DIG' ? 'DG' : 'CW';
}

function toIso(dt: string | Date): string {
  return typeof dt === 'string' ? dt : dt.toISOString();
}

function formatDate(dt: string | Date): string {
  return toIso(dt).slice(0, 10);
}

function formatTime(dt: string | Date): string {
  return toIso(dt).slice(11, 16).replace(':', '');
}

export function generateCabrillo(event: Event, qsos: QSO[]): string {
  const validQSOs = qsos.filter(q => !q.is_dupe).sort(
    (a, b) => new Date(a.datetime_utc).getTime() - new Date(b.datetime_utc).getTime()
  );

  let qsoPoints = 0;
  const sections = new Set<string>();
  for (const q of validQSOs) {
    qsoPoints += MODE_POINTS[q.mode] ?? 1;
    if (q.rcvd_section) sections.add(q.rcvd_section.toUpperCase());
  }

  // Extract transmitter count from class string (e.g. "3A" → 3, "1D" → 1)
  const numTx = parseInt(event.class.match(/^\d+/)?.[0] ?? '1', 10);

  const header = [
    'START-OF-LOG: 3.0',
    `CALLSIGN: ${event.club_call}`,
    `CONTEST: ARRL-FD`,
    `CATEGORY-OPERATOR: MULTI-OP`,
    `CATEGORY-BAND: ALL`,
    `CATEGORY-POWER: HIGH`,
    `CATEGORY-MODE: MIXED`,
    `CATEGORY-TRANSMITTER: ${numTx}`,
    `CLAIMED-SCORE: ${qsoPoints * sections.size}`,
    `CLUB: ${event.club_name}`,
    `ARRL-SECTION: ${event.arrl_section}`,
    `CERTIFICATE: YES`,
    `CREATED-BY: EzFD`,
  ];

  const qsoLines = validQSOs.map(q => {
    const freq  = bandToKhz(q.band).padStart(6);
    const mo    = modeToCab(q.mode);
    const date  = formatDate(q.datetime_utc);
    const time  = formatTime(q.datetime_utc);
    const myCall    = event.club_call.padEnd(13);
    const myClass   = event.class.padEnd(6);
    const mySect    = event.arrl_section.padEnd(6);
    const theirCall = q.callsign.padEnd(13);
    const theirClass= (q.rcvd_class ?? '?').padEnd(6);
    const theirSect = (q.rcvd_section ?? '?').padEnd(6);
    const t = Math.max(0, (q.station_number ?? 1) - 1);

    return `QSO: ${freq} ${mo} ${date} ${time} ${myCall} ${myClass} ${mySect} ${theirCall} ${theirClass} ${theirSect} ${t}`;
  });

  return [...header, '', ...qsoLines, 'END-OF-LOG:'].join('\n');
}
