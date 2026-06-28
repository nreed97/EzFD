import { parseStringPromise } from 'xml2js';
import { createServiceClient } from './supabase-server';
import type { QRZLookup } from './types';

const QRZ_BASE = 'https://xmldata.qrz.com/xml/current/';

async function fetchQRZSession(username: string, password: string): Promise<string> {
  const url = `${QRZ_BASE}?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&agent=EzFD-1.0`;
  const res = await fetch(url);
  const xml = await res.text();
  const parsed = await parseStringPromise(xml);
  const session = parsed?.QRZDatabase?.Session?.[0];
  if (session?.Error) throw new Error(session.Error[0]);
  const key = session?.Key?.[0];
  if (!key) throw new Error('No session key returned from QRZ');
  return key;
}

export async function lookupCallsign(eventId: string, callsign: string): Promise<QRZLookup> {
  const supabase = createServiceClient();

  const { data: event } = await supabase
    .from('events')
    .select('qrz_username, qrz_password, qrz_session_key, qrz_session_expires')
    .eq('id', eventId)
    .single();

  if (!event?.qrz_username || !event?.qrz_password) {
    return { callsign, name: null, state: null, country: null, grid: null };
  }

  let sessionKey = event.qrz_session_key;
  const now = new Date();
  const expires = event.qrz_session_expires ? new Date(event.qrz_session_expires) : null;

  if (!sessionKey || !expires || expires <= now) {
    sessionKey = await fetchQRZSession(event.qrz_username, event.qrz_password);
    const newExpires = new Date(now.getTime() + 50 * 60 * 1000); // 50 min
    await supabase
      .from('events')
      .update({ qrz_session_key: sessionKey, qrz_session_expires: newExpires.toISOString() })
      .eq('id', eventId);
  }

  const url = `${QRZ_BASE}?s=${encodeURIComponent(sessionKey)}&callsign=${encodeURIComponent(callsign.toUpperCase())}`;
  const res = await fetch(url);
  const xml = await res.text();
  const parsed = await parseStringPromise(xml);

  const rec = parsed?.QRZDatabase?.Callsign?.[0];
  if (!rec) return { callsign, name: null, state: null, country: null, grid: null };

  const fname = rec.fname?.[0] ?? '';
  const lname = rec.name?.[0] ?? '';
  const name = [fname, lname].filter(Boolean).join(' ') || null;

  return {
    callsign: callsign.toUpperCase(),
    name,
    state: rec.state?.[0] ?? null,
    country: rec.country?.[0] ?? null,
    grid: rec.grid?.[0] ?? null,
  };
}
