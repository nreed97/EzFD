'use client';

import { useSyncExternalStore } from 'react';

/**
 * Whether the page is currently in light mode.
 *
 * Dark is this app's default; light is opted into by a `light` class on the
 * root element, which `ThemeToggle` sets and a small inline script restores on
 * load. That makes it a value owned outside React, mutated imperatively — the
 * exact thing `useSyncExternalStore` exists for.
 *
 * The alternative (read it in an effect and `setState`) renders once with the
 * wrong answer and then corrects itself, which is both a visible flash and the
 * `react-hooks/set-state-in-effect` complaint. Subscribing gets it right on
 * the first client render and keeps it right when the class changes, without
 * every consumer wiring up its own MutationObserver.
 */
function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  });
  return () => observer.disconnect();
}

const getSnapshot = () => document.documentElement.classList.contains('light');

// There is no DOM on the server, and dark is the default, so SSR renders dark.
const getServerSnapshot = () => false;

export function useLightMode(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Flip the theme.
 *
 * Lives here rather than inside `ThemeToggle` because the nav drawer offers
 * the same switch, and two copies of "what light mode means" is the drift this
 * whole change is about. The root class is the source of truth; the stored
 * preference is what the inline boot script reads back.
 */
export function toggleLightMode(): void {
  const root = document.documentElement;
  const next = !root.classList.contains('light');
  root.classList.toggle('light', next);
  try {
    localStorage.setItem('ezfd_theme', next ? 'light' : 'dark');
  } catch {
    // A browser with site data blocked still gets the switch, just not the
    // memory of it — losing the preference is better than losing the toggle.
  }
}
