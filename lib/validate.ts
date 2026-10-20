import { NextResponse } from 'next/server';
import { BAND_ORDER, MODES } from './bands';
import type { Band, Mode } from './types';

/**
 * Request validation shared by the API routes.
 *
 * The routes used to pass whatever arrived straight to PostgreSQL, so a bad
 * value surfaced as the database's own error: a mode outside PH/CW/DIG hit the
 * CHECK constraint, a non-UUID id hit the uuid cast, a numeric callsign threw
 * in `toUpperCase()`. Each of those was a 500, and the offline queue retries a
 * 500 — so a contact that could never be accepted sat at the head of the queue
 * retrying every minute, holding back every contact queued behind it.
 *
 * A refusal is a 400 now, which the queue and the WSJT-X bridge both treat as
 * final. Free text is trimmed to a length rather than refused: a comment that
 * is too long is not a reason to lose the contact it is attached to.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function isBand(value: unknown): value is Band {
  return typeof value === 'string' && (BAND_ORDER as string[]).includes(value);
}

export function isMode(value: unknown): value is Mode {
  return typeof value === 'string' && (MODES as string[]).includes(value);
}

/** Callsigns, including portable and slash forms (N0CALL/7, VE3/N0CALL/P). */
const CALL_RE = /^[A-Z0-9]{1,8}(\/[A-Z0-9]{1,8}){0,2}$/;

/** The callsign as stored, or null if it is not one. */
export function callsign(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const call = value.toUpperCase().trim();
  return CALL_RE.test(call) ? call : null;
}

/** Longest free-text value kept. Well above anything an operator types, and
 *  far enough under PostgreSQL's 8,000-byte NOTIFY limit that a whole row,
 *  every field at its cap, still fits in one notification. */
export const TEXT_MAX = 500;

/** Trimmed, upper-cased if asked, cut to `max`; null when empty or not text. */
export function text(value: unknown, { upper = false, max = TEXT_MAX } = {}): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  let s = String(value).trim();
  if (upper) s = s.toUpperCase();
  return s ? s.slice(0, max) : null;
}

/** A 400 with the reason, in the shape every route already returns errors. */
export function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

/** The request body as an object, or null when it is not JSON. */
export async function jsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}
