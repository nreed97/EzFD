import type { EventType, QSO } from './types';

/**
 * The columns the dashboard log view can show, in one table.
 *
 * Same reasoning as `lib/bonuses.ts`: the label, the accessor and the default
 * set are one definition rather than three that drift. A column added here
 * appears in the picker, the header and the body with no other edit.
 */

export interface LogColumn {
  id: string;
  /** Header text. Kept short — this is a dense table on a projector. */
  label: string;
  /** Longer name for the column picker, where there is room to be clear. */
  title?: string;
  align?: 'left' | 'right';
  /** Rendered cell text. Formatting only — never reads the clock, so the
   *  table stays pure and printable. */
  value: (q: QSO) => string;
}

/** `pg` hands back TIMESTAMPTZ as a Date, the SSE stream as an ISO string, and
 *  a queued offline contact as whatever it stored. Every date column goes
 *  through here — this is the shape bug AGENTS.md records for the exporters,
 *  and it reaches the UI for the same reason. */
export function hhmmss(v: string | Date | null | undefined): string {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(11, 19);
}

function dayHhmm(v: string | Date | null | undefined): string {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? '' : `${d.toISOString().slice(5, 10)} ${d.toISOString().slice(11, 16)}`;
}

const str = (v: string | number | null | undefined) => (v === null || v === undefined ? '' : String(v));

export const LOG_COLUMNS: LogColumn[] = [
  { id: 'time',        label: 'UTC',     title: 'Time (UTC)',      value: q => hhmmss(q.datetime_utc) },
  { id: 'callsign',    label: 'Call',    title: 'Callsign',        value: q => q.callsign },
  { id: 'band',        label: 'Band',    value: q => q.band },
  { id: 'mode',        label: 'Mode',    value: q => q.mode },
  { id: 'adif_mode',   label: 'Submode', title: 'Submode (FT8, RTTY…)', value: q => str(q.adif_mode) },
  { id: 'freq',        label: 'Freq',    title: 'Frequency (kHz)', align: 'right',
    value: q => (q.freq_khz ? q.freq_khz.toLocaleString() : '') },
  { id: 'sent_class',  label: 'Sent',    title: 'Sent class',      value: q => str(q.sent_class) },
  { id: 'sent_section', label: 'S/Sect', title: 'Sent section',    value: q => str(q.sent_section) },
  { id: 'rcvd_class',  label: 'Class',   title: 'Received class',  value: q => str(q.rcvd_class) },
  { id: 'rcvd_section', label: 'Sect',   title: 'Received section', value: q => str(q.rcvd_section) },
  { id: 'operator',    label: 'Op',      title: 'Operator',        value: q => str(q.operator_call) },
  { id: 'station',     label: 'Stn',     title: 'Station number',  align: 'right',
    value: q => str(q.station_number) },
  { id: 'rst_sent',    label: 'RST S',   title: 'RST sent',        value: q => str(q.rst_sent) },
  { id: 'rst_rcvd',    label: 'RST R',   title: 'RST received',    value: q => str(q.rst_rcvd) },
  { id: 'name',        label: 'Name',    title: 'Received name',   value: q => str(q.rcvd_name) },
  { id: 'qth',         label: 'QTH',     title: 'Received QTH',    value: q => str(q.rcvd_qth) },
  { id: 'grid',        label: 'Grid',    title: 'Received grid',   value: q => str(q.rcvd_grid) },
  { id: 'comment',     label: 'Comment', value: q => str(q.comment) },
  { id: 'edited',      label: 'Edited',  title: 'Last edited (who, when)',
    value: q => (q.updated_at ? `${q.updated_by ?? '?'} ${dayHhmm(q.updated_at)}` : '') },
];

export const LOG_COLUMN_IDS = LOG_COLUMNS.map(c => c.id);

/**
 * Default columns by event type.
 *
 * A special event has no contest exchange at all — `sent_class` and
 * `rcvd_section` are NULL on every row — so defaulting to the contest columns
 * would show an operator a table of empty cells. It wants the SES exchange
 * instead: RST, name, QTH, grid.
 */
const FD_DEFAULT = ['time', 'callsign', 'band', 'mode', 'rcvd_class', 'rcvd_section', 'operator', 'station'];
const SES_DEFAULT = ['time', 'callsign', 'band', 'mode', 'rst_sent', 'rst_rcvd', 'name', 'grid', 'operator'];

export function defaultColumns(eventType: EventType | undefined): string[] {
  return eventType === 'SES' ? [...SES_DEFAULT] : [...FD_DEFAULT];
}

/**
 * A stored column choice, made safe to render.
 *
 * Storage is per-browser and survives upgrades, so a saved list can name a
 * column that no longer exists or omit one added since. Unknown ids are
 * dropped rather than rendered as blanks, and an empty result falls back to
 * the defaults — an operator who somehow clears every column gets a usable
 * table back rather than an empty one with no way to recover.
 */
export function resolveColumns(stored: string[] | null | undefined, eventType: EventType | undefined): LogColumn[] {
  const wanted = Array.isArray(stored) ? stored : defaultColumns(eventType);
  const byId = new Map(LOG_COLUMNS.map(c => [c.id, c]));
  const cols = wanted.map(id => byId.get(id)).filter((c): c is LogColumn => c !== undefined);
  if (cols.length > 0) return cols;
  return defaultColumns(eventType)
    .map(id => byId.get(id))
    .filter((c): c is LogColumn => c !== undefined);
}
