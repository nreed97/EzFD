export type Band = '160m' | '80m' | '40m' | '20m' | '15m' | '10m' | '6m' | '2m' | '1.25m' | '70cm' | 'SAT';
export type Mode = 'PH' | 'CW' | 'DIG';

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
  event_type: 'FD' | 'WFD';
  power: 'HIGH' | 'LOW' | 'QRP';
  class: string;
  arrl_section: string;
  location: string | null;
  qrz_username: string | null;
  use_call_history: boolean;
  use_master_callsign_file: boolean;
  bonuses: Bonuses;
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
  created_at: string;
}

export interface QSOFormData {
  callsign: string;
  band: Band;
  mode: Mode;
  rcvd_class: string;
  rcvd_section: string;
  operator_call: string;
  station_number: number;
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
  sections_worked: number;
  total_score: number;
  bonus_points: number;
  claimed_score: number;
  by_band: Partial<Record<Band, BandStats>>;
  sections: string[];
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
  name: string | null;
  section: string | null;
  user_text: string | null;
  known_master: boolean;
}

export const BANDS: Band[] = ['160m', '80m', '40m', '20m', '15m', '10m', '6m', '2m', '1.25m', '70cm', 'SAT'];
export const MODES: Mode[] = ['PH', 'CW', 'DIG'];

export const MODE_POINTS: Record<Mode, number> = {
  PH: 1,
  CW: 2,
  DIG: 2,
};

export const ARRL_SECTIONS = [
  'AB','AK','AL','AR','AZ',
  'BC','CO','CT',
  'DE','EB','EMA','ENY','EPA','EWA',
  'GA','IA','ID','IL','IN',
  'KS','KY','LA','LAX',
  'MB','MDC','ME','MI','MN','MO','MS','MT',
  'NB','NC','ND','NE','NFL','NH','NL','NLI','NM','NNJ','NNY','NS','NT','NTX','NV',
  'OH','OK','ON','OR','ORG',
  'PAC','PEI','QC',
  'RI','SB','SC','SCV','SD','SDG','SF','SFL','SJV','SK','SNJ','STX','SV',
  'TN','UT',
  'VA','VT',
  'WCF','WI','WMA','WNY','WPA','WTX','WV','WWA','WY',
  'YT',
] as const;

export type ARRLSection = typeof ARRL_SECTIONS[number];
