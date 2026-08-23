#!/usr/bin/env node
/**
 * wsjtx-bridge.cjs — EzFD companion bridge for WSJT-X / JTDX
 *
 * Listens for UDP broadcasts from WSJT-X or JTDX and auto-logs
 * LOGGED_QSO messages to an EzFD event via the /api/qso endpoint.
 *
 * Requires Node.js 18+ (built-in fetch).  No npm installs needed.
 *
 * Usage:
 *   node scripts/wsjtx-bridge.cjs \
 *     --event-id  <EzFD event UUID>   \
 *     --api-url   http://localhost:3000 \
 *     --operator  W0NY                 \
 *     --station   1                    \
 *     --port      2237                 \
 *     --spool     ~/.ezfd/wsjtx-queue-<event>.jsonl
 *
 * Environment variable equivalents (flags take precedence):
 *   EZFD_EVENT_ID, EZFD_API_URL, EZFD_OPERATOR, EZFD_STATION, EZFD_UDP_PORT,
 *   EZFD_SPOOL
 *
 * A contact the server can't take is written to the spool file and retried
 * until it lands, so an EzFD restart or a network blip delays contacts rather
 * than dropping them. The spool survives closing the bridge: it is drained on
 * the next start.
 *
 * WSJT-X must have "UDP Server" enabled in File → Settings → Reporting.
 * The default UDP port is 2237; set it to match --port if changed.
 */

'use strict';

const dgram  = require('dgram');
const https  = require('https');
const http   = require('http');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

// ──────────────────────────────────────────
// CLI / env config
// ──────────────────────────────────────────

function arg(flag, env, def) {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return process.env[env] ?? def;
}

const EVENT_ID  = arg('--event-id', 'EZFD_EVENT_ID',  '');
const API_URL   = arg('--api-url',  'EZFD_API_URL',   'http://localhost:3000');
const OPERATOR  = arg('--operator', 'EZFD_OPERATOR',  '');
const STATION   = parseInt(arg('--station', 'EZFD_STATION', '1'), 10);
const UDP_PORT  = parseInt(arg('--port',    'EZFD_UDP_PORT', '2237'), 10);
// Where contacts wait when the server can't take them. Under the operator's
// home directory rather than the OS temp dir, which some systems clear on
// reboot — the whole point is that these survive.
const SPOOL     = arg('--spool', 'EZFD_SPOOL',
  path.join(os.homedir(), '.ezfd', `wsjtx-queue-${EVENT_ID}.jsonl`));

if (!EVENT_ID) {
  console.error('Error: --event-id (or EZFD_EVENT_ID) is required.');
  console.error('Run: node scripts/wsjtx-bridge.cjs --event-id <UUID> [options]');
  process.exit(1);
}

// ──────────────────────────────────────────
// WSJT-X binary protocol reader
// ──────────────────────────────────────────

const MAGIC = 0xADBCCBDA;

// Message types we care about
const MSG_LOGGED_QSO = 5;

class Reader {
  constructor(buf) {
    this.buf = buf;
    this.pos = 0;
  }

  remaining() { return this.buf.length - this.pos; }

  u8() {
    if (this.remaining() < 1) throw new Error('underflow');
    return this.buf.readUInt8(this.pos++);
  }

  u32() {
    if (this.remaining() < 4) throw new Error('underflow');
    const v = this.buf.readUInt32BE(this.pos);
    this.pos += 4;
    return v;
  }

  i32() {
    if (this.remaining() < 4) throw new Error('underflow');
    const v = this.buf.readInt32BE(this.pos);
    this.pos += 4;
    return v;
  }

  // quint64 — read as BigInt, return Number (safe for Hz values)
  u64() {
    if (this.remaining() < 8) throw new Error('underflow');
    const hi = this.buf.readUInt32BE(this.pos);
    const lo = this.buf.readUInt32BE(this.pos + 4);
    this.pos += 8;
    return hi * 0x100000000 + lo;
  }

  // qint64
  i64() {
    if (this.remaining() < 8) throw new Error('underflow');
    const hi = this.buf.readInt32BE(this.pos);
    const lo = this.buf.readUInt32BE(this.pos + 4);
    this.pos += 8;
    return hi * 0x100000000 + lo;
  }

