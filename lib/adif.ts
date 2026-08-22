import type { QSO, Event, Band, Mode, SesOperator } from './types';

// ──────────────────────────────────────────────
// ADIF import / parsing
// ──────────────────────────────────────────────

export interface AdifQSO {
  callsign: string;
  band: Band | null;
  mode: Mode;
  rcvd_class: string;
  rcvd_section: string;
  datetime_utc?: string; // ISO 8601 UTC
}

function mhzToBand(mhz: number): Band | null {
  const khz = mhz * 1000;
  if (khz >= 1800  && khz < 2000)    return '160m';
  if (khz >= 3500  && khz < 4000)    return '80m';
  if (khz >= 7000  && khz < 7300)    return '40m';
  if (khz >= 14000 && khz < 14350)   return '20m';
  if (khz >= 21000 && khz < 21450)   return '15m';
  if (khz >= 28000 && khz < 29700)   return '10m';
  if (khz >= 50000 && khz < 54000)   return '6m';
  if (khz >= 144000 && khz < 148000) return '2m';
  if (khz >= 222000 && khz < 225000) return '1.25m';
  if (khz >= 420000 && khz < 450000) return '70cm';
  return null;
}

const ADIF_BAND_MAP: Record<string, Band> = {
  '160m': '160m', '80m': '80m', '40m': '40m', '20m': '20m',
  '15m': '15m', '10m': '10m', '6m': '6m', '2m': '2m',
  '1.25m': '1.25m', '70cm': '70cm',
};

export function adifModeToEzfd(mode: string): Mode {
  const m = mode.toUpperCase().trim();
  if (m === 'CW') return 'CW';
  if (['SSB', 'USB', 'LSB', 'FM', 'AM', 'PH'].includes(m)) return 'PH';
  return 'DIG'; // FT8, FT4, JS8, RTTY, PSK31, MSK144, etc.
}

export function parseAdif(text: string): AdifQSO[] {
  // Strip header — everything before <EOH>
  const headerEnd = text.search(/<EOH>/i);
  const body = headerEnd >= 0 ? text.slice(headerEnd + 5) : text;

  const results: AdifQSO[] = [];
  const recordTexts = body.split(/<EOR>/i);

  for (const rec of recordTexts) {
    const fields: Record<string, string> = {};

    // Parse <FIELD:LEN>VALUE pairs; optionally <FIELD:LEN:TYPE>VALUE
    const tagRe = /<([A-Z0-9_]+):(\d+)(?::[^>]+)?>/gi;
    let m: RegExpExecArray | null;
    while ((m = tagRe.exec(rec)) !== null) {
      const name = m[1].toUpperCase();
      const len = parseInt(m[2], 10);
      const valueStart = m.index + m[0].length;
      fields[name] = rec.slice(valueStart, valueStart + len);
    }

    const callsign = fields['CALL']?.trim().toUpperCase();
    if (!callsign) continue;

    // Band: prefer BAND field, fall back to FREQ (MHz)
    let band: Band | null = null;
    if (fields['BAND']) band = ADIF_BAND_MAP[fields['BAND'].toLowerCase().trim()] ?? null;
    if (!band && fields['FREQ']) {
      const mhz = parseFloat(fields['FREQ']);
      if (!isNaN(mhz)) band = mhzToBand(mhz);
    }

    const mode = adifModeToEzfd(fields['MODE'] ?? '');

    // Field Day exchange — try dedicated ARRL FD fields first, then SRX_STRING
    let rcvd_class   = fields['CLASS']?.trim().toUpperCase() ?? '';
    let rcvd_section = (fields['ARRL_SECT'] ?? fields['STATE'] ?? '').trim().toUpperCase();

    if ((!rcvd_class || !rcvd_section) && fields['SRX_STRING']) {
      const parts = fields['SRX_STRING'].trim().split(/\s+/);
      if (parts.length >= 2) {
        rcvd_class   = rcvd_class   || parts[0].toUpperCase();
        rcvd_section = rcvd_section || parts[1].toUpperCase();
      }
    }

    // Datetime — prefer OFF time over ON time
    let datetime_utc: string | undefined;
    const dateStr = (fields['QSO_DATE_OFF'] ?? fields['QSO_DATE'])?.trim();
    const timeStr = (fields['TIME_OFF'] ?? fields['TIME_ON'])?.trim();
    if (dateStr && dateStr.length >= 8 && timeStr && timeStr.length >= 4) {
      const y  = dateStr.slice(0, 4);
      const mo = dateStr.slice(4, 6);
      const d  = dateStr.slice(6, 8);
      const h  = timeStr.slice(0, 2);
      const mn = timeStr.slice(2, 4);
      const s  = timeStr.length >= 6 ? timeStr.slice(4, 6) : '00';
      const candidate = `${y}-${mo}-${d}T${h}:${mn}:${s}Z`;
      if (!isNaN(Date.parse(candidate))) datetime_utc = candidate;
    }

    results.push({ callsign, band, mode, rcvd_class, rcvd_section, datetime_utc });
  }

  return results;
}

