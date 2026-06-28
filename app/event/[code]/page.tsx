'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { Event } from '@/lib/types';

export default function EventJoinPage() {
  const params = useParams();
  const router = useRouter();
  const code = (params.code as string).toUpperCase();

  const [event, setEvent] = useState<Event | null>(null);
  const [opCall, setOpCall] = useState('');
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    fetch(`/api/events/${code}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) { setNotFound(true); setLoading(false); return; }
        setEvent(data);
        setLoading(false);

        // If already joined, go straight to log
        const saved = sessionStorage.getItem(`ezfd_op_${code}`);
        if (saved) {
          const { call } = JSON.parse(saved);
          if (call) router.replace(`/event/${code}/log?op=${call}`);
        }
      });
  }, [code, router]);

  function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    const call = opCall.toUpperCase().trim();
    if (!call) return;
    sessionStorage.setItem(`ezfd_op_${code}`, JSON.stringify({ call }));
    router.push(`/event/${code}/log?op=${call}`);
  }

  if (loading) return <div className="flex min-h-screen items-center justify-center text-zinc-400">Loading...</div>;
  if (notFound) return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <p className="text-xl font-semibold text-red-400">Event not found</p>
      <p className="text-zinc-400">Code <span className="font-mono text-zinc-200">{code}</span> doesn&apos;t match any active event.</p>
      <a href="/" className="text-amber-400 underline">Go back home</a>
    </div>
  );
  if (!event) return null;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <p className="text-sm font-mono text-amber-400 tracking-widest">{code}</p>
          <h1 className="mt-1 text-2xl font-bold text-zinc-100">{event.club_name}</h1>
          <p className="text-zinc-400">{event.club_call} &bull; {event.class} &bull; {event.arrl_section}</p>
          {event.location && <p className="mt-1 text-sm text-zinc-500">{event.location}</p>}
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
          <h2 className="mb-4 font-semibold text-zinc-200">Sign In as Operator</h2>
          <form onSubmit={handleJoin} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-sm text-zinc-400">Your Callsign</span>
              <input
                required
                value={opCall}
                onChange={e => setOpCall(e.target.value.toUpperCase())}
                placeholder="W0NY"
                className="input font-mono text-lg tracking-widest"
                autoFocus
              />
            </label>
            <button
              type="submit"
              className="mt-2 rounded-lg bg-amber-400 py-2 font-semibold text-zinc-900 hover:bg-amber-300"
            >
              Enter Logger
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
