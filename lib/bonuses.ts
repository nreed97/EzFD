import type { Bonuses, EventType } from './types';

/**
 * The bonus point schedule, in one place.
 *
 * Every bonus used to be written out three times — the arithmetic in
 * `lib/scoring.ts`, the label and rate string in `components/BonusTracker.tsx`,
 * and a third derivation in `components/SummarySheet.tsx` (a nested ternary
 * over key names, which is how the summary sheet came to disagree with the
 * score it was summarising). Same shape as the section list in two components
 * and the backup query in four: the copies drift, and the one an operator
 * reads is not the one that was scored. There is one table now.
 *
 * Field Day values are transcribed from the official ARRL rules (Revised
 * 4/2026), rule numbers included so a future reader can check a line against
 * the source rather than against this file. Winter Field Day is a different
 * organisation's contest with its own rules, which are NOT the ones below —
 * see WFD_BONUSES.
 */

export type BonusDef =
  /** A single fixed award. */
  | { key: keyof Bonuses; label: string; rule?: string; kind: 'flat'; points: number }
  /** 100 points per claimed transmitter, capped. FD rule 7.3.1. */
  | { key: keyof Bonuses; label: string; rule?: string; kind: 'per-transmitter'; points: number; maxTransmitters: number }
  /** A counted bonus — n × points, optionally capped. */
  | { key: keyof Bonuses; label: string; rule?: string; kind: 'per-unit'; points: number; max: number | null; unit: string; inputMax: number }
  /** Adds the whole pre-bonus score again. Winter Field Day only, and
   *  unverified — kept solely so splitting the table changes no WFD number. */
  | { key: keyof Bonuses; label: string; rule?: string; kind: 'double-base' };

export interface BonusContext {
  /** Transmitters claimed, i.e. the leading number of the entry class. */
  transmitters?: number;
  /** QSO points × power multiplier, before bonuses. WFD's emergency power only. */
  baseScore?: number;
}

/**
 * The transmitter count from an entry class — "3A" → 3.
 *
 * Rule 4: the class is the maximum number of simultaneously transmitted
 * signals, and "the minimum number of transmitters that must be claimed is
 * one (1)", so an unparseable or absent class floors at 1 rather than zeroing
 * the emergency power bonus. NULL is normal here: `events.class` is NULL for
 * every SES row.
 */