// ──────────────────────────────────────────────
// ADIF export
// ──────────────────────────────────────────────

function adifField(tag: string, value: string): string {
  return `<${tag}:${value.length}>${value}`;
}

function toIso(dt: string | Date): string {
  return typeof dt === 'string' ? dt : dt.toISOString();
}

function formatDate(dt: string | Date): string {
  return toIso(dt).slice(0, 10).replace(/-/g, '');
}

function formatTime(dt: string | Date): string {
  return toIso(dt).slice(11, 16).replace(':', '');
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

/**
 * Per-operator station identity, keyed by operator callsign.
 *
 * A distributed special event station has one location *per operator*, not
 * one per event. LoTW signs by station callsign and location, so the MY_*
 * fields have to follow whoever actually made the contact — taking them from
 * events.location would stamp every operator's QSOs with the same wrong
 * location and produce a log that won't upload cleanly.
 */
export type OperatorLocations = Record<string, Pick<SesOperator, 'grid' | 'state' | 'county' | 'dxcc'>>;

export function generateADIF(
  event: Event,
  qsos: QSO[],
  operatorLocations: OperatorLocations = {},
): string {
  const isSes = event.event_type === 'SES';

  const header = [
    `ADIF exported by EzFD`,
    `<PROGRAMID:4>EzFD`,
    `<PROGRAMVERSION:5>1.0.0`,
    '<EOH>',
  ].join('\n');

  const records = qsos
    .filter(q => !q.is_dupe)
    .map(q => {
      // The operator's own location, for a distributed SES. Falls back to
      // nothing rather than to the event's location, so a missing roster
      // entry produces an incomplete record instead of a wrong one.
      const loc = q.operator_call ? operatorLocations[q.operator_call] : undefined;

      const fields = [
        adifField('CALL', q.callsign),
        adifField('BAND', q.band),
        adifField('FREQ', q.freq_khz ? (q.freq_khz / 1000).toFixed(4) : bandToFreq(q.band)),
        // adif_mode carries the real submode (FT8, RTTY...) when the PH/CW/DIG
        // bucket that scoring uses isn't specific enough for an ADIF importer.
        adifField('MODE', q.adif_mode || modeToAdif(q.mode)),
        adifField('QSO_DATE', formatDate(q.datetime_utc)),
        adifField('TIME_ON', formatTime(q.datetime_utc)),

        // STATION_CALLSIGN is the call that was signed on the air — the club
        // or special event call. OPERATOR is the individual at the key.
        adifField('STATION_CALLSIGN', event.club_call),
        q.operator_call ? adifField('OPERATOR', q.operator_call) : '',

        loc?.grid   ? adifField('MY_GRIDSQUARE', loc.grid)          : '',
        loc?.state  ? adifField('MY_STATE', loc.state)              : '',
        loc?.county ? adifField('MY_CNTY', loc.county)              : '',
        loc?.dxcc   ? adifField('MY_DXCC', String(loc.dxcc))        : '',

        // Section applies to both event types when set — it's the contest
        // multiplier for FD/WFD, and an optional informational field for an
        // SES, which may well be run outside either contest.
        event.arrl_section ? adifField('MY_ARRL_SECT', event.arrl_section) : '',
        q.rcvd_section ? adifField('ARRL_SECT', q.rcvd_section) : '',

        // The class exchange is contest-only.
        !isSes && q.rcvd_class
          ? adifField('SRX_STRING', `${q.rcvd_class} ${q.rcvd_section ?? ''}`.trim())
          : '',
        !isSes && event.class
          ? adifField('STX_STRING', `${event.class} ${event.arrl_section ?? ''}`.trim())
          : '',

        // SES exchange — signal report plus whatever the operator captured.
        q.rst_sent  ? adifField('RST_SENT', q.rst_sent)   : '',
        q.rst_rcvd  ? adifField('RST_RCVD', q.rst_rcvd)   : '',
        q.rcvd_name ? adifField('NAME', q.rcvd_name)      : '',
        q.rcvd_qth  ? adifField('QTH', q.rcvd_qth)        : '',
        q.rcvd_grid ? adifField('GRIDSQUARE', q.rcvd_grid): '',
        q.comment   ? adifField('COMMENT', q.comment)     : '',

        '<EOR>',
      ].filter(Boolean);
      return fields.join(' ');
    });

  return [header, ...records].join('\n');
}
