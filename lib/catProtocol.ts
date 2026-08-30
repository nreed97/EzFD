import type { Band, Mode } from './types';

/**
 * The Kenwood/Elecraft CAT dialect, as pure functions over strings.
 *
 * This is the decoding half of browser-native rig control (#65). It exists
 * separately from the transport so the part that can silently misread a radio
 * — and put a contact on the wrong band — is testable without a serial port,
 * a browser, or a radio.
 *
 * Every table here is transcribed from a source rather than written from
 * memory, and the source is named on each one. That matters more than usual:
 * the Python bridge gets all of this from Hamlib, which speaks some 200 rigs'
 * dialects, and a native implementation that quietly disagrees with it is
 * worse than not having one — the operator has no way to tell which is right.
 *
 * Kenwood was chosen first because it is the widest single dialect a Field Day
 * club is likely to bring: Kenwood itself, Elecraft's K3/KX3/K4, and FlexRadio
 * SmartCAT, which emulates a TS-2000 (see AGENTS.md).
 */

/** Kenwood frames are ASCII, terminated by a semicolon. */
const TERMINATOR = ';';

/**
 * Split a read buffer into complete frames, keeping the remainder.
 *
 * A serial read gives whatever bytes happened to arrive, so a frame can be
 * split across two reads and two frames can share one. Neither case is
 * exotic — both happen in the first seconds of polling — and getting this
 * wrong desyncs every later response by one field, which is the same failure
 * `probe_cw_support()` exists to avoid in the Python bridge.
 */
export function splitFrames(buffer: string): { frames: string[]; rest: string } {
  const parts = buffer.split(TERMINATOR);
  // The last element is whatever followed the final terminator: empty when the
  // buffer ended on one, a partial frame otherwise.
  const rest = parts.pop() ?? '';
  return { frames: parts.filter(f => f.length > 0), rest };
}

/**
 * Kenwood MD digit → Hamlib mode name.
 *
 * Transcribed from `kenwood_mode_table` in Hamlib's `rigs/kenwood/kenwood.c`,
 * which is the table the Python bridge is already reading through. Indices
 * 8, 18, 19, 22 and 23 are RIG_MODE_NONE there and are absent here.
 *
 * A rig may override this with its own table in Hamlib (`caps->mode_table`),
 * which is one reason this path asks the operator to confirm their radio
 * rather than assuming any serial port speaks stock Kenwood.
 */
export const KENWOOD_MODE_TABLE: Record<number, string> = {
  1: 'LSB',
  2: 'USB',
  3: 'CW',
  4: 'FM',
  5: 'AM',
  6: 'RTTY',
  7: 'CWR',
  9: 'RTTYR',
  10: 'PSK',
  11: 'PSKR',
  12: 'PKTLSB',
  13: 'PKTUSB',
  14: 'PKTFM',
  15: 'PKTAM',
};

/**
 * Hamlib mode name → the three modes EzFD scores.
 *
 * Transcribed from `MODE_MAP` in `ezfd-rig-bridge.py`, so the native path and
 * the bridge classify a mode identically. `scripts/test-cat-protocol.cjs`
 * reads that dictionary out of the Python and fails if the two disagree,
 * because a mode that classifies differently depending on which transport an
 * operator happened to use is a dupe-detection and scoring problem, not a
 * cosmetic one.
 */
export const HAMLIB_TO_EZFD: Record<string, Mode> = {
  USB: 'PH', LSB: 'PH', AM: 'PH', FM: 'PH',
  SAM: 'PH', AMS: 'PH', DSB: 'PH',
  CW: 'CW', CWR: 'CW',
  RTTY: 'DIG', RTTYR: 'DIG', PSK: 'DIG', PKTUSB: 'DIG',
  PKTLSB: 'DIG', PKTFM: 'DIG', PKTAM: 'DIG',
  FT8: 'DIG', FT4: 'DIG', JS8: 'DIG', OLIVIA: 'DIG',
  MFSK: 'DIG', DIGI: 'DIG',
  // Not in the bridge's table: Hamlib's reverse-PSK, reachable through the
  // Kenwood table above. Classified with the other data modes.
  PSKR: 'DIG',
};

