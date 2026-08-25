'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * A JSON-serialisable preference kept in `localStorage`.
 *
 * The sibling of `useStoredFlag`, which only holds a boolean. Column choices
 * and filter state are per-browser preferences — the operator projecting the
 * log on a wall wants different columns from the one checking their own
 * contacts, on the same event — so they belong in storage rather than in the
 * database with the event.
 *
 * Same `useSyncExternalStore` shape and the same reason: reading storage in an
 * effect renders the default once and then corrects itself, which is a visible
 * flicker of the wrong columns.
 *
 * The one thing this needs that the boolean version doesn't is a **snapshot
 * cache**. `getSnapshot` must return a referentially stable value while the
 * underlying store hasn't changed; parsing JSON afresh on every call returns a
 * new object each time, which React reads as a perpetual change and turns into
 * an infinite render loop. So the parse is memoised against the raw string it
 * came from, and only re-runs when that string actually differs.
 */

const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

/** Module-level so the identity is stable — React resubscribes otherwise. */
function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // `storage` fires only in *other* documents; same-document writes go through
  // notify() below. The CW popout is a separate document, so both matter.
  window.addEventListener('storage', onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onChange);
  };
}

/** Per key: the raw string last parsed, and what it parsed to. */
const cache = new Map<string, { raw: string | null; value: unknown }>();

function read<T>(key: string, fallback: T): T {
  let raw: string | null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    // Private mode, or storage disabled. The preference just doesn't persist.
    return fallback;
  }

  const hit = cache.get(key);
  if (hit && hit.raw === raw) return hit.value as T;

  let value: T = fallback;
  if (raw !== null) {
    try {
      value = JSON.parse(raw) as T;
    } catch {
      // Corrupt or hand-edited. Fall back rather than throwing during render.
      value = fallback;
    }
  }
  cache.set(key, { raw, value });
  return value;
}

export function useStoredJson<T>(
  key: string,
  fallback: T,
): [T, (next: T | ((prev: T) => T)) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => read(key, fallback),
    () => fallback,   // server render and the hydration pass
  );

  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => {
      // Read through to storage rather than closing over `value`, so a
      // functional update is never applied to a stale snapshot.
      const resolved =
        typeof next === 'function' ? (next as (prev: T) => T)(read(key, fallback)) : next;
      try {
        const raw = JSON.stringify(resolved);
        localStorage.setItem(key, raw);
        cache.set(key, { raw, value: resolved });
      } catch {
        // Not persistable. Keep the in-memory snapshot so this tab still
        // reflects the change, with a raw that can't match a real read.
        cache.set(key, { raw: Symbol.for('unpersisted') as unknown as string, value: resolved });
      }
      notify();
    },
    [key, fallback],
  );

  return [value, setValue];
}
