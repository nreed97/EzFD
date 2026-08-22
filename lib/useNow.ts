'use client';

import { useState, useEffect } from 'react';

/**
 * A clock value that ticks, for components that show "is this happening now".
 *
 * Reading `Date.now()` during render makes the render non-idempotent — React
 * can render the same component twice and get two different answers — which
 * is what `react-hooks/purity` objects to. It is also a correctness problem
 * in its own right, and the more interesting one: a component that computes
 * "this reservation is active" from the clock at render time only updates
 * that answer when something *else* re-renders it. A slot could sit on screen
 * marked active for minutes after it expired, purely because nothing happened
 * to trigger a render.
 *
 * Taking the time from state fixes both: render is pure, and the display
 * actually keeps up with the clock.
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
