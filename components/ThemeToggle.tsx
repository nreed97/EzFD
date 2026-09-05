'use client';

import { useLightMode, toggleLightMode } from '@/lib/useLightMode';

export default function ThemeToggle() {
  // The class on <html> is the source of truth, not a copy of it in state:
  // an inline script sets it before first paint to avoid a flash, so mirroring
  // it into state meant rendering the wrong label once and then correcting.
  const light = useLightMode();

  return (
    <button
      onClick={toggleLightMode}
      title={light ? 'Switch to dark mode' : 'Switch to light mode'}
      className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-400 transition-colors hover:bg-zinc-800 light:border-zinc-300 light:text-zinc-600 light:hover:bg-zinc-100"
    >
      {light ? 'Dark' : 'Light'}
    </button>
  );
}
