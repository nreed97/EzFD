import type { Band, EventType, Mode } from './types';

/**
 * Which bands an event offers, in one place.
 *
 * This lived inside `QSOForm` as a grid plus two extra arrays. The operating
 * position picker needs the same list, and a second copy is how the section
 * list and the backup query went wrong before it — so it moved here rather
 * than being duplicated.
 *
 * The split is a scoring rule, not a preference: 60m and the WARC bands
 * (30m, 17m, 12m) are excluded from ARRL Field Day and Winter Field Day
 * scoring, so a contest must not offer them. A special event has no contest
 * exchange and is not bound by that rule, so it does.
 */

/** The common bands, laid out as the three-by-three grid the entry form draws.
 *  Row order is deliberate — an operator reaching for 20m looks in the middle. */
export const BAND_GRID: Band[][] = [
  ['160m', '80m',  '40m'],
  ['20m',  '15m',  '10m'],
  ['6m',   '2m',   'SAT'],
];

/** Beyond the grid: VHF/UHF a contest may still work. */
export const EXTRA_BANDS: Band[] = ['1.25m', '70cm'];

/** A special event adds 60m and the WARC bands to those. */
export const SES_EXTRA_BANDS: Band[] = ['60m', '30m', '17m', '12m', '1.25m', '70cm'];

export const MODES: Mode[] = ['PH', 'CW', 'DIG'];

/**
 * Every band, in frequency order, for anything that lists bands as rows.
 *
 * `BAND_GRID` is a *keyboard layout* — three by three, 20m in the middle where
 * a thumb reaches for it — and it is the wrong order for a table. So this is a
 * second arrangement of the same set, not a second set: the check below fails
 * the build rather than letting the two drift.
 *
 * `BandBreakdown` used to carry its own copy of this, and it was missing 60m,
 * 30m, 17m and 12m. Those are exactly the bands only a special event can log,
 * so an SES that worked 30m had its 30m contacts scored, counted and then
 * dropped from the band table with nothing to say they were missing — the
 * same shape of failure as the section list in two components.
 */
export const BAND_ORDER: Band[] = [
  '160m', '80m', '60m', '40m', '30m', '20m', '17m', '15m', '12m', '10m',
  '6m', '2m', '1.25m', '70cm', 'SAT',
];

/** The bands an event offers, in frequency order. */
export function orderedBandsFor(eventType: EventType | undefined): Band[] {
  const offered = new Set<Band>(bandsFor(eventType));
  return BAND_ORDER.filter(b => offered.has(b));
}

/** Everything an event can log on, grid bands first. */
export function bandsFor(eventType: EventType | undefined): Band[] {
  return [...BAND_GRID.flat(), ...(eventType === 'SES' ? SES_EXTRA_BANDS : EXTRA_BANDS)];
}

/** The extra bands alone, for a form that draws the grid separately. */
export function extraBandsFor(eventType: EventType | undefined): Band[] {
  return eventType === 'SES' ? SES_EXTRA_BANDS : EXTRA_BANDS;
}