export function transmittersFromClass(cls: string | null | undefined): number {
  const n = parseInt(String(cls ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * ARRL Field Day, rule 7.3. Ordered by rule number.
 *
 * Bonus points are added *after* the power multiplier is applied (rule 7.3),
 * which is what `calculateScore` does — none of these are multiplied.
 */
export const FD_BONUSES: BonusDef[] = [
  // 100 points per transmitter, not a doubling of the score. A 3A station
  // running 5,000 points claims 300 here, not 5,000.
  { key: 'emergency_power',      rule: '7.3.1',  label: '100% emergency power',        kind: 'per-transmitter', points: 100, maxTransmitters: 20 },
  { key: 'media_publicity',      rule: '7.3.2',  label: 'Media publicity',             kind: 'flat', points: 100 },
  { key: 'public_location',      rule: '7.3.3',  label: 'Public location',             kind: 'flat', points: 100 },
  { key: 'public_info_table',    rule: '7.3.4',  label: 'Public information table',    kind: 'flat', points: 100 },
  { key: 'message_to_sm',        rule: '7.3.5',  label: 'Message to section manager',  kind: 'flat', points: 100 },
  { key: 'nts_traffic',          rule: '7.3.6',  label: 'Formal messages handled',     kind: 'per-unit', points: 10, max: 100, unit: 'msgs', inputMax: 10 },
  { key: 'satellite',            rule: '7.3.7',  label: 'Satellite QSO',               kind: 'flat', points: 100 },
  { key: 'natural_power',        rule: '7.3.8',  label: 'Alternate power (5 QSOs)',    kind: 'flat', points: 100 },
  { key: 'w1aw_bulletin',        rule: '7.3.9',  label: 'W1AW bulletin copied',        kind: 'flat', points: 100 },
  { key: 'educational',          rule: '7.3.10', label: 'Educational activity',        kind: 'flat', points: 100 },
  { key: 'elected_official',     rule: '7.3.11', label: 'Elected official visit',      kind: 'flat', points: 100 },
  // 7.3.12 is a single 100-point bonus for a visit, not a per-representative
  // tally. Stored values from before this correction are numeric; any truthy
  // value claims the bonus, so a club that recorded "3 reps" still gets it.
  { key: 'served_agency',        rule: '7.3.12', label: 'Served agency rep visit',     kind: 'flat', points: 100 },
  // Five points per GOTA contact, with no cap, and explicitly not multiplied
  // by the power multiplier (7.3.13.1) — which holds here because no bonus is.
  { key: 'gota_qsos',            rule: '7.3.13.1', label: 'GOTA station QSOs',         kind: 'per-unit', points: 5, max: null, unit: 'QSOs', inputMax: 9999 },
  { key: 'gota_coach',           rule: '7.3.13.2', label: 'GOTA coach',                kind: 'flat', points: 100 },
  { key: 'web_posting',          rule: '7.3.14', label: 'Entry via ARRL web app',      kind: 'flat', points: 50 },
  { key: 'youth_ops',            rule: '7.3.15', label: 'Youth participants (≤18)',    kind: 'per-unit', points: 20, max: 100, unit: 'ops', inputMax: 99 },
  { key: 'social_media',         rule: '7.3.16', label: 'Social media promotion',      kind: 'flat', points: 100 },
  { key: 'safety_officer',       rule: '7.3.17', label: 'Safety officer',              kind: 'flat', points: 100 },
  { key: 'site_responsibilities', rule: '7.3.18', label: 'Site responsibilities',      kind: 'flat', points: 50 },
];

/**
 * Winter Field Day — NOT VERIFIED against a rules document.
 *
 * WFD is run by the Winter Field Day Association, not the ARRL, and has its
 * own scoring. These are the values this app has always used, preserved
 * unchanged so that correcting Field Day moves no WFD number; they should not
 * be taken as accurate. See the WFD scoring issue before trusting a WFD
 * claimed score.
 */
export const WFD_BONUSES: BonusDef[] = [
  { key: 'emergency_power',   label: 'Emergency power',            kind: 'double-base' },
  { key: 'w1aw_bulletin',     label: 'W1AW bulletin',              kind: 'flat', points: 100 },
  { key: 'satellite',         label: 'Satellite QSO',              kind: 'flat', points: 100 },
  { key: 'natural_power',     label: 'Natural power (solar/wind)', kind: 'flat', points: 100 },
  { key: 'public_info_table', label: 'Public info table',          kind: 'flat', points: 100 },
  { key: 'media_publicity',   label: 'Media publicity',            kind: 'flat', points: 100 },
  { key: 'educational',       label: 'Educational activity',       kind: 'flat', points: 100 },
  { key: 'message_to_sm',     label: 'Message to section manager', kind: 'flat', points: 100 },
  { key: 'all_licensed',      label: '100% attendees licensed',    kind: 'flat', points: 100 },
  { key: 'elected_official',  label: 'Elected official visit',     kind: 'flat', points: 50 },
  { key: 'web_posting',       label: 'Club website posting',       kind: 'flat', points: 50 },
  { key: 'social_media',      label: 'Social media post',          kind: 'flat', points: 50 },
  { key: 'safety_officer',    label: 'Safety officer',             kind: 'flat', points: 25 },
  { key: 'youth_ops',     label: 'Youth operators (under 18)', kind: 'per-unit', points: 20, max: null, unit: 'ops',  inputMax: 99 },
  { key: 'gota_qsos',     label: 'GOTA station QSOs',          kind: 'per-unit', points: 10, max: 1000, unit: 'QSOs', inputMax: 9999 },
  { key: 'served_agency', label: 'Served agency reps',         kind: 'per-unit', points: 10, max: 100,  unit: 'reps', inputMax: 10 },
  { key: 'nts_traffic',   label: 'NTS messages',               kind: 'per-unit', points: 10, max: 100,  unit: 'msgs', inputMax: 10 },
];

/** A special event station has no contest score, so it has no bonuses. */
export function bonusDefs(eventType: EventType | undefined): BonusDef[] {
  if (eventType === 'WFD') return WFD_BONUSES;
  if (eventType === 'SES') return [];
  return FD_BONUSES;
}

/** What one bonus is actually worth given what has been claimed. Zero when
 *  unclaimed, so callers can filter on the value rather than re-testing the
 *  key — which is how the summary sheet used to list a bonus at a different
 *  number from the one that was scored. */
export function bonusPoints(def: BonusDef, bonuses: Bonuses, ctx: BonusContext = {}): number {
  const claimed = bonuses[def.key];
  if (!claimed) return 0;
  switch (def.kind) {
    case 'flat':
      return def.points;
    case 'per-transmitter':
      return Math.min(ctx.transmitters ?? 1, def.maxTransmitters) * def.points;
    case 'per-unit': {
      const n = typeof claimed === 'number' ? claimed : 0;
      const raw = n * def.points;
      return def.max === null ? raw : Math.min(raw, def.max);
    }
    case 'double-base':
      return ctx.baseScore ?? 0;
  }
}

/** The rate as shown next to the checkbox — derived, so the number an operator
 *  reads on screen is the one the scorer will use. */
export function bonusRate(def: BonusDef, ctx: BonusContext = {}): string {
  switch (def.kind) {
    case 'flat':
      return `+${def.points}`;
    case 'per-transmitter': {
      const tx = Math.min(ctx.transmitters ?? 1, def.maxTransmitters);
      return `+${def.points} × ${tx} tx`;
    }
    case 'per-unit':
      return def.max === null
        ? `+${def.points} each`
        : `+${def.points} each, max ${def.max}`;
    case 'double-base':
      return '+100% of base';
  }
}
