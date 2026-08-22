import type { QSO, Event } from './types';
import { transmitterCount } from './types';
import { calculateScore } from './scoring';

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

/**
 * Cabrillo is a contest log format — it has no meaning for a special event
 * station, which has no contest, no exchange and no score. The export route
 * refuses `format=cabrillo` for SES events before reaching this function;
 * the class/section fallbacks below exist only so a mis-typed event can't
 * throw on a null.
 */
export function generateCabrillo(event: Event, qsos: QSO[]): string {
  const eventClass   = event.class ?? '1A';
  const eventSection = event.arrl_section ?? '';

  const validQSOs = qsos.filter(q => !q.is_dupe).sort(
    (a, b) => new Date(a.datetime_utc).getTime() - new Date(b.datetime_utc).getTime()
  );

  const score = calculateScore(qsos, event.bonuses ?? {}, event.power ?? 'HIGH');

  const numTx = transmitterCount(eventClass);

  const header = [
    'START-OF-LOG: 3.0',
    `CALLSIGN: ${event.club_call}`,
    `CONTEST: ${event.event_type === 'WFD' ? 'WFD' : 'ARRL-FD'}`,
    `CATEGORY-OPERATOR: MULTI-OP`,
    `CATEGORY-BAND: ALL`,
    `CATEGORY-POWER: ${event.power ?? 'HIGH'}`,
    `CATEGORY-MODE: MIXED`,
    `CATEGORY-TRANSMITTER: ${numTx}`,
    `CLAIMED-SCORE: ${score.claimed_score}`,
    `CLUB: ${event.club_name}`,
    `ARRL-SECTION: ${eventSection}`,
    `CERTIFICATE: YES`,
    `CREATED-BY: EzFD`,
  ];

  const qsoLines = validQSOs.map(q => {
    const freq  = bandToKhz(q.band).padStart(6);
    const mo    = modeToCab(q.mode);
    const date  = formatDate(q.datetime_utc);
    const time  = formatTime(q.datetime_utc);
    const myCall    = event.club_call.padEnd(13);
    const myClass   = eventClass.padEnd(6);
    const mySect    = eventSection.padEnd(6);
    const theirCall = q.callsign.padEnd(13);
    const theirClass= (q.rcvd_class ?? '?').padEnd(6);
    const theirSect = (q.rcvd_section ?? '?').padEnd(6);
    const t = Math.max(0, (q.station_number ?? 1) - 1);

    return `QSO: ${freq} ${mo} ${date} ${time} ${myCall} ${myClass} ${mySect} ${theirCall} ${theirClass} ${theirSect} ${t}`;
  });

  return [...header, '', ...qsoLines, 'END-OF-LOG:'].join('\n');
}
