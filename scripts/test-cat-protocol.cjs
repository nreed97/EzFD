#!/usr/bin/env node
// Unit tests for lib/catProtocol.ts — the decoding half of browser-native rig
// control (#65).
//
// The issue this implements says plainly that "a partial implementation that
// silently misreads a rig is worse than requiring the bridge", and that is the
// whole reason this file exists. A misread frequency sets a wrong band, and
// the band is what the log records and what the entry is scored on; a misread
// mode changes dupe detection. Neither shows up as an error — the number just
// looks plausible and is wrong.
//
// So two kinds of assertion here. The first is ordinary decoding. The second
// matters more: the TypeScript tables are transcribed from Hamlib and from the
// Python bridge, and this reads those sources back out and fails if they have
// drifted. An operator must not see a different band or mode depending on
// which transport they happened to connect with.

const { compile } = require('./_compile-ts.cjs');
const fs = require('fs');
const path = require('path');

const ts = compile(['lib/catProtocol.ts']);
const {
  splitFrames, parseFrame, freqToBand, modeIndexFromChar,
  BAND_EDGES, HAMLIB_TO_EZFD, KENWOOD_MODE_TABLE, freqCommandFor,
} = ts.load('catProtocol');

let failures = 0;
const ok = m => console.log(`ok    ${m}`);
const no = (m, d) => { failures++; console.log(`FAIL  ${m}${d ? `  ${d}` : ''}`); };
const eq = (actual, expected, m) =>
  actual === expected ? ok(m) : no(m, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);

const BRIDGE = fs.readFileSync(path.join(__dirname, '..', 'ezfd-rig-bridge.py'), 'utf8');

// ── framing ─────────────────────────────────────────────────────────────────
// A serial read returns whatever bytes arrived. Getting this wrong desyncs
// every later response by one field.
console.log('── framing a byte stream ──');
{
  let r = splitFrames('FA00014250000;');
  eq(r.frames.join('|'), 'FA00014250000', 'one whole frame');
  eq(r.rest, '', 'nothing left over');

  r = splitFrames('FA00014250000;MD3;');
  eq(r.frames.join('|'), 'FA00014250000|MD3', 'two frames in one read');

  r = splitFrames('FA000142');
  eq(r.frames.length, 0, 'a frame split across reads yields nothing yet');
  eq(r.rest, 'FA000142', 'and is held for the next read');

  // The realistic case: reassembly across a boundary.
  const first = splitFrames('MD3;FA000');
  const second = splitFrames(first.rest + '14250000;');
  eq(first.frames.join('|'), 'MD3', 'the complete frame comes out immediately');
  eq(second.frames.join('|'), 'FA00014250000', 'the split one comes out next read');

  eq(splitFrames('').frames.length, 0, 'an empty read is not a frame');
  eq(splitFrames(';;;').frames.length, 0, 'bare terminators are not frames');
}

// ── decoding ────────────────────────────────────────────────────────────────
console.log('\n── decoding frames ──');
{
  const f = parseFrame('FA00014250000');
  eq(f && f.kind, 'freq', 'FA is a frequency');
  eq(f && f.hz, 14250000, 'read as Hz');
  eq(f && f.vfo, 'A', 'on VFO A');
  eq(parseFrame('FB00007150000').hz, 7150000, 'FB is VFO B');

  eq(parseFrame('FA0001425000'), null, 'ten digits is not a frequency');
  eq(parseFrame('FA000142500000'), null, 'twelve digits is not either');
  eq(parseFrame('FA0000000000X'), null, 'nor is a non-digit');
  eq(parseFrame('FA00000000000'), null, 'nor is zero — a rig that has not answered');

  const m = parseFrame('MD3');
  eq(m && m.kind, 'mode', 'MD is a mode');
  eq(m && m.hamlib, 'CW', 'MD3 is CW in Hamlib terms');
  eq(m && m.mode, 'CW', 'which EzFD scores as CW');

  eq(parseFrame('MD1').mode, 'PH', 'LSB is phone');
  eq(parseFrame('MD2').mode, 'PH', 'USB is phone');
  eq(parseFrame('MD4').mode, 'PH', 'FM is phone');
  eq(parseFrame('MD5').mode, 'PH', 'AM is phone');
  eq(parseFrame('MD6').mode, 'DIG', 'RTTY is digital');
  eq(parseFrame('MD7').mode, 'CW', 'CW-reverse is still CW');
  eq(parseFrame('MD9').mode, 'DIG', 'RTTY-reverse is digital');

  // Hamlib reads a mode above 9 as a letter. Treating this field as "a digit"
  // — the obvious reading of one character — turns every data mode on a newer
  // rig into a parse failure, and the operator sees the mode stop updating
  // with no error anywhere.
  eq(modeIndexFromChar('A'), 10, "'A' is mode 10, not a digit");
  eq(modeIndexFromChar('F'), 15, "'F' is mode 15");
  eq(modeIndexFromChar('9'), 9, "and '9' is still nine");
  eq(modeIndexFromChar('G'), null, 'past F is nothing');
  eq(modeIndexFromChar(''), null, 'nor is an empty field');
  eq(parseFrame('MDA').mode, 'DIG', 'MDA is PSK, so digital');
  eq(parseFrame('MDD').mode, 'DIG', 'MDD is packet USB, so digital');

  eq(parseFrame('MD8'), null, 'mode 8 is NONE in Hamlib and decodes to nothing');
  eq(parseFrame('MD0'), null, 'nor does mode 0');

  // FR tells us which VFO to ask about. Without it, reading FA unconditionally
  // reports VFO A's frequency while the operator works split on B — a wrong
  // band on every contact, with nothing on screen to say so.
  eq(parseFrame('FR0').vfo, 'A', 'FR0 is VFO A');
  eq(parseFrame('FR1').vfo, 'B', 'FR1 is VFO B');
  eq(parseFrame('FR2').vfo, 'MEM', 'FR2 is memory');
  eq(freqCommandFor('B'), 'FB;', 'and the frequency query follows it');

  // Radios volunteer status nobody asked for. An unknown frame is normal.
  eq(parseFrame('IF00014250000     '), null, 'an unhandled frame is ignored');
  eq(parseFrame(''), null, 'so is an empty one');
  eq(parseFrame('?'), null, "and the rig's error response");
}