  // Qt utf8 string: quint32 length (0xFFFFFFFF = null) + bytes
  utf8() {
    const len = this.u32();
    if (len === 0xFFFFFFFF) return null;
    if (this.remaining() < len) throw new Error('underflow');
    const s = this.buf.toString('utf8', this.pos, this.pos + len);
    this.pos += len;
    return s;
  }

  /**
   * Qt QDateTime (Qt 5+ QDataStream format):
   *   qint64  julianDay        (MIN_INT64 = null / invalid)
   *   quint32 msecsSinceStartOfDay
   *   quint8  timeSpec         0=local 1=UTC 2=OffsetFromUTC 3=TimeZone
   *   [qint32 utcOffset]       present when timeSpec==2
   *   [utf8   ianaId]          present when timeSpec==3
   * Returns a JS Date or null.
   */
  qdatetime() {
    const jd = this.i64();
    // MIN_INT64 sentinel for invalid/null datetime
    const MIN_INT64 = -9223372036854776000;
    if (jd === 0 || jd <= MIN_INT64 + 1e10) {
      // Skip remaining fields for null datetime: msecs(4) + spec(1)
      this.pos += 5;
      return null;
    }
    const msec = this.u32();
    const spec = this.u8();
    if (spec === 2) this.i32(); // utcOffset (ignore)
    if (spec === 3) this.utf8(); // IANA tz id (ignore)

    // Julian day to JS timestamp
    // Julian epoch: noon 1 Jan 4713 BC = -210866803200000 ms from Unix epoch
    // JD 2440588 = 1970-01-01
    const unixMs = (jd - 2440588) * 86400000 + msec;
    return new Date(unixMs);
  }
}

// ──────────────────────────────────────────
// Frequency → EzFD band
// ──────────────────────────────────────────

function hzToBand(hz) {
  const khz = hz / 1000;
  if (khz >= 1800  && khz < 2000)    return '160m';
  if (khz >= 3500  && khz < 4000)    return '80m';
  if (khz >= 7000  && khz < 7300)    return '40m';
  if (khz >= 14000 && khz < 14350)   return '20m';
  if (khz >= 21000 && khz < 21450)   return '15m';
  if (khz >= 28000 && khz < 29700)   return '10m';
  if (khz >= 50000 && khz < 54000)   return '6m';
  if (khz >= 144000 && khz < 148000) return '2m';
  if (khz >= 222000 && khz < 225000) return '1.25m';
  if (khz >= 420000 && khz < 450000) return '70cm';
  return null;
}

// ──────────────────────────────────────────
// Mode → EzFD mode
// ──────────────────────────────────────────

function wsjtxModeToEzfd(mode) {
  const m = (mode || '').toUpperCase().trim();
  if (m === 'CW') return 'CW';
  if (['SSB', 'USB', 'LSB', 'FM', 'AM'].includes(m)) return 'PH';
  return 'DIG'; // FT8, FT4, JS8, RTTY, MSK144, FST4, Q65, etc.
}

// ──────────────────────────────────────────
// Parse LOGGED_QSO (message type 5)
// ──────────────────────────────────────────

function parseLoggedQso(buf) {
  const r = new Reader(buf);

  const magic  = r.u32();
  if (magic !== MAGIC) return null;

  const schema = r.u32();
  const msgType = r.u32();
  if (msgType !== MSG_LOGGED_QSO) return null;

  r.utf8(); // ID (station identifier)

  r.qdatetime();        // off air date time (start time)
  const dxCall = r.utf8();  // DX callsign
  r.utf8();             // DX grid
  const freqHz = r.u64();   // TX frequency in Hz
  const mode   = r.utf8();  // Mode string
  r.utf8();             // Report sent
  r.utf8();             // Report received
  r.utf8();             // TX power
  r.utf8();             // Comments
  r.utf8();             // Name

  let dateOff = null;
  let operatorCall = OPERATOR || null;
  let exchangeSent = null;
  let exchangeRcvd = null;

  if (schema >= 2) {
    dateOff       = r.qdatetime(); // Date and time off
    operatorCall  = r.utf8() || OPERATOR || null; // Operator call
  }
  if (schema >= 3) {
    r.utf8();              // My call
    r.utf8();              // My grid
    exchangeSent = r.utf8(); // Exchange sent (e.g. "3A MN")
    exchangeRcvd = r.utf8(); // Exchange received (e.g. "2A CT")
    // ADIF Propagation mode follows but we don't need it
  }

  return { dxCall, freqHz, mode, dateOff, operatorCall, exchangeSent, exchangeRcvd };
}

