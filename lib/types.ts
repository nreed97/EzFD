// 60m/30m/17m/12m (WARC + 60m) are excluded from ARRL FD/WFD scoring, but a
// special event station has no contest exchange and isn't bound by that
// rule — SesCoordination/CheckoutBoard offer them, QSOForm's band grid does
// not for FD/WFD.
export type Band = '160m' | '80m' | '60m' | '40m' | '30m' | '20m' | '17m' | '15m' | '12m' | '10m' | '6m' | '2m' | '1.25m' | '70cm' | 'SAT';
export type Mode = 'PH' | 'CW' | 'DIG';

/** FD and WFD are ARRL contests. SES is a Special Event Station — a
 *  distributed activation of one callsign, with no contest exchange and no
 *  score, coordinated by band/mode checkout instead. */
export type EventType = 'FD' | 'WFD' | 'SES';

/** SOFT logs the QSO and warns; HARD refuses it. Offline replays bypass both. */
export type SlotEnforcement = 'SOFT' | 'HARD';

/** EVENT = once per band/mode for the whole event (the ARRL contest rule).
 *  DAY   = once per band/mode per UTC day (the sane default for a multi-week SES).
 *  NONE  = never flag a dupe. */
export type DupeRule = 'EVENT' | 'DAY' | 'NONE';

export interface Bonuses {
  emergency_power?: boolean;
  w1aw_bulletin?: boolean;
  satellite?: boolean;
  natural_power?: boolean;
  public_info_table?: boolean;
  media_publicity?: boolean;
  educational?: boolean;
  message_to_sm?: boolean;
  all_licensed?: boolean;
  elected_official?: boolean;
  web_posting?: boolean;
  social_media?: boolean;
  safety_officer?: boolean;
  youth_ops?: number;
  gota_qsos?: number;
  served_agency?: number;
  nts_traffic?: number;
}

export interface Event {
  id: string;
  join_code: string;
  club_name: string;
  club_call: string;
  event_year: number;
  event_type: EventType;
  power: 'HIGH' | 'LOW' | 'QRP';
  /** null for SES — there is no contest class. */
  class: string | null;
  /** null for SES — there is no contest section. */
  arrl_section: string | null;
  location: string | null;
  qrz_username: string | null;
  use_call_history: boolean;
  use_master_callsign_file: boolean;
  bonuses: Bonuses;
  created_at: string;
  // SES-only fields — null/default on FD and WFD events.
  starts_at: string | Date | null;
  ends_at: string | Date | null;
  ses_description: string | null;
  ses_qsl_info: string | null;
  slot_enforcement: SlotEnforcement;
  slot_minutes: number;
  dupe_rule: DupeRule;
  /** When true, an operator must be approved in the roster before they can
   *  log. Off by default — the join code remains the only gate. */
  require_operator_approval: boolean;
}

/** Display names for the three event types. Every user-facing surface reads
 *  from here so a new type can't leave "Field Day" hard-coded behind it. */
export const EVENT_TYPE_LABELS: Record<EventType, { name: string; short: string; blurb: string }> = {
  FD: {
    name: 'ARRL Field Day',
    short: 'Field Day',
    blurb: 'Fourth full weekend in June. Class + ARRL/RAC section exchange, scored.',
  },
  WFD: {
    name: 'Winter Field Day',
    short: 'Winter Field Day',
    blurb: 'Last full weekend in January. Category + ARRL/RAC section exchange, scored.',
  },
  SES: {
    name: 'Special Event Station',
    short: 'Special Event',
    blurb: 'One callsign, many operators, no contest exchange. Band/mode checkout instead of a score.',
  },
};

/** Full display name for an event type — 'ARRL Field Day', 'Winter Field Day',
 *  'Special Event Station'. */
export function eventTypeLabel(type: EventType): string {
  return EVENT_TYPE_LABELS[type].name;
}

/** True when the event is a Special Event Station, i.e. contest scoring,
 *  the class/section exchange and Cabrillo export do not apply. */
export function isSES(event: Pick<Event, 'event_type'>): boolean {
  return event.event_type === 'SES';
}

/** Transmitter count implied by a contest class (e.g. "3A" → 3, "1D" → 1).
 *  SES has no class, so callers pass `event.class` which is nullable. */
export function transmitterCount(eventClass: string | null): number {
  return parseInt(eventClass?.match(/^\d+/)?.[0] ?? '1', 10);
}

/** One operator's claim on the shared callsign for a band/mode over a time
 *  window. Overlap is prevented by an exclusion constraint in the database,
 *  not by the application — see db/schema.sql. */
export interface SesReservation {
  id: string;
  event_id: string;
  op_call: string;
  /** Who holds the slot on a contest event — station 2 holds 20m phone
   *  regardless of who is sitting at it. NULL on a special event, where the
   *  operator is the holder. */
  station_number?: number | null;
  band: Band;
  mode: Mode;
  starts_at: string;
  ends_at: string | null;
  planned_freq: string | null;
  note: string | null;
  status: 'RESERVED' | 'RELEASED';
  created_at: string;
}

/** Per-operator station identity. A distributed SES has one location per
 *  operator, and LoTW signs by station callsign *and* location, so these
 *  feed the ADIF MY_* fields per QSO rather than per event. */
export interface SesOperator {
  event_id: string;
  op_call: string;
  op_name: string | null;
  grid: string | null;
  state: string | null;
  county: string | null;
  dxcc: number | null;
  approved: boolean;
  created_at: string;
}