// ── the tables agree with their sources ─────────────────────────────────────
console.log('\n── the native path agrees with the bridge ──');
{
  // BANDS in ezfd-rig-bridge.py, read back out of the Python.
  const bandBlock = /^BANDS = \[$([\s\S]*?)^\]$/m.exec(BRIDGE);
  eq(!!bandBlock, true, "found the bridge's BANDS table");
  const pyBands = [...bandBlock[1].matchAll(/\(\s*([\d_]+),\s*([\d_]+),\s*"([^"]+)"\)/g)]
    .map(m => [Number(m[1].replace(/_/g, '')), Number(m[2].replace(/_/g, '')), m[3]]);
  eq(pyBands.length > 0, true, `it lists ${pyBands.length} bands`);

  const tsBands = BAND_EDGES.map(b => `${b[0]}-${b[1]}:${b[2]}`).join(' ');
  const pyJoined = pyBands.map(b => `${b[0]}-${b[1]}:${b[2]}`).join(' ');
  eq(tsBands, pyJoined, 'every band edge matches the bridge, edge for edge');

  // MODE_MAP in ezfd-rig-bridge.py.
  const modeBlock = /^MODE_MAP = \{$([\s\S]*?)^\}$/m.exec(BRIDGE);
  eq(!!modeBlock, true, "found the bridge's MODE_MAP");
  const pyModes = Object.fromEntries(
    [...modeBlock[1].matchAll(/"([A-Z0-9]+)":\s*"(PH|CW|DIG)"/g)].map(m => [m[1], m[2]]));
  eq(Object.keys(pyModes).length > 0, true, `it maps ${Object.keys(pyModes).length} modes`);

  const disagree = Object.keys(pyModes)
    .filter(k => HAMLIB_TO_EZFD[k] !== undefined && HAMLIB_TO_EZFD[k] !== pyModes[k]);
  eq(disagree.join(','), '', 'no mode classifies differently from the bridge');

  const missing = Object.keys(pyModes).filter(k => HAMLIB_TO_EZFD[k] === undefined);
  eq(missing.join(','), '', 'and none the bridge handles is missing here');

  // Every mode the Kenwood table can produce must classify to something, or a
  // rig reports a mode this path decodes and then drops on the floor.
  const unclassified = Object.values(KENWOOD_MODE_TABLE)
    .filter(name => HAMLIB_TO_EZFD[name] === undefined);
  eq(unclassified.join(','), '', 'every mode the Kenwood table yields is classified');
}

// ── frequency to band ───────────────────────────────────────────────────────
console.log('\n── frequency to band ──');
{
  eq(freqToBand(14250000), '20m', 'mid-band');
  eq(freqToBand(14000000), '20m', 'the bottom edge is in');
  eq(freqToBand(14350000), '20m', 'and the top edge');
  eq(freqToBand(13999999), null, 'a hertz below is out of band');
  eq(freqToBand(14350001), null, 'and a hertz above');
  eq(freqToBand(7150000), '40m', '40m');
  eq(freqToBand(50313000), '6m', '6m');
  eq(freqToBand(440000000), '70cm', '70cm');
  eq(freqToBand(10125000), null, '30m is not a contest band and maps to nothing');
  eq(freqToBand(0), null, 'zero is not a band');
}

console.log(failures === 0 ? '\nAll CAT protocol tests passed.' : `\n${failures} failure(s).`);
ts.cleanup();
process.exit(failures === 0 ? 0 : 1);
