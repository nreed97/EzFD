import { parseStringPromise } from 'xml2js';
import { getPool } from './db';
import { decryptField } from './crypto';
import type { QRZLookup } from './types';

const QRZ_BASE = 'https://xmldata.qrz.com/xml/current/';

/** A lookup runs while an operator waits on the entry form, so it gives up
 *  quickly; the call history download carries the same kind of timeout. */
const QRZ_TIMEOUT_MS = 5_000;

/** Two operators typing the same call, or one re-typing it, should not each
 *  spend a QRZ lookup. Per event, since each event uses its own account. */
const CACHE_MS = 30 * 60_000;
const CACHE_MAX = 2_000;
const cache = new Map<string, { at: number; value: QRZLookup }>();

async function fetchXml(url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(QRZ_TIMEOUT_MS) });
  return parseStringPromise(await res.text());
}

async function fetchQRZSession(username: string, password: string): Promise<string> {
  const url = `${QRZ_BASE}?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&agent=EzFD-1.0`;
  const parsed = await fetchXml(url);
  const session = parsed?.QRZDatabase?.Session?.[0];
  if (session?.Error) throw new Error(session.Error[0]);
  const key = session?.Key?.[0];
  if (!key) throw new Error('No session key returned from QRZ');
  return key;
}

export async function lookupCallsign(eventId: string, callsign: string): Promise<QRZLookup> {
  const call = callsign.toUpperCase();
  const key = `${eventId}|${call}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const pool = getPool();

  const { rows } = await pool.query(
    'SELECT qrz_username, qrz_password, qrz_session_key, qrz_session_expires FROM events WHERE id=$1',
    [eventId]
  );
  const event = rows[0];

  if (!event?.qrz_username || !event?.qrz_password) {
    return { callsign, name: null, state: null, country: null, grid: null };
  }

  const password = decryptField(event.qrz_password);

  async function newSession(): Promise<string> {
    const key = await fetchQRZSession(event.qrz_username, password);
    const expires = new Date(Date.now() + 50 * 60 * 1000);
    await pool.query(
      'UPDATE events SET qrz_session_key=$1, qrz_session_expires=$2 WHERE id=$3',
      [key, expires.toISOString(), eventId]
    );
    return key;
  }

  let sessionKey = event.qrz_session_key;
  const expires = event.qrz_session_expires ? new Date(event.qrz_session_expires) : null;
  if (!sessionKey || !expires || expires <= new Date()) sessionKey = await newSession();

  const lookup = (s: string) =>
    fetchXml(`${QRZ_BASE}?s=${encodeURIComponent(s)}&callsign=${encodeURIComponent(call)}`);
  let parsed = await lookup(sessionKey);

  // QRZ ends a session early when the same account signs in elsewhere, and
  // says so with a Session element carrying an Error and no Key. Trusting our
  // own 50-minute expiry instead meant every lookup came back empty, silently,
  // until that expiry passed. "Not found" is also reported as an Error, but
  // alongside a still-valid Key, so it does not trigger a new session.
  const session = parsed?.QRZDatabase?.Session?.[0];
  if (session?.Error && !session?.Key) {
    parsed = await lookup(await newSession());
  }

  const rec = parsed?.QRZDatabase?.Callsign?.[0];
  if (!rec) return { callsign, name: null, state: null, country: null, grid: null };

  const fname = rec.fname?.[0] ?? '';
  const lname = rec.name?.[0] ?? '';
  const name = [fname, lname].filter(Boolean).join(' ') || null;

  const value: QRZLookup = {
    callsign: call,
    name,
    state: rec.state?.[0] ?? null,
    country: rec.country?.[0] ?? null,
    grid: rec.grid?.[0] ?? null,
  };
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, { at: Date.now(), value });
  return value;
}