export interface QSO {
  id: string;
  event_id: string;
  callsign: string;
  band: Band;
  mode: Mode;
  datetime_utc: string | Date;
  sent_class: string | null;
  sent_section: string | null;
  rcvd_class: string | null;
  rcvd_section: string | null;
  operator_call: string | null;
  station_number: number;
  is_dupe: boolean;
  /** Audit trail. updated_by/deleted_by are self-asserted callsigns — who
   *  claimed to act, not a verified identity. */
  updated_at?: string | Date | null;
  updated_by?: string | null;
  deleted_at?: string | Date | null;
  deleted_by?: string | null;
  created_at: string;
  // SES exchange — null on contest QSOs.
  rst_sent: string | null;
  rst_rcvd: string | null;
  rcvd_name: string | null;
  rcvd_qth: string | null;
  rcvd_grid: string | null;
  comment: string | null;
  /** The real ADIF submode (FT8, RTTY, ...) when it differs from the
   *  PH/CW/DIG bucket that scoring and dupe detection use. */
  adif_mode: string | null;
  freq_khz: number | null;
}

export interface QSOFormData {
  callsign: string;
  band: Band;
  mode: Mode;
  rcvd_class: string;
  rcvd_section: string;
  operator_call: string;
  station_number: number;
  rst_sent?: string;
  rst_rcvd?: string;
  rcvd_name?: string;
  rcvd_qth?: string;
  rcvd_grid?: string;
  comment?: string;
}

export interface BandStats {
  ph: number;
  cw: number;
  dig: number;
}

export interface Score {
  total_qsos: number;
  valid_qsos: number;
  phone_qsos: number;
  cw_qsos: number;
  digital_qsos: number;
  qso_points: number;
  power_multiplier: number;
  /** Distinct *recognised* sections — the Worked All Sections numerator. */
  sections_worked: number;
  total_score: number;
  bonus_points: number;
  claimed_score: number;
  by_band: Partial<Record<Band, BandStats>>;
  /** Recognised sections only, sorted. Drives the grid, the map and the
   *  "sections needed" panel, none of which can render an unknown value. */
  sections: string[];
  /** Exchanges that were logged but aren't a section and aren't DX — almost
   *  always typos. Surfaced so an operator can find and correct them. */
  unknown_sections: string[];
}

// QSO with an optional pending marker for optimistic UI
export type DisplayQSO = QSO & { _pending?: true; _local_id?: string };

export interface QRZLookup {
  callsign: string;
  name: string | null;
  state: string | null;
  country: string | null;
  grid: string | null;
}

export interface CallHistoryLookup {
  callsign: string;
  sent_class: string | null;
  section: string | null;
  name: string | null;
  user_text: string | null;
  known_master: boolean;
}

export const BANDS: Band[] = ['160m', '80m', '60m', '40m', '30m', '20m', '17m', '15m', '12m', '10m', '6m', '2m', '1.25m', '70cm', 'SAT'];
export const MODES: Mode[] = ['PH', 'CW', 'DIG'];

export const MODE_POINTS: Record<Mode, number> = {
  PH: 1,
  CW: 2,
  DIG: 2,
};

// The 85 current ARRL/RAC sections: 71 US + 14 Canadian. Kept in sync with
// SECTION_DATA in lib/sections.ts and the GROUPS grid in components/SectionGrid.tsx
// — scripts/test-sections.cjs fails if the three ever disagree.
//
// RAC has moved twice recently and older lists are still circulating: Maritime
// (MAR) became NB/NS/PE, Ontario split into ONE/ONN/ONS plus GH (Golden
// Horseshoe, briefly abbreviated GTA), and Yukon is part of Northern
// Territories (NT) rather than a section of its own.
export const ARRL_SECTIONS = [
  'AB','AK','AL','AR','AZ',
  'BC','CO','CT',
  'DE','EB','EMA','ENY','EPA','EWA',
  'GA','GH','IA','ID','IL','IN',
  'KS','KY','LA','LAX',
  'MB','MDC','ME','MI','MN','MO','MS','MT',
  'NB','NC','ND','NE','NFL','NH','NL','NLI','NM','NNJ','NNY','NS','NT','NTX','NV',
  'OH','OK','ONE','ONN','ONS','OR','ORG',
  'PAC','PE','PR','QC',
  'RI','SB','SC','SCV','SD','SDG','SF','SFL','SJV','SK','SNJ','STX','SV',
  'TN','UT',
  'VA','VI','VT',
  'WCF','WI','WMA','WNY','WPA','WTX','WV','WWA','WY',
] as const;

export type ARRLSection = typeof ARRL_SECTIONS[number];

/**
 * Field Day stations outside the US and Canada send `DX` as their exchange.
 * It is a legal thing to receive and log, but it is not a section: it has no
 * place on the map, and it must never count toward Worked All Sections or the
 * bonus target would become 86.
 */
export const DX_EXCHANGE = 'DX';

/** Everything the entry form should accept without complaining. */
export const VALID_EXCHANGES: readonly string[] = [...ARRL_SECTIONS, DX_EXCHANGE];

export function isValidExchange(value: string): boolean {
  return VALID_EXCHANGES.includes(value.toUpperCase());
}

/** True only for real sections — the things Worked All Sections counts. */
export function isARRLSection(value: string): boolean {
  return (ARRL_SECTIONS as readonly string[]).includes(value.toUpperCase());
}
