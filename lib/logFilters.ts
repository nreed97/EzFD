import type { Band, Mode, QSO } from './types';

/**
 * Filtering for the dashboard log view.
 *
 * Pure functions over an array the dashboard has already loaded — deliberately
 * not queries. The dashboard holds the whole log for scoring and the map and
 * keeps it live over SSE, so filtering is a `useMemo`, which also means the
 * filters keep working on a field server whose network has dropped. Nothing
 * here reads the clock: `nowMs` is passed in, so the same inputs always give
 * the same answer and this is testable without a browser or a database.
 */

/** Show all contacts, hide the duplicates, or show only the duplicates. */
export type DupeFilter = 'all' | 'hide' | 'only';

export interface LogFilters {
  /** Substring, case-insensitive. Matches anywhere in the callsign, so a
   *  partial "did we work them?" check works while a run is going. */
  callsign: string;
  /** Empty array means "no restriction", not "match nothing" — a filter an
   *  operator has not touched must not hide the whole log. */
  operators: string[];
  stations: number[];
  bands: Band[];
  modes: Mode[];
  sections: string[];
  dupes: DupeFilter;
  /** Only contacts logged within this many minutes of `nowMs`. 0 = no limit. */
  sinceMinutes: number;
  /** Only contacts edited since they were logged — a reader for the #22 audit
   *  trail, which nothing surfaced before. */
  editedOnly: boolean;
}

export const EMPTY_FILTERS: LogFilters = {
  callsign: '',
  operators: [],
  stations: [],
  bands: [],
  modes: [],
  sections: [],
  dupes: 'all',
  sinceMinutes: 0,
  editedOnly: false,
};

/** True when nothing is being filtered — drives the "clear" affordance and the
 *  count line, so neither has to re-derive the same condition. */
export function isFiltered(f: LogFilters): boolean {
  return (
    f.callsign.trim() !== '' ||
    f.operators.length > 0 ||
    f.stations.length > 0 ||
    f.bands.length > 0 ||
    f.modes.length > 0 ||
    f.sections.length > 0 ||
    f.dupes !== 'all' ||
    f.sinceMinutes > 0 ||
    f.editedOnly
  );
}

function timeOf(v: string | Date | null | undefined): number {
  if (!v) return NaN;
  return (v instanceof Date ? v : new Date(v)).getTime();
}

/** The section as the log records it, uppercased. Unrecognised values are
 *  deliberately included — a filter that hid typos would hide exactly the
 *  contacts an operator opens this view to find and correct. */
function sectionOf(q: QSO): string {
  return (q.rcvd_section ?? '').toUpperCase();
}

export function applyLogFilters(qsos: QSO[], f: LogFilters, nowMs: number): QSO[] {
  const call = f.callsign.trim().toUpperCase();
  const ops = new Set(f.operators);
  const stations = new Set(f.stations);
  const bands = new Set<string>(f.bands);
  const modes = new Set<string>(f.modes);
  const sections = new Set(f.sections.map(s => s.toUpperCase()));
  const cutoff = f.sinceMinutes > 0 ? nowMs - f.sinceMinutes * 60_000 : null;

  return qsos.filter(q => {
    if (call && !q.callsign.toUpperCase().includes(call)) return false;
    // A contact with no operator recorded (an ADIF import, say) matches only
    // when the operator filter is off — it cannot be attributed to anyone.
    if (ops.size > 0 && !(q.operator_call && ops.has(q.operator_call))) return false;
    if (stations.size > 0 && !stations.has(q.station_number)) return false;
    if (bands.size > 0 && !bands.has(q.band)) return false;
    if (modes.size > 0 && !modes.has(q.mode)) return false;
    if (sections.size > 0 && !sections.has(sectionOf(q))) return false;
    if (f.dupes === 'hide' && q.is_dupe) return false;
    if (f.dupes === 'only' && !q.is_dupe) return false;
    if (f.editedOnly && !q.updated_at) return false;
    if (cutoff !== null) {
      const t = timeOf(q.datetime_utc);
      // A contact with an unparseable timestamp is kept rather than dropped:
      // silently vanishing from a time-filtered log is worse than appearing in
      // one it may not belong to.
      if (Number.isFinite(t) && t < cutoff) return false;
    }
    return true;
  });
}

/** The distinct values actually present in the log, for populating the filter
 *  controls. Offering every ARRL section when four were worked makes the
 *  control useless; these are the ones a reader can actually pick. */
export function filterOptions(qsos: QSO[]) {
  const operators = new Set<string>();
  const stations = new Set<number>();
  const bands = new Set<string>();
  const modes = new Set<string>();
  const sections = new Set<string>();

  for (const q of qsos) {
    if (q.operator_call) operators.add(q.operator_call);
    stations.add(q.station_number);
    bands.add(q.band);
    modes.add(q.mode);
    const s = sectionOf(q);
    if (s) sections.add(s);
  }

  return {
    operators: [...operators].sort(),
    stations: [...stations].sort((a, b) => a - b),
    bands: [...bands].sort(),
    modes: [...modes].sort(),
    sections: [...sections].sort(),
  };
}
