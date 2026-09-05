import type { QSO, Band, Mode, EventType } from './types';
import { BANDS, MODE_POINTS, DX_EXCHANGE, MX_EXCHANGE, isARRLSection } from './types';

/**
 * Who worked what, over the log the caller has already loaded.
 *
 * Pure: `(qsos, eventType)` in, one row per operator out. No clock is read
 * here — every figure is a property of the contacts themselves — so the same
 * log always produces the same table and this is testable without a browser.
 *
 * ## The rows must add up to the log
 *
 * A per-operator table that quietly totals less than the event's own QSO
 * count is worse than no table: the reader has no way to tell which number is
 * wrong. Two things would cause that, and both are handled rather than
 * dropped:
 *
 *   * **Contacts with no operator.** An ADIF import carries no
 *     `operator_call`, so those QSOs belong to nobody. They get their own row
 *     with `call: null` instead of being skipped, and the UI labels it.
 *   * **Dupes.** They are excluded from points and rate exactly as the scorer
 *     excludes them, but they are still counted, in their own column. An
 *     operator's dupe count is worth seeing, and hiding the contacts entirely
 *     would make the row disagree with the same operator's log filter.
 *
 * `reconcile()` asserts both properties, and the summary row shows the totals
 * so a reader can check the arithmetic against the scoreboard themselves.
 *
 * ## Rate is a best hour, not an average over the shift
 *
 * `bestHour` is the largest number of scoring contacts falling in any 60
 * minutes — the rolling figure contest software reports, and the one an
 * operator means by "my rate". An average over first-to-last divides a good
 * run by however long the operator sat there afterwards working nobody, so it
 * answers a different question and answers it badly: an operator who opens
 * with 60 in an hour and then holds a dead band for three more reads as
 * 15/hr, which describes neither the run nor the hour.
 *
 * `spanRate` keeps that average, because "what did this shift produce
 * overall" is a fair question too — it is just not the same one. Both are
 * labelled on screen.
 *
 * ## Points are QSO points, before any multiplier
 *
 * `qsoPoints` is the raw contribution: 1 a phone contact, 2 a CW or digital
 * one. It is deliberately not run through the power multiplier or the WFD
 * objective multiplier, and bonus points are not divided up at all, because
 * neither is attributable to a person — the multiplier is a property of the
 * entry and a bonus is earned by the club. Printing a per-operator "score"
 * would invite someone to add the column up and compare it to the claimed
 * total, which is a number it can never equal.
 */

/** The row for contacts that record no operator. Not a callsign, and
 *  deliberately not one that could collide with a real one. */
export const UNATTRIBUTED = null;

export interface OperatorStats {
  /** The operator's callsign, or `null` for contacts that recorded none. */
  call: string | null;
  /** Scoring contacts — dupes excluded, exactly as `calculateScore` counts. */
  qsos: number;
  /** Duplicates logged by this operator. Not in `qsos`, not in `qsoPoints`. */
  dupes: number;
  /** QSO points before any multiplier. See the note above on why. */
  qsoPoints: number;
  ph: number;
  cw: number;
  dig: number;
  /** Contacts worked at the GOTA station (rule 4.1.1.5). Already inside
   *  `qsos` — the flag says where the contact was made, not whose it is. */
  gota: number;
  /** Bands worked, in band order rather than the order they appear in the log. */
  bands: Band[];
  modes: Mode[];
  /** Which radios this operator sat at. One operator running two rigs is a
   *  real Field Day pattern, and it is invisible in every other column. */
  stations: number[];
  /** Recognised sections this operator worked. `DX` and `MX` are legal
   *  exchanges but not sections, so neither is counted here. */
  sections: number;
  /** Sections first worked by this operator — nobody in the log reached them
   *  earlier. The one column that says who brought something in rather than
   *  how much they did. */
  firstSections: string[];
  /** Most scoring contacts in any 60 minutes. `0` when the operator has none. */
  bestHour: number;
  /** When that hour started, ISO, or `null` when there is no scoring contact. */
  bestHourAt: string | null;
  /** Scoring contacts per hour across first-to-last, or `null` when they span
   *  less than an hour. A figure per hour needs an hour to average over:
   *  below that, dividing projects a partial hour out to a whole one, and the
   *  shorter the span the wilder the projection. Two contacts logged in the
   *  same second — which is what a burst of entry actually looks like once
   *  the server has stamped them — came out as 720,000/hr. `bestHour` is the
   *  figure for a short shift, and it counts rather than extrapolating. */
  spanRate: number | null;
  /** First and last contact, ISO. `null` only when the operator has none,
   *  which happens for someone signed in who has not logged yet. */
  first: string | null;
  last: string | null;
}