// ──────────────────────────────────────────
// Parse Field Day exchange "2A MN" → { class, section }
// ──────────────────────────────────────────

function parseExchange(s) {
  if (!s) return { rcvd_class: '', rcvd_section: '' };
  const parts = s.trim().split(/\s+/);
  return {
    rcvd_class:   (parts[0] ?? '').toUpperCase(),
    rcvd_section: (parts[1] ?? '').toUpperCase(),
  };
}

// ──────────────────────────────────────────
// POST QSO to EzFD
// ──────────────────────────────────────────

async function postQso(qso) {
  const url = `${API_URL}/api/qso`;
  const body = JSON.stringify(qso);

  const lib = url.startsWith('https') ? https : http;

  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const req = lib.request({
      hostname: urlObj.hostname,
      port:     urlObj.port || (url.startsWith('https') ? 443 : 80),
      path:     urlObj.pathname,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

// ──────────────────────────────────────────
// Offline spool
// ──────────────────────────────────────────
//
// WSJT-X keeps logging whether or not EzFD is reachable, so a server restart,
// an nginx reload or a brief 502 used to mean the contact was simply never
// posted: the bridge printed "network error" and moved on. WSJT-X's own
// wsjtx_log.adi made it *recoverable* by a manual ADIF import, but only if
// somebody noticed — the two logs diverged silently until then.
//
// So a contact the server didn't take goes to a file, and a timer retries it.
// Same shape as the browser's offline queue (lib/useQsoQueue.ts): the payload
// is written before it can be lost, dropped only once the server has actually
// accepted it, and retried with a backoff so a contact that can never be
// accepted doesn't spin forever.

const SPOOL_RETRY_MS = [5_000, 10_000, 30_000, 60_000, 120_000];
let spoolAttempt = 0;
let spoolTimer   = null;
let draining     = false;

function readSpool() {
  try {
    return fs.readFileSync(SPOOL, 'utf8')
      .split('\n').filter(Boolean)
      .map(line => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean);
  } catch {
    return [];   // no spool file yet
  }
}

function writeSpool(entries) {
  try {
    fs.mkdirSync(path.dirname(SPOOL), { recursive: true });
    fs.writeFileSync(SPOOL, entries.map(e => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : ''));
  } catch (err) {
    console.error(`[wsjtx-bridge] Could not write the spool at ${SPOOL}: ${err.message}`);
    console.error('[wsjtx-bridge] Contacts will not survive a restart. Set --spool to a writable path.');
  }
}

function spoolAdd(qso) {
  const entries = readSpool();
  entries.push(qso);
  writeSpool(entries);
  return entries.length;
}

/** Whether a response means "try again later" rather than "never going to
 *  work". A 4xx is the server saying no on purpose — a missing field, an
 *  event that doesn't exist — and retrying it forever helps nobody. Anything
 *  else (no response at all, a timeout, a 5xx) is worth another attempt. */
function isRetryable(status) {
  return !(status >= 400 && status < 500);
}

/** Drain the spool oldest-first, stopping at the first one the server won't
 *  take so the log keeps its order. Contacts go back with replay=true, which
 *  the server accepts unconditionally: by the time this runs the SES band/mode
 *  slot has expired, and a contact that already happened on the air must not
 *  be refused because the network blipped. */
async function drainSpool() {
  if (draining) return false;
  const entries = readSpool();
  if (entries.length === 0) return false;
  draining = true;
  let sent = 0;
  try {
    while (entries.length > 0) {
      const qso = entries[0];
      let status;
      try {
        ({ status } = await postQso({ ...qso, replay: true }));
      } catch {
        break;                       // still unreachable
      }
      if (status !== 201 && isRetryable(status)) break;
      // A permanent rejection is dropped rather than retried forever — it is
      // still in WSJT-X's own log if it needs chasing.
      if (status !== 201) {
        console.log(`[wsjtx-bridge] ${qso.callsign} permanently rejected (${status}) — dropped from the queue`);
      }
      entries.shift();
      sent++;
      writeSpool(entries);
    }
  } finally {
    draining = false;
  }
  if (sent > 0) {
    console.log(`[wsjtx-bridge] Synced ${sent} queued contact(s); ${entries.length} still waiting.`);
  }
  return sent > 0;
}

/** Keep a retry pending for as long as anything is queued. Reschedules itself
 *  rather than running on a fixed interval, so progress can reset the delay
 *  and a hopeless queue backs off instead of hammering. */
function scheduleDrain() {
  if (spoolTimer) return;
  const delay = SPOOL_RETRY_MS[Math.min(spoolAttempt, SPOOL_RETRY_MS.length - 1)];
  spoolTimer = setTimeout(async () => {
    spoolTimer = null;
    const progressed = await drainSpool();
    spoolAttempt = progressed ? 0 : spoolAttempt + 1;
    if (readSpool().length > 0) scheduleDrain();
  }, delay);
  spoolTimer.unref?.();
}

// ──────────────────────────────────────────
// Main
// ──────────────────────────────────────────

const sock = dgram.createSocket('udp4');

sock.on('message', async (msg) => {
  let parsed;
  try {
    parsed = parseLoggedQso(msg);
  } catch {
    // Not a LOGGED_QSO or corrupt packet — ignore silently
    return;
  }
  if (!parsed) return;

  const { dxCall, freqHz, mode, dateOff, operatorCall, exchangeRcvd } = parsed;

  if (!dxCall) {
    console.warn('[wsjtx-bridge] Received LOGGED_QSO with no callsign, skipping.');
    return;
  }

  const band = hzToBand(freqHz);
  if (!band) {
    console.warn(`[wsjtx-bridge] Unknown band for ${freqHz} Hz — skipping ${dxCall}`);
    return;
  }

  const ezfdMode = wsjtxModeToEzfd(mode);
  const { rcvd_class, rcvd_section } = parseExchange(exchangeRcvd);

  const payload = {
    event_id:       EVENT_ID,
    callsign:       dxCall,
    band,
    mode:           ezfdMode,
    rcvd_class,
    rcvd_section,
    operator_call:  operatorCall || undefined,
    station_number: STATION,
  };

  const ts = (dateOff ?? new Date()).toISOString().slice(11, 19);
  process.stdout.write(`[${ts}] ${dxCall.padEnd(12)} ${band.padEnd(6)} ${ezfdMode} `);

  // Anything already waiting goes first, so the log keeps the order the
  // contacts were made in rather than interleaving a live one ahead of them.
  if (readSpool().length > 0) {
    await drainSpool();
  }

  try {
    const { status, body } = await postQso(payload);
    if (status === 201) {
      const dupe = body.is_dupe ? ' [DUPE]' : '';
      console.log(`→ logged${dupe}`);
    } else if (isRetryable(status)) {
      const depth = spoolAdd(payload);
      console.log(`→ server error ${status} — queued (${depth} waiting)`);
      scheduleDrain();
    } else {
      // The server said no on purpose. Retrying will not change its mind, and
      // the contact is still in WSJT-X's own log.
      console.log(`→ rejected ${status}: ${body?.error ?? JSON.stringify(body)}`);
    }
  } catch (err) {
    const depth = spoolAdd(payload);
    console.log(`→ ${err.message} — queued (${depth} waiting)`);
    scheduleDrain();
  }
});

sock.on('error', (err) => {
  console.error(`[wsjtx-bridge] Socket error: ${err.message}`);
  process.exit(1);
});

sock.bind(UDP_PORT, '0.0.0.0', () => {
  const banner = [
    '╔══════════════════════════════════════╗',
    '║  EzFD ↔ WSJT-X / JTDX UDP Bridge   ║',
    '╚══════════════════════════════════════╝',
  ].join('\n');
  console.log(banner);
  console.log(`Listening on UDP port ${UDP_PORT}`);
  console.log(`Event:    ${EVENT_ID}`);
  console.log(`API:      ${API_URL}`);
  console.log(`Operator: ${OPERATOR || '(from WSJT-X)'}`);
  console.log(`Station:  ${STATION}`);
  console.log(`Queue:    ${SPOOL}`);

  // A queue left over from a previous run is still owed to the server —
  // contacts made just before the bridge was closed, or while it was down.
  const waiting = readSpool().length;
  if (waiting > 0) {
    console.log(`\n${waiting} contact(s) queued from an earlier run — syncing…`);
    drainSpool().then(() => {
      if (readSpool().length > 0) scheduleDrain();
    });
  }
  console.log('Waiting for LOGGED_QSO messages…\n');
});
