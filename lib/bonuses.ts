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
  ;

export interface BonusContext {
  /** Transmitters claimed, i.e. the leading number of the entry class. */
  transmitters?: number;
}

/** Re-exported so the bonus table's one caller-facing helper lives beside the
 *  table. The implementation stays in lib/types.ts, which already had it — a
 *  second copy here is exactly the drift this file exists to end. */
export { transmitterCount as transmittersFromClass } from './types';

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
 * Winter Field Day objectives, from the WFDA rules for 2026.
 *
 * WFD does not have bonus points. It has *objectives*, each carrying an
 * Objective Multiplier (OM); the OM values of everything completed are summed,
 * one is added, and the result multiplies the QSO points:
 *
 *     total score = (total QSO points) × (OM + 1)
 *
 * The "+1" is why a station that completes nothing still scores its QSOs. This
 * is a different scoring model from Field Day's `points × power + bonuses`,
 * not a different set of numbers within the same one — the app applied Field
 * Day's model to WFD for several releases, which produced a score that could
 * not be arrived at from the WFD rules by any route.
 *
 * Note there is no power multiplier in WFD at all: every station is capped at
 * 100 W PEP, and running QRP is an objective (×4) rather than a multiplier.
 */
export interface ObjectiveDef {
  key: keyof Bonuses;
  label: string;
  /** The Objective Multiplier this objective contributes. */
  om: number;
}

export const WFD_OBJECTIVES: ObjectiveDef[] = [
  { key: 'wfd_alt_power',      om: 1, label: 'Operate 100% on alternative power' },
  { key: 'wfd_away_from_home', om: 3, label: 'Operate away from home' },
  { key: 'wfd_antennas',       om: 1, label: 'Contact on two or more new antennas' },
  { key: 'wfd_sat_fm',         om: 2, label: 'FM satellite contact' },
  { key: 'wfd_sat_ssb_cw',     om: 3, label: 'SSB or CW satellite contact' },
  { key: 'wfd_winlink',        om: 1, label: 'Send and receive a Winlink email' },
  { key: 'wfd_bulletin',       om: 1, label: 'Copy the WFD special bulletin' },
  { key: 'wfd_six_bands',      om: 6, label: 'Three contacts on six bands' },
  { key: 'wfd_twelve_bands',   om: 6, label: 'Three contacts on twelve bands' },
  { key: 'wfd_multi_mode',     om: 2, label: 'Use multiple modes' },
  { key: 'wfd_qrp',            om: 4, label: 'Operate the event QRP' },
  { key: 'wfd_six_hours',      om: 2, label: 'Operate six continuous hours' },
];

/**
 * The multiplier WFD applies to QSO points: the OM values of every completed
 * objective, plus one.
 *
 * Never returns zero — the rules add the 1 precisely so that a station which
 * completes no objectives still scores its contacts.
 */
export function objectiveMultiplier(bonuses: Bonuses): number {
  let om = 0;
  for (const def of WFD_OBJECTIVES) if (bonuses[def.key]) om += def.om;
  return om + 1;
}

/** Every objective completed. Worth stating as a derived constant rather than
 *  a literal, for the same reason the section total is derived. */
export const WFD_MAX_MULTIPLIER = WFD_OBJECTIVES.reduce((n, d) => n + d.om, 0) + 1;

/**
 * The bonus schedule for an event type.
 *
 * Only Field Day has one. A special event station has no contest score at all,
 * and Winter Field Day scores through WFD_OBJECTIVES instead — its objectives
 * multiply QSO points rather than adding points after the fact, so they cannot
 * be summed into a bonus total and must not be routed through here.
 */
export function bonusDefs(eventType: EventType | undefined): BonusDef[] {
  return eventType === 'FD' || eventType === undefined ? FD_BONUSES : [];
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
  }
}
