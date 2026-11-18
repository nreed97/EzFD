import type { Bonuses, EventType } from './types';
import { entryClassLetter } from './types';

/**
 * The power category, in one table — what the setup page offers, what the
 * scorer multiplies by, what Cabrillo writes and what the pre-submission check
 * refuses all read it from here.
 *
 * Field Day (rule 7.2, Revised March 1, 2026) has four outcomes, not three.
 * Running 5 W or less earns ×5 only on a power source other than commercial
 * mains or a motor-driven generator (7.2.1); the same 5 W from the mains or a
 * generator is ×2 (7.2.2), the same as anything up to 100 W (7.2.3). A single
 * "QRP" option scored ×5 regardless, which over-claimed by a factor of two
 * and a half for every QRP station plugged into the wall — and for class D,
 * which is defined as running on commercial power (4.6), always.
 *
 * Classes D, E and F are capped at 100 W PEP (rule 4), so HIGH — over 100 W —
 * is not an option they can claim at all.
 *
 * Winter Field Day has no power multiplier and no high-power category: every
 * station is capped at 100 W PEP, and its Cabrillo CATEGORY-POWER is QRP or
 * LOW. Running QRP there is an *objective* (OM 4), so the objective is the
 * one place the claim is made; `cabrilloPower` derives the header from it
 * rather than keeping a second setting that could disagree.
 */

export type PowerCategory = 'HIGH' | 'LOW' | 'QRP' | 'QRP_MAINS';

export interface PowerDef {
  key: PowerCategory;
  /** What the setup page's button says. */
  label: string;
  /** One line under the buttons explaining the selected choice. */
  detail: string;
  multiplier: number;
  rule: string;
  /** What the Cabrillo CATEGORY-POWER header carries. QRP on mains is still
   *  a QRP entry; it is only the multiplier that differs. */
  cabrillo: 'HIGH' | 'LOW' | 'QRP';
  /** Field Day class letters that may claim it. */
  classes: readonly string[];
}

const ALL_FD_CLASSES = ['A', 'B', 'C', 'D', 'E', 'F'] as const;

export const FD_POWER: readonly PowerDef[] = [
  { key: 'HIGH',      label: 'High',          detail: 'Over 100 W, up to 500 W PEP',
    multiplier: 1, rule: '7.2.4', cabrillo: 'HIGH', classes: ['A', 'B', 'C'] },
  { key: 'LOW',       label: 'Low',           detail: '100 W or less',
    multiplier: 2, rule: '7.2.3', cabrillo: 'LOW',  classes: ALL_FD_CLASSES },
  { key: 'QRP',       label: 'QRP battery',   detail: '5 W or less, on batteries, solar or another source that is not the mains or a generator',
    multiplier: 5, rule: '7.2.1', cabrillo: 'QRP',  classes: ['A', 'B', 'C', 'E', 'F'] },
  { key: 'QRP_MAINS', label: 'QRP mains',     detail: '5 W or less, on the mains or a generator, or on batteries charged from either during the event',
    multiplier: 2, rule: '7.2.2', cabrillo: 'QRP',  classes: ALL_FD_CLASSES },
];

const byKey = (p: string | null | undefined) => FD_POWER.find(d => d.key === p);

export function isPowerCategory(p: unknown): p is PowerCategory {
  return typeof p === 'string' && !!byKey(p);
}

/** Field Day's power multiplier (rule 7.2). An unknown value is treated as
 *  HIGH, the multiplier that can never over-claim. */
export function powerMultiplier(power: string | null | undefined): number {
  return byKey(power)?.multiplier ?? 1;
}

/** The categories a Field Day class may choose from. With no class letter yet
 *  every category is offered. */
export function fdPowerOptions(entryClass: string | null | undefined): readonly PowerDef[] {
  const letter = entryClassLetter(entryClass);
  if (!letter) return FD_POWER;
  return FD_POWER.filter(d => d.classes.includes(letter));
}

/** Why this event's power category is not one the rules allow, or null. */
export function powerProblem(
  eventType: EventType,
  entryClass: string | null | undefined,
  power: string | null | undefined,
): string | null {
  if (eventType !== 'FD') return null;
  const def = byKey(power);
  if (!def) return `"${power}" is not a Field Day power category.`;
  const letter = entryClassLetter(entryClass);
  if (!letter || def.classes.includes(letter)) return null;
  if (def.key === 'HIGH') {
    return `Class ${letter} is limited to 100 W PEP (rule 4), so it cannot claim high power. ` +
      'Low power scores ×2.';
  }
  if (def.key === 'QRP') {
    return `Class ${letter} runs on commercial power (rule 4.6), so 5 W or less scores ×2 ` +
      '(rule 7.2.2), not ×5.';
  }
  return `Class ${letter} cannot claim ${def.label}.`;
}

/** The Cabrillo CATEGORY-POWER value. Winter Field Day's comes from the QRP
 *  objective, since that is where a WFD entry claims QRP. */
export function cabrilloPower(
  eventType: EventType,
  power: string | null | undefined,
  bonuses: Bonuses | null | undefined,
): 'HIGH' | 'LOW' | 'QRP' {
  if (eventType === 'WFD') return bonuses?.wfd_qrp ? 'QRP' : 'LOW';
  return byKey(power)?.cabrillo ?? 'HIGH';
}

/** What the summary sheet prints beside "Power". */
export function powerLabel(
  eventType: EventType,
  power: string | null | undefined,
  bonuses: Bonuses | null | undefined,
): string {
  if (eventType === 'WFD') {
    return bonuses?.wfd_qrp ? 'QRP (10 W phone, 5 W CW/digital)' : 'LOW (100 W or less)';
  }
  const def = byKey(power);
  return def ? `${def.label} (${def.detail.split(',')[0]})` : (power ?? 'HIGH');
}
