'use client';

import { useEffect, useState } from 'react';

export default function ThemeToggle() {
  const [light, setLight] = useState(false);

  useEffect(() => {
    setLight(document.documentElement.classList.contains('light'));
  }, []);

  function toggle() {
    const next = !light;
    setLight(next);
    if (next) {
      document.documentElement.classList.add('light');
      localStorage.setItem('ezfd_theme', 'light');
    } else {
      document.documentElement.classList.remove('light');
      localStorage.setItem('ezfd_theme', 'dark');
    }
  }

  return (
    <button
      onClick={toggle}
      title={light ? 'Switch to dark mode' : 'Switch to light mode'}
      className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-400 transition-colors hover:bg-zinc-800 light:border-zinc-300 light:text-zinc-600 light:hover:bg-zinc-100"
    >
      {light ? 'Dark' : 'Light'}
    </button>
  );
}
