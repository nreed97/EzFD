'use client';

import { useState, useEffect } from 'react';

/** Below this, a difference is latency and clock jitter, not a broken clock. */
export const CLOCK_SKEW_THRESHOLD_MS = 60_000;

/** Re-check periodically: a field server's clock can jump when connectivity
 *  is briefly restored and NTP steps it, which is exactly when the operator
 *  most needs to know the earlier contacts were logged against a bad clock. */
const RECHECK_MS = 5 * 60_000;

export interface ClockSkew {
  /** Server clock minus this device's clock. Positive = server is ahead. */
  skewMs: number;
  /** Whether the skew is large enough to be worth showing. */
  significant: boolean;
  /** True when the app process and PostgreSQL disagree with each other, which
   *  points at the two being on different hosts with different clocks. */
  dbDisagrees: boolean;
  /** What the other connected devices make of the server, when enough of them
   *  are present to make it a verdict rather than a disagreement. */
  quorum: {
    devices: number;
    agreeing: number;
    medianSkewMs: number | null;
    serverIsWrong: boolean;
  } | null;
  /** What the server says is holding its own clock, and for how long it has
   *  been going unattended. Null fields mean nothing could tell — which is
   *  never rendered as a warning. */
  clock: {
    source: string | null;
    synchronized: boolean | null;
    ageMs: number | null;
    stale: boolean;
    unaccountedFor: boolean;
    rtc: boolean | null;
  } | null;
}

/**
 * Identifies this device to the server so its opinion counts once.
 *
 * Per-device rather than per-window: the CW popout is a second document on the
 * same machine with the same clock, and counting it separately would let one
 * operator with two windows open carry twice the weight in the quorum.
 *
 * `localStorage` and `crypto.getRandomValues` are both available on a plain
 * HTTP origin, which `crypto.randomUUID` is not — the field servers this most
 * matters for have no TLS. Same reason the offline queue generates its ids the
 * long way.
 */
const DEVICE_ID_KEY = 'ezfd.deviceId';

function deviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const id = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  } catch {
    // Private mode, or storage disabled. A per-session id still lets this
    // device count once for as long as the tab is open.
    return `ephemeral-${Math.random().toString(16).slice(2)}`;
  }
}

/**
 * Compares the server's clock against this device's.
 *
 * The server stays authoritative for QSO timestamps — multi-operator logs need
 * one clock, and trusting each browser would trade a visible, fixable problem
 * for an invisible one where operators disagree with each other. This only
 * detects the disagreement so it can be surfaced.
 *
 * Round-trip time is halved and added back, so a slow link doesn't read as
 * skew. That is also why this is its own request rather than a timestamp
 * riding along on each QSO: the QSO path has no way to separate network
 * latency from a wrong clock, and would pay for the check on every contact.
 */
export function useClockSkew(enabled = true): ClockSkew | null {
  const [skew, setSkew] = useState<ClockSkew | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    // The first request only reads; every later one also reports what the
    // previous round measured. Reporting a skew before having measured one
    // would put a zero into the quorum from every device that just loaded.
    let lastSkewMs: number | null = null;

    const check = async () => {
      try {
        const t0 = Date.now();
        const res = lastSkewMs === null
          ? await fetch('/api/time', { cache: 'no-store' })
          : await fetch('/api/time', {
              method: 'POST',
              cache: 'no-store',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ skew_ms: lastSkewMs, device_id: deviceId() }),
            });
        const t1 = Date.now();
        if (!res.ok) return;
        const { app_time, db_time, quorum, clock } = await res.json();

        const appMs = Date.parse(app_time);
        if (!Number.isFinite(appMs)) return;

        // The QSO timestamp comes from the database, so prefer its clock when
        // we have it and fall back to the app's.
        const dbMs = db_time ? Date.parse(db_time) : NaN;
        const serverMs = Number.isFinite(dbMs) ? dbMs : appMs;

        // The response was produced somewhere between t0 and t1; assume the
        // midpoint. Halving the round trip keeps a slow or congested link from
        // reading as a clock difference.
        const localAtServerRead = t0 + (t1 - t0) / 2;
        const skewMs = serverMs - localAtServerRead;

        lastSkewMs = skewMs;

        if (cancelled) return;
        setSkew({
          skewMs,
          significant: Math.abs(skewMs) > CLOCK_SKEW_THRESHOLD_MS,
          dbDisagrees:
            Number.isFinite(dbMs) && Math.abs(dbMs - appMs) > CLOCK_SKEW_THRESHOLD_MS,
          quorum: quorum
            ? {
                devices: quorum.devices,
                agreeing: quorum.agreeing,
                medianSkewMs: quorum.median_skew_ms,
                serverIsWrong: Boolean(quorum.server_is_wrong),
              }
            : null,
          clock: clock
            ? {
                source: clock.source ?? null,
                synchronized: clock.synchronized ?? null,
                ageMs: clock.age_ms ?? null,
                stale: Boolean(clock.stale),
                unaccountedFor: Boolean(clock.unaccounted_for),
                rtc: clock.rtc ?? null,
              }
            : null,
        });
      } catch {
        // Offline or the endpoint is unreachable. Say nothing rather than
        // reporting a skew we couldn't measure.
      }
    };

    check();
    const id = setInterval(check, RECHECK_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [enabled]);

  return skew;
}

/** "3 minutes", "2 hours", "4 days" — the magnitude, without a sign. */
export function formatSkew(skewMs: number): string {
  const s = Math.round(Math.abs(skewMs) / 1000);
  if (s < 120)      return `${s} seconds`;
  const m = Math.round(s / 60);
  if (m < 120)      return `${m} minutes`;
  const h = Math.round(m / 60);
  if (h < 48)       return `${h} hours`;
  return `${Math.round(h / 24)} days`;
}
