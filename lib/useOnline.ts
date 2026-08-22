'use client';

import { useSyncExternalStore } from 'react';

/**
 * Whether the browser currently has network connectivity.
 *
 * This drives the offline queue banner, so it needs to be right on the first
 * render — reading `navigator.onLine` in an effect meant an operator who
 * loaded the page already offline saw "online" until the effect ran.
 */
function subscribe(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

const getSnapshot = () => navigator.onLine;

// No navigator on the server. Assume online: the offline banner is the
// exception, and rendering it during SSR would flash it on every page load.
const getServerSnapshot = () => true;

export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