/**
 * A Kenwood mode character to its table index.
 *
 * Hamlib reads this as `modebuf[offs] - '0'` below ':' and
 * `modebuf[offs] - 'A' + 10` above it, so a mode above 9 arrives as a letter.
 * Writing this as "parse a digit" — the obvious reading of a one-character
 * field — silently turns every data mode on a newer rig into a parse failure.
 */
export function modeIndexFromChar(ch: string): number | null {
  if (ch.length !== 1) return null;
  if (ch >= '0' && ch <= '9') return ch.charCodeAt(0) - 48;
  if (ch >= 'A' && ch <= 'F') return ch.charCodeAt(0) - 65 + 10;
  return null;
}

/** Which VFO the radio is receiving on. `FR2` is memory recall. */
export type VfoLetter = 'A' | 'B';

export type CatFrame =
  | { kind: 'freq'; vfo: VfoLetter; hz: number }
  | { kind: 'mode'; mode: Mode; hamlib: string }
  | { kind: 'vfo'; vfo: VfoLetter | 'MEM' };

/**
 * Decode one complete frame, with the terminator already stripped.
 *
 * Returns null for anything unrecognised rather than throwing. A CAT line is
 * shared with whatever else the radio volunteers — many rigs push unsolicited
 * status — so an unknown frame is the normal case, not an error worth
 * surfacing to an operator mid-contest.
 */
export function parseFrame(frame: string): CatFrame | null {
  // FA/FB: the command echo, then 11 digits of Hz. Hamlib reads the number
  // from offset 2 of a 13-character response.
  const f = /^F([AB])(\d{11})$/.exec(frame);
  if (f) {
    const hz = Number(f[2]);
    return Number.isFinite(hz) && hz > 0
      ? { kind: 'freq', vfo: f[1] as VfoLetter, hz }
      : null;
  }

  // MD: one character at offset 2.
  const m = /^MD(.)$/.exec(frame);
  if (m) {
    const idx = modeIndexFromChar(m[1]);
    if (idx === null) return null;
    const hamlib = KENWOOD_MODE_TABLE[idx];
    if (!hamlib) return null;              // a NONE slot, or off the table
    const mode = HAMLIB_TO_EZFD[hamlib];
    if (!mode) return null;
    return { kind: 'mode', mode, hamlib };
  }

  // FR: which VFO is receiving. Polled so the frequency read follows the
  // operator onto VFO B — reading FA unconditionally reports the wrong
  // frequency during split or on VFO B, and a wrong frequency sets a wrong
  // band, which is a scoring error rather than a display one.
  const r = /^FR([012])$/.exec(frame);
  if (r) {
    return { kind: 'vfo', vfo: r[1] === '0' ? 'A' : r[1] === '1' ? 'B' : 'MEM' };
  }

  return null;
}

/**
 * Band edges in Hz.
 *
 * Transcribed from `BANDS` in `ezfd-rig-bridge.py`. The test asserts the two
 * agree edge for edge: an operator moving between transports must not see the
 * band change under them, and the band is what the log records.
 */
export const BAND_EDGES: ReadonlyArray<readonly [number, number, Band]> = [
  [1_800_000, 2_000_000, '160m'],
  [3_500_000, 4_000_000, '80m'],
  [7_000_000, 7_300_000, '40m'],
  [14_000_000, 14_350_000, '20m'],
  [21_000_000, 21_450_000, '15m'],
  [28_000_000, 29_700_000, '10m'],
  [50_000_000, 54_000_000, '6m'],
  [144_000_000, 148_000_000, '2m'],
  [222_000_000, 225_000_000, '1.25m'],
  [420_000_000, 450_000_000, '70cm'],
];

/** The band a frequency falls in, or null when it falls outside all of them. */
export function freqToBand(hz: number): Band | null {
  for (const [lo, hi, band] of BAND_EDGES) {
    if (hz >= lo && hz <= hi) return band;
  }
  return null;
}

/** The polling cycle: which VFO, that VFO's frequency, and the mode. */
export const POLL_COMMANDS = ['FR;', 'MD;'] as const;
export const freqCommandFor = (vfo: VfoLetter): string => `F${vfo};`;
