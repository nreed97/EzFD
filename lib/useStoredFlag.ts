'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * A boolean preference kept in `localStorage`.
 *
 * Night mode, Quick Log and the CW window's ESM toggle are all per-browser
 * preferences rather than per-event settings, so they're read and written
 * straight to storage. Each used to do that by reading in an effect and
 * calling `setState`, which renders once with the default and then corrects
 * itself — a visible flicker of the wrong toggle state, and what
 * `react-hooks/set-state-in-effect` objects to.
 *
 * `useSyncExternalStore` is the right shape for this: storage is mutable state
 * owned outside React. It renders the fallback during SSR and on the hydration
 * pass, then the stored value immediately after, with no mismatch warning and
 * no effect.
 *
 * Subscribing also buys something the old code didn't have: the CW keying
 * window is a separate `window.open` document, so a preference changed in one
 * window now follows in the other instead of the two drifting apart.
 */
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

/** Module-level so the identity is stable — React resubscribes otherwise. */
function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // `storage` fires only in *other* documents, which is exactly what the
  // same-document `notify()` below covers.
  window.addEventListener('storage', onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onChange);
  };
}

function read(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : raw === '1';
  } catch {
    // Private mode, or storage disabled. The preference just doesn't persist.
    return fallback;
  }
}

export function useStoredFlag(
  key: string,
  fallback = false,
): [boolean, (next: boolean | ((prev: boolean) => boolean)) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => read(key, fallback),
    () => fallback,
  );

  const setValue = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      // Read through to storage rather than closing over `value`, so a
      // functional update is never applied to a stale snapshot.
      const resolved = typeof next === 'function' ? next(read(key, fallback)) : next;
      try {
        localStorage.setItem(key, resolved ? '1' : '0');
      } catch { /* not persistable; the notify below still updates this tab */ }
      notify();
    },
    [key, fallback],
  );

  return [value, setValue];
}