export interface OpStatsTable {
  rows: OperatorStats[];
  /** Column totals, so a reader can check the table against the scoreboard. */
  totals: {
    qsos: number;
    dupes: number;
    qsoPoints: number;
    ph: number;
    cw: number;
    dig: number;
    gota: number;
    operators: number;
  };
  /** True when any contact in the log records no operator, so the UI can
   *  explain the extra row rather than leaving a blank callsign. */
  hasUnattributed: boolean;
  /** True when the log contains a GOTA contact, so the column can be hidden
   *  entirely for the clubs that do not run one. */
  hasGota: boolean;
  /** False for a special event, which has no contest sections to count. */
  showsSections: boolean;
}

const HOUR_MS = 60 * 60 * 1000;

/** `datetime_utc` arrives as a string from the API and as a `Date` from `pg`.
 *  Both shapes reach this, the same way `lib/adif.ts` has to handle both. */
export function qsoTime(value: string | Date): number {
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

const iso = (ms: number): string => new Date(ms).toISOString();

/**
 * The largest number of timestamps falling within any 60-minute window.
 *
 * A window is anchored on a contact rather than on the clock: "60 in the
 * 21:00 hour" is an artefact of where the hour boundary happens to fall, and
 * a run that straddles one would be split in half by it. Sorted input, two
 * indices, linear.
 */
export function bestHourOf(timesMs: number[]): { count: number; startMs: number | null } {
  if (timesMs.length === 0) return { count: 0, startMs: null };
  const t = [...timesMs].sort((a, b) => a - b);
  let best = 0;
  let bestAt: number | null = null;
  let lo = 0;
  for (let hi = 0; hi < t.length; hi++) {
    // The window is [start, start + 1h): a contact exactly an hour after the
    // one anchoring it belongs to the next hour, not this one.
    while (t[hi] - t[lo] >= HOUR_MS) lo++;
    const count = hi - lo + 1;
    if (count > best) {
      best = count;
      bestAt = t[lo];
    }
  }
  return { count: best, startMs: bestAt };
}

interface Bucket {
  call: string | null;
  qsos: number;
  dupes: number;
  qsoPoints: number;
  ph: number;
  cw: number;
  dig: number;
  gota: number;
  bands: Set<string>;
  modes: Set<string>;
  stations: Set<number>;
  sections: Set<string>;
  firstSections: string[];
  times: number[];
}

function newBucket(call: string | null): Bucket {
  return {
    call, qsos: 0, dupes: 0, qsoPoints: 0, ph: 0, cw: 0, dig: 0, gota: 0,
    bands: new Set(), modes: new Set(), stations: new Set(), sections: new Set(),
    firstSections: [], times: [],
  };
}

/** The map key. `null` is not a usable key and the empty string is a real
 *  possibility in the column, so both fold to one sentinel that no callsign
 *  can be. */
const keyFor = (call: string | null | undefined): string =>
  call && call.trim() ? call.trim().toUpperCase() : ' unattributed';

/** The displayed callsign for a row, normalised. `k1abc` and `K1ABC ` are one
 *  operator; leaving them as two rows would split a shift in half. */
const displayCall = (call: string | null | undefined): string | null =>
  call && call.trim() ? call.trim().toUpperCase() : UNATTRIBUTED;

/**
 * Build the table.
 *
 * `qsos` is expected to be already free of soft-deleted contacts — every read
 * path filters `deleted_at IS NULL` before the log reaches a component — but
 * a deleted row that slipped through is dropped here too rather than counted,
 * because a restored contact reappearing in someone's total is a smaller
 * surprise than a deleted one still sitting in it.
 */
export function operatorStats(qsos: QSO[], eventType: EventType = 'FD'): OpStatsTable {
  const buckets = new Map<string, Bucket>();

  // Sections are attributed to whoever reached them first, so the log has to
  // be walked in time order regardless of the order it arrived in. SSE
  // inserts land at the front of the array, and an ADIF import can carry
  // contacts older than everything already logged.
  const live = qsos.filter(q => !q.deleted_at);
  const chronological = [...live].sort((a, b) => qsoTime(a.datetime_utc) - qsoTime(b.datetime_utc));

  const claimedSections = new Set<string>();

  for (const q of chronological) {
    const key = keyFor(q.operator_call);
    let b = buckets.get(key);
    if (!b) {
      b = newBucket(displayCall(q.operator_call));
      buckets.set(key, b);
    }

    // A dupe is logged, shown and attributed, but earns nothing — the same
    // split the scorer makes. It does not extend the operator's band list or
    // claim a section either: the contact that did those things was the first
    // one, and crediting the repeat would let a dupe look like work.
    if (q.is_dupe) {
      b.dupes++;
      continue;
    }

    b.qsos++;
    b.qsoPoints += MODE_POINTS[q.mode] ?? 1;
    if (q.mode === 'PH') b.ph++;
    else if (q.mode === 'CW') b.cw++;
    else if (q.mode === 'DIG') b.dig++;
    if (q.is_gota) b.gota++;

    b.bands.add(q.band);
    b.modes.add(q.mode);
    if (typeof q.station_number === 'number') b.stations.add(q.station_number);
    b.times.push(qsoTime(q.datetime_utc));

    if (eventType !== 'SES' && q.rcvd_section) {
      const sec = q.rcvd_section.toUpperCase();
      // Only recognised sections. `DX` and `MX` are legal exchanges that are
      // not sections, and an unrecognised value is a likely typo — counting
      // either would move an operator's section total off the list it is
      // supposed to measure against, exactly as it would the event's.
      if (isARRLSection(sec) && sec !== DX_EXCHANGE && sec !== MX_EXCHANGE) {
        b.sections.add(sec);
        if (!claimedSections.has(sec)) {
          claimedSections.add(sec);
          b.firstSections.push(sec);
        }
      }
    }
  }

  const bandOrder = new Map(BANDS.map((band, i) => [band as string, i]));
  const modeOrder = new Map((['PH', 'CW', 'DIG'] as Mode[]).map((m, i) => [m as string, i]));

  const rows: OperatorStats[] = [...buckets.values()].map(b => {
    const { count, startMs } = bestHourOf(b.times);
    const first = b.times.length ? Math.min(...b.times) : null;
    const last = b.times.length ? Math.max(...b.times) : null;
    const spanMs = first !== null && last !== null ? last - first : 0;
    return {
      call: b.call,
      qsos: b.qsos,
      dupes: b.dupes,
      qsoPoints: b.qsoPoints,
      ph: b.ph,
      cw: b.cw,
      dig: b.dig,
      gota: b.gota,
      bands: [...b.bands].sort((x, y) => (bandOrder.get(x) ?? 99) - (bandOrder.get(y) ?? 99)) as Band[],
      modes: [...b.modes].sort((x, y) => (modeOrder.get(x) ?? 99) - (modeOrder.get(y) ?? 99)) as Mode[],
      stations: [...b.stations].sort((x, y) => x - y),
      sections: b.sections.size,
      firstSections: b.firstSections,
      bestHour: count,
      bestHourAt: startMs === null ? null : iso(startMs),
      spanRate: spanMs >= HOUR_MS ? b.qsos / (spanMs / HOUR_MS) : null,
      first: first === null ? null : iso(first),
      last: last === null ? null : iso(last),
    };
  });

  const totals = rows.reduce(
    (acc, r) => ({
      qsos: acc.qsos + r.qsos,
      dupes: acc.dupes + r.dupes,
      qsoPoints: acc.qsoPoints + r.qsoPoints,
      ph: acc.ph + r.ph,
      cw: acc.cw + r.cw,
      dig: acc.dig + r.dig,
      gota: acc.gota + r.gota,
      operators: acc.operators,
    }),
    { qsos: 0, dupes: 0, qsoPoints: 0, ph: 0, cw: 0, dig: 0, gota: 0, operators: 0 },
  );
  // The unattributed row is a bucket of contacts, not a person, so it is not
  // counted as an operator — "5 operators" that includes an ADIF import would
  // be wrong on the one screen someone reads it off for a club write-up.
  totals.operators = rows.filter(r => r.call !== UNATTRIBUTED).length;

  return {
    rows: sortOpStats(rows, 'qsos', 'desc'),
    totals,
    hasUnattributed: rows.some(r => r.call === UNATTRIBUTED),
    hasGota: totals.gota > 0,
    showsSections: eventType !== 'SES',
  };
}

export type OpStatsSort =
  | 'call' | 'qsos' | 'dupes' | 'qsoPoints' | 'bestHour' | 'spanRate'
  | 'sections' | 'firstSections' | 'bands' | 'first' | 'last';

export type SortDirection = 'asc' | 'desc';

function sortValue(r: OperatorStats, by: OpStatsSort): number | string {
  switch (by) {
    case 'call':          return r.call ?? '';
    case 'bands':         return r.bands.length;
    case 'firstSections': return r.firstSections.length;
    // A missing rate sorts below every real one in either direction rather
    // than being coerced to 0, which would rank an operator who has not been
    // on for an hour yet alongside one who genuinely worked nobody.
    case 'spanRate':      return r.spanRate ?? -1;
    case 'first':
    case 'last': {
      const v = r[by];
      return v === null ? -1 : Date.parse(v);
    }
    default:              return r[by];
  }
}

/**
 * Sort the rows, stably, with the unattributed bucket pinned last.
 *
 * It is not an operator and it is frequently the largest row in an imported
 * log, so letting it take the top of a table headed "Operators" would read as
 * a claim that nobody made most of the contacts.
 */
export function sortOpStats(rows: OperatorStats[], by: OpStatsSort, dir: SortDirection): OperatorStats[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if ((a.call === UNATTRIBUTED) !== (b.call === UNATTRIBUTED)) {
      return a.call === UNATTRIBUTED ? 1 : -1;
    }
    const av = sortValue(a, by);
    const bv = sortValue(b, by);
    if (av < bv) return -1 * sign;
    if (av > bv) return 1 * sign;
    // Callsign breaks every tie, so the table does not reshuffle itself on a
    // re-render just because two operators are level.
    return (a.call ?? '').localeCompare(b.call ?? '');
  });
}

/**
 * Does the table account for every contact in the log?
 *
 * Exported so the test can assert it over generated logs rather than only
 * over the fixtures someone thought to write. A table whose rows do not sum
 * to the log is the failure this whole module is shaped to avoid.
 */
export function reconcile(table: OpStatsTable, qsos: QSO[]): { ok: boolean; detail: string } {
  const live = qsos.filter(q => !q.deleted_at);
  const valid = live.filter(q => !q.is_dupe).length;
  const dupes = live.length - valid;
  if (table.totals.qsos !== valid) {
    return { ok: false, detail: `rows total ${table.totals.qsos} scoring QSOs, log has ${valid}` };
  }
  if (table.totals.dupes !== dupes) {
    return { ok: false, detail: `rows total ${table.totals.dupes} dupes, log has ${dupes}` };
  }
  const modeSum = table.totals.ph + table.totals.cw + table.totals.dig;
  if (modeSum !== valid) {
    return { ok: false, detail: `mode columns total ${modeSum}, log has ${valid} scoring QSOs` };
  }
  return { ok: true, detail: '' };
}
