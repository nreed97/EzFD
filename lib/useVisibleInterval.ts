'use client';

import { useEffect, useRef } from 'react';

/**
 * `setInterval` that only runs while the page is visible, and catches up the
 * moment it is visible again.
 *
 * For the polls that *read* shared state — presence, claims — and that the
 * real-time stream already pushes changes for, so the poll is only a sweep for
 * what no event announces (a window that closed without a QRT). A logging
 * window left in a background tab all weekend used to poll every 15 seconds
 * for a screen nobody was looking at.
 *
 * Never use it for anything that *publishes*: a logger in a background tab is
 * still on the air, and its presence heartbeat must keep going.
 *
 * `fn` is read through a ref, so passing an inline function does not restart
 * the timer on every render (see the auto-CQ note in AGENTS.md).
 */
export function useVisibleInterval(fn: () => void, ms: number) {
  const ref = useRef(fn);
  useEffect(() => { ref.current = fn; }, [fn]);

  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null;
    const start = () => { if (id === null) id = setInterval(() => ref.current(), ms); };
    const stop = () => { if (id !== null) { clearInterval(id); id = null; } };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        ref.current();
        start();
      } else {
        stop();
      }
    };
    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [ms]);
}
