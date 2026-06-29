'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import ThemeToggle from '@/components/ThemeToggle';

export default function HomePage() {
  const router = useRouter();
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    const code = joinCode.toUpperCase().trim();
    if (!code) return;
    setLoading(true);
    setError('');

    const res = await fetch(`/api/events/${code}`);
    if (!res.ok) {
      setError('Event not found. Check your join code and try again.');
      setLoading(false);
      return;
    }
    router.push(`/event/${code}`);
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-12 p-8">
      <div className="text-center">
        <h1 className="text-5xl font-bold tracking-tight text-amber-400">EzFD</h1>
        <p className="mt-2 text-zinc-400">Real-time Field Day logging for amateur radio clubs</p>
      </div>

      <div className="flex w-full max-w-md flex-col gap-6">
        {/* Join existing event */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 light:border-zinc-200 light:bg-zinc-50">
          <h2 className="mb-4 text-lg font-semibold text-zinc-100 light:text-zinc-900">Join an Event</h2>
          <form onSubmit={handleJoin} className="flex flex-col gap-3">
            <input
              type="text"
              value={joinCode}
              onChange={e => setJoinCode(e.target.value.toUpperCase())}
              placeholder="Join code (e.g. ABC123)"
              maxLength={6}
              className="input font-mono text-lg tracking-widest"
              autoComplete="off"
              spellCheck={false}
            />
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button
              type="submit"
              disabled={loading || joinCode.length < 6}
              className="rounded-lg bg-amber-400 px-4 py-2 font-semibold text-zinc-900 transition-colors hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Looking up...' : 'Join Event'}
            </button>
          </form>
        </div>

        {/* Create new event */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 light:border-zinc-200 light:bg-zinc-50">
          <h2 className="mb-2 text-lg font-semibold text-zinc-100 light:text-zinc-900">Start a New Event</h2>
          <p className="mb-4 text-sm text-zinc-400 light:text-zinc-600">Set up a Field Day log for your club. You&apos;ll get a join code to share with your operators.</p>
          <Link
            href="/event/new"
            className="block w-full rounded-lg border border-amber-400 px-4 py-2 text-center font-semibold text-amber-400 transition-colors hover:bg-amber-400 hover:text-zinc-900"
          >
            Create Event
          </Link>
        </div>
      </div>

      <footer className="flex items-center justify-center gap-4 text-xs text-zinc-600 light:text-zinc-400">
        <span>73 de EzFD &bull; Open source Field Day logger</span>
        <a
          href="https://github.com/nreed97/EzFD"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-zinc-300 light:hover:text-zinc-700 transition-colors"
          aria-label="View source on GitHub"
        >
          GitHub
        </a>
        <ThemeToggle />
      </footer>
    </main>
  );
}
