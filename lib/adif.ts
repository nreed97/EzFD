import type { QSO, Event } from './types';

function adifField(tag: string, value: string): string {
  return `<${tag}:${value.length}>${value}`;
}

function formatDate(iso: string): string {
  return iso.slice(0, 10).replace(/-/g, '');
}

function formatTime(iso: string): string {
  return iso.slice(11, 16).replace(':', '');
}

function bandToFreq(band: string): string {
  const map: Record<string, string> = {
    '160m': '1.8', '80m': '3.5', '40m': '7.0', '20m': '14.0',
    '15m': '21.0', '10m': '28.0', '6m': '50.0', '2m': '144.0',
    '1.25m': '222.0', '70cm': '432.0', 'SAT': '145.825',
  };
  return map[band] ?? '14.0';
}

function modeToAdif(mode: string): string {
  return mode === 'PH' ? 'SSB' : mode === 'DIG' ? 'FT8' : 'CW';
}

export function generateADIF(event: Event, qsos: QSO[]): string {
  const header = [
    'ADIF exported by EzFD',
    `<PROGRAMID:4>EzFD`,
    `<PROGRAMVERSION:5>1.0.0`,
    '<EOH>',
  ].join('\n');

  const records = qsos
    .filter(q => !q.is_dupe)
    .map(q => {
      const fields = [
        adifField('CALL', q.callsign),
        adifField('BAND', q.band),
        adifField('FREQ', bandToFreq(q.band)),
        adifField('MODE', modeToAdif(q.mode)),
        adifField('QSO_DATE', formatDate(q.datetime_utc)),
        adifField('TIME_ON', formatTime(q.datetime_utc)),
        adifField('STATION_CALLSIGN', event.club_call),
        adifField('MY_ARRL_SECT', event.arrl_section),
        q.rcvd_class ? adifField('SRX_STRING', `${q.rcvd_class} ${q.rcvd_section ?? ''}`.trim()) : '',
        adifField('STX_STRING', `${event.class} ${event.arrl_section}`),
        q.operator_call ? adifField('OPERATOR', q.operator_call) : '',
        '<EOR>',
      ].filter(Boolean);
      return fields.join(' ');
    });

  return [header, ...records].join('\n');
}
