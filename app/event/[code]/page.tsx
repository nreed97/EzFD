'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { eventTypeLabel } from '@/lib/types';
import type { Event } from '@/lib/types';

export default function EventJoinPage() {
  const params = useParams();
  const router = useRouter();
  const code = (params.code as string).toUpperCase();

  const [event, setEvent] = useState<Event | null>(null);
  const [opCall, setOpCall] = useState('');
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  // A distributed special event station has one location per operator, and
  // these feed the ADIF MY_* fields for that operator's own contacts.
  const [opGrid, setOpGrid] = useState('');
  const [opState, setOpState] = useState('');

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

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    const call = opCall.toUpperCase().trim();
    if (!call) return;
    sessionStorage.setItem(`ezfd_op_${code}`, JSON.stringify({ call }));

    // Best effort — a failed roster save must never block an operator from
    // getting on the air. It only degrades the MY_* fields in their export,
    // which they can correct later.
    if (event && event.event_type === 'SES' && (opGrid || opState)) {
      await fetch('/api/ses/operators', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_id: event.id,
          op_call: call,
          grid: opGrid,
          state: opState,
        }),
      }).catch(() => {});
    }

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
          <h1 className="mt-1 text-2xl font-bold text-zinc-100 light:text-zinc-900">{event.club_name}</h1>
          <p className="text-zinc-400 light:text-zinc-600">
            {event.club_call}
            {event.event_type !== 'SES' && ` • ${event.class} • ${event.arrl_section}`}
          </p>
          <p className="mt-1 text-xs uppercase tracking-wider text-zinc-500">
            {eventTypeLabel(event.event_type)} {event.event_year}
          </p>
          {event.ses_description && (
            <p className="mt-1 text-sm text-zinc-400 light:text-zinc-600">{event.ses_description}</p>
          )}
          {event.location && <p className="mt-1 text-sm text-zinc-500 light:text-zinc-500">{event.location}</p>}
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 light:border-zinc-200 light:bg-zinc-50">
          <h2 className="mb-4 font-semibold text-zinc-200 light:text-zinc-800">Sign In as Operator</h2>
          <form onSubmit={handleJoin} className="flex flex-col gap-3">
            <label className="flex min-w-0 flex-col gap-1">
              <span className="text-sm text-zinc-400">Your Callsign</span>
              <input
                required
                value={opCall}
                onChange={e => setOpCall(e.target.value.toUpperCase())}
                placeholder="W0NY"
                className="input w-full font-mono text-lg tracking-widest"
                autoFocus
              />
            </label>
            {event.event_type === 'SES' && (
              <div className="flex gap-3">
                <label className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-sm text-zinc-400">Your Grid</span>
                  <input
                    value={opGrid}
                    onChange={e => setOpGrid(e.target.value.toUpperCase())}
                    placeholder="EN34"
                    className="input w-full font-mono"
                    maxLength={8}
                  />
                </label>
                <label className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-sm text-zinc-400">Your State</span>
                  <input
                    value={opState}
                    onChange={e => setOpState(e.target.value.toUpperCase())}
                    placeholder="MN"
                    className="input w-full font-mono"
                    maxLength={4}
                  />
                </label>
              </div>
            )}
            {event.event_type === 'SES' && (
              <p className="text-xs text-zinc-500">
                Your own location, not the event&apos;s — it becomes the MY_GRIDSQUARE
                and MY_STATE on the contacts you make, which is what LoTW needs
                for a station operated from several places.
              </p>
            )}
            <button
              type="submit"
              className="mt-2 rounded-lg bg-amber-400 py-2 font-semibold text-zinc-900 hover:bg-amber-300"
            >
              Enter Logger
            </button>
          </form>
        </div>

        <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900 p-6 light:border-zinc-200 light:bg-zinc-50">
          <h2 className="mb-2 font-semibold text-zinc-200 light:text-zinc-800">Just Watching?</h2>
          <p className="mb-4 text-sm text-zinc-400 light:text-zinc-600">
            {event.event_type === 'SES'
              ? 'Visitor mode shows live stats — QSO count, map, rate, band activity — with no sign-in and no logging. A special event has no contest score. Good for a lobby display.'
              : 'Visitor mode shows live stats — score, map, rate, sections — with no sign-in and no logging. Good for a stats-only station or a lobby display.'}
          </p>
          <Link
            href={`/event/${code}/dashboard?visitor=1`}
            className="block w-full rounded-lg border border-zinc-700 py-2 text-center font-semibold text-zinc-300 hover:border-zinc-500 hover:bg-zinc-800 light:border-zinc-300 light:text-zinc-600 light:hover:bg-zinc-100"
          >
            View Live Stats (Visitor)
          </Link>
        </div>
      </div>
    </main>
  );
}
