import type { QSO, Event, Band, Mode, SesOperator } from './types';
import { freqToBand } from './catProtocol';

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
  /** The ADIF FREQ field in kHz, when the file has one. */
  freq_khz?: number;
  /** The file's own MODE — FT8, RTTY, SSB — beside the PH/CW/DIG split, so an
   *  import keeps what the export writes back out. MODE rather than SUBMODE,
   *  because the export writes this value into MODE and USB or FT4 there is
   *  not valid ADIF. */
  adif_mode?: string;
  /** The file's OPERATOR, the person at the key. Absent when the file has
   *  none; the import then decides who to credit (see `importOperator`). */
  operator_call?: string;
  /** The file's STATION_CALLSIGN, the call that went out on the air. */
  station_callsign?: string;
}

function mhzToBand(mhz: number): Band | null {
  return freqToBand(Math.round(mhz * 1_000_000));
}

const ADIF_BAND_MAP: Record<string, Band> = {
  '160m': '160m', '80m': '80m', '60m': '60m', '40m': '40m', '30m': '30m',
  '20m': '20m', '17m': '17m', '15m': '15m', '12m': '12m', '10m': '10m',
  '6m': '6m', '2m': '2m', '1.25m': '1.25m', '70cm': '70cm',
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

    const qso: AdifQSO = { callsign, band, mode, rcvd_class, rcvd_section, datetime_utc };
    const mhz = parseFloat(fields['FREQ'] ?? '');
    if (Number.isFinite(mhz) && mhz > 0) qso.freq_khz = Math.round(mhz * 1000);
    const realMode = (fields['MODE'] ?? '').trim().toUpperCase();
    if (realMode) qso.adif_mode = realMode.slice(0, 20);
    const operator = fields['OPERATOR']?.trim().toUpperCase();
    if (operator) qso.operator_call = operator;
    const stationCall = fields['STATION_CALLSIGN']?.trim().toUpperCase();
    if (stationCall) qso.station_callsign = stationCall;
    results.push(qso);
  }

  return results;
}

/**
 * Who an imported record is credited to.
 *
 * The file's own OPERATOR first: a club log merged from N1MM, or this app's
 * own export, names the operator on every record, and stamping them all with
 * whoever clicked Import credited one person with the whole weekend.
 *
 * Without OPERATOR, ADIF treats STATION_CALLSIGN as the operator too, which is
 * right for a WSJT-X log kept under the operator's own call. It is wrong when
 * that call is the event's: on Field Day every station sends the club call, and
 * a club call is not a person, so it falls through to the importer.
 *
 * `valid` is the route's callsign check, passed in so this file stays free of
 * server imports; a value that fails it is treated as absent.
 */
export function importOperator(
  rec: Pick<AdifQSO, 'operator_call' | 'station_callsign'>,
  eventCall: string | null | undefined,
  importer: string | null,
  valid: (v: unknown) => string | null,
): string | null {
  const op = valid(rec.operator_call);
  if (op) return op;
  const station = valid(rec.station_callsign);
  if (station && station !== eventCall?.trim().toUpperCase()) return station;
  return importer;
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
    '160m': '1.8', '80m': '3.5', '60m': '5.3305', '40m': '7.0', '30m': '10.1',
    '20m': '14.0', '17m': '18.068', '15m': '21.0', '12m': '24.89', '10m': '28.0',
    '6m': '50.0', '2m': '144.0', '1.25m': '222.0', '70cm': '432.0', 'SAT': '145.825',
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
        //
        // A GOTA contact was signed with the GOTA station's own call, and this
        // field means exactly that, so it gets it. It matters beyond tidiness:
        // LoTW signs by station callsign, and uploading a GOTA contact under
        // the parent call is a contact the other station cannot confirm.
        adifField('STATION_CALLSIGN',
                  q.is_gota && event.gota_call ? event.gota_call : event.club_call),
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
