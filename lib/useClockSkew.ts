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

    const check = async () => {
      try {
        const t0 = Date.now();
        const res = await fetch('/api/time', { cache: 'no-store' });
        const t1 = Date.now();
        if (!res.ok) return;
        const { app_time, db_time } = await res.json();

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

        if (cancelled) return;
        setSkew({
          skewMs,
          significant: Math.abs(skewMs) > CLOCK_SKEW_THRESHOLD_MS,
          dbDisagrees:
            Number.isFinite(dbMs) && Math.abs(dbMs - appMs) > CLOCK_SKEW_THRESHOLD_MS,
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
