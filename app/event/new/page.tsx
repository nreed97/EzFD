'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ARRL_SECTIONS } from '@/lib/types';

const FD_CLASS_LETTERS = [
  { value: 'A', label: 'A — Club portable' },
  { value: 'B', label: 'B — Home/1 transmitter' },
  { value: 'C', label: 'C — Mobile' },
  { value: 'D', label: 'D — Home station' },
  { value: 'E', label: 'E — Emergency operation' },
  { value: 'F', label: 'F — EOC emergency power' },
];

const WFD_CLASS_LETTERS = [
  { value: 'H', label: 'H — Home station' },
  { value: 'O', label: 'O — Outdoor/portable' },
  { value: 'I', label: 'I — Indoor/club' },
];

export default function NewEventPage() {
  const router = useRouter();
  const [eventType, setEventType] = useState<'FD' | 'WFD'>('FD');
  const [power, setPower] = useState<'HIGH' | 'LOW' | 'QRP'>('HIGH');
  const [classNum, setClassNum] = useState(3);
  const [classLetter, setClassLetter] = useState('A');
  const [form, setForm] = useState({
    club_name: '',
    club_call: '',
    event_year: new Date().getFullYear(),
    arrl_section: 'EPA',
    location: '',
    qrz_username: '',
    qrz_password: '',
    admin_key: '',
  });
  const [useCallHistory, setUseCallHistory] = useState(false);
  const [useMasterCallsignFile, setUseMasterCallsignFile] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // The event is created even when a call-database download fails; the API
  // reports those failures as warnings. Hold them so the operator finds out
  // the prefill/lookup feature they ticked isn't actually available, instead
  // of being redirected straight past the notice.
  const [pending, setPending] = useState<{ code: string; warnings: string[] } | null>(null);

  function set(key: string, value: string | number) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading || pending) return; // the event already exists — don't create a second one
    setLoading(true);
    setError('');

    const res = await fetch('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        class: `${classNum}${classLetter}`,
        admin_key: form.admin_key,
        event_type: eventType,
        power,
        use_call_history: useCallHistory,
        use_master_callsign_file: useMasterCallsignFile,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Failed to create event');
      setLoading(false);
      return;
    }

    if (Array.isArray(data.warnings) && data.warnings.length > 0) {
      setPending({ code: data.join_code, warnings: data.warnings });
      setLoading(false);
      return;
    }

    router.push(`/event/${data.join_code}`);
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/" className="mb-8 inline-block text-sm text-zinc-400 hover:text-zinc-200">
        &larr; Back
      </Link>

      <h1 className="mb-6 text-3xl font-bold text-amber-400">Create Field Day Event</h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 light:border-zinc-200 light:bg-zinc-50">
          <h2 className="mb-4 font-semibold text-zinc-300 light:text-zinc-700">Club Info</h2>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-sm text-zinc-400">Club Name</span>
              <input
                required
                value={form.club_name}
                onChange={e => set('club_name', e.target.value)}
                placeholder="Anytown Amateur Radio Club"
                className="input"
              />
            </label>
            <div className="flex gap-3">
              <label className="flex flex-1 flex-col gap-1">
                <span className="text-sm text-zinc-400">Club Callsign</span>
                <input
                  required
                  value={form.club_call}
                  onChange={e => set('club_call', e.target.value.toUpperCase())}
                  placeholder="W0NY"
                  className="input font-mono tracking-widest"
                />
              </label>
              <label className="flex flex-1 flex-col gap-1">
                <span className="text-sm text-zinc-400">Year</span>
                <input
                  type="number"
                  value={form.event_year}
                  onChange={e => set('event_year', parseInt(e.target.value))}
                  min={2024}
                  max={2050}
                  className="input"
                />
              </label>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 light:border-zinc-200 light:bg-zinc-50">
          <h2 className="mb-4 font-semibold text-zinc-300 light:text-zinc-700">Event Setup</h2>
          <div className="flex flex-col gap-3">
            <fieldset className="flex flex-col gap-1">
              <span className="text-sm text-zinc-400">Event Type</span>
              <div className="flex gap-2">
                {(['FD', 'WFD'] as const).map(type => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => {
                      setEventType(type);
                      setClassLetter(type === 'WFD' ? 'H' : 'A');
                    }}
                    className={`flex-1 rounded-lg border py-2 text-sm font-semibold transition-colors ${
                      eventType === type
                        ? 'border-amber-400 bg-amber-400/10 text-amber-400'
                        : 'border-zinc-700 text-zinc-400 hover:border-zinc-500 light:border-zinc-300 light:text-zinc-600'
                    }`}
                  >
                    {type === 'FD' ? 'ARRL Field Day' : 'Winter Field Day'}
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="flex flex-col gap-3 sm:flex-row">
              <fieldset className="flex flex-1 flex-col gap-1">
                <span className="text-sm text-zinc-400">{eventType === 'WFD' ? 'WFD' : 'FD'} Class</span>
                <div className="flex">
                  <input
                    type="number"
                    min={1}
                    max={99}
                    value={classNum}
                    onChange={e => setClassNum(Math.max(1, parseInt(e.target.value) || 1))}
                    className="input w-16 rounded-r-none border-r-0 text-center font-mono"
                    aria-label="Number of transmitters"
                  />
                  <select
                    value={classLetter}
                    onChange={e => setClassLetter(e.target.value)}
                    className="input flex-1 rounded-l-none"
                    aria-label="Class letter"
                  >
                    {(eventType === 'WFD' ? WFD_CLASS_LETTERS : FD_CLASS_LETTERS).map(({ value, label }) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>
              </fieldset>
              <label className="flex flex-1 flex-col gap-1">
                <span className="text-sm text-zinc-400">ARRL Section</span>
                <select value={form.arrl_section} onChange={e => set('arrl_section', e.target.value)} className="input">
                  {ARRL_SECTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
            </div>
            <fieldset className="flex flex-col gap-1">
              <span className="text-sm text-zinc-400">Power Category</span>
              <div className="flex gap-2">
                {(['HIGH', 'LOW', 'QRP'] as const).map(p => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPower(p)}
                    className={`flex-1 rounded-lg border py-2 text-sm font-semibold transition-colors ${
                      power === p
                        ? 'border-amber-400 bg-amber-400/10 text-amber-400'
                        : 'border-zinc-700 text-zinc-400 hover:border-zinc-500 light:border-zinc-300 light:text-zinc-600'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="flex flex-col gap-1">
              <span className="text-sm text-zinc-400">Location (optional)</span>
              <input
                value={form.location}
                onChange={e => set('location', e.target.value)}
                placeholder="City Park, Anytown PA"
                className="input"
              />
            </label>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 light:border-zinc-200 light:bg-zinc-50">
          <h2 className="mb-1 font-semibold text-zinc-300 light:text-zinc-700">Call Databases (optional)</h2>
          <p className="mb-4 text-xs text-zinc-500">Downloaded once when the event is created and used to prefill/verify callsigns during logging.</p>
          <div className="flex flex-col gap-3">
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={useCallHistory}
                onChange={e => setUseCallHistory(e.target.checked)}
                className="mt-1"
              />
              <span>
                <span className="block text-sm text-zinc-300 light:text-zinc-700">
                  Use N1MM {eventType} call history file
                </span>
                <span className="block text-xs text-zinc-500">
                  Downloads the latest {eventType === 'WFD' ? 'Winter Field Day' : 'Field Day'} {form.event_year} call history from N1MM and prefills a known station&apos;s Rcvd Class/Section while logging.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={useMasterCallsignFile}
                onChange={e => setUseMasterCallsignFile(e.target.checked)}
                className="mt-1"
              />
              <span>
                <span className="block text-sm text-zinc-300 light:text-zinc-700">
                  Use master callsign file (MASTER.SCP)
                </span>
                <span className="block text-xs text-zinc-500">
                  Downloads the latest Super Check Partial callsign list to flag whether a call is recognized. Shared across all events, refreshed at most once a day.
                </span>
              </span>
            </label>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 light:border-zinc-200 light:bg-zinc-50">
          <h2 className="mb-1 font-semibold text-zinc-300 light:text-zinc-700">QRZ Lookup (optional)</h2>
          <p className="mb-4 text-xs text-zinc-500">Used to auto-fill callsign info for all operators in this event. Requires a QRZ.com XML subscription.</p>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-3 sm:flex-row">
              <label className="flex flex-1 flex-col gap-1">
                <span className="text-sm text-zinc-400">QRZ Username</span>
                <input
                  value={form.qrz_username}
                  onChange={e => set('qrz_username', e.target.value)}
                  placeholder="W0NY"
                  autoComplete="off"
                  className="input"
                />
              </label>
              <label className="flex flex-1 flex-col gap-1">
                <span className="text-sm text-zinc-400">QRZ Password</span>
                <input
                  type="password"
                  value={form.qrz_password}
                  onChange={e => set('qrz_password', e.target.value)}
                  autoComplete="off"
                  className="input"
                />
              </label>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 light:border-zinc-200 light:bg-zinc-50">
          <h2 className="mb-1 font-semibold text-zinc-300 light:text-zinc-700">Admin Key</h2>
          <p className="mb-4 text-xs text-zinc-500">Required if this server has been configured with an admin key. Leave blank on private/local deployments.</p>
          <label className="flex flex-col gap-1">
            <span className="text-sm text-zinc-400">Admin Key</span>
            <input
              type="password"
              value={form.admin_key}
              onChange={e => set('admin_key', e.target.value)}
              autoComplete="off"
              className="input"
            />
          </label>
        </div>

        {error && <p className="rounded-lg border border-red-800 bg-red-900/30 p-3 text-sm text-red-400">{error}</p>}

        {pending && (
          <div className="rounded-lg border border-yellow-800 bg-yellow-900/20 p-3 text-sm text-yellow-500 light:border-yellow-400 light:bg-yellow-50 light:text-yellow-700">
            <p className="font-semibold">Event created &mdash; join code {pending.code}</p>
            <p className="mt-1 text-xs">
              These optional call databases could not be downloaded. Logging works normally; only the
              prefill/lookup hints are unavailable.
            </p>
            <ul className="mt-2 list-inside list-disc text-xs">
              {pending.warnings.map(w => <li key={w}>{w}</li>)}
            </ul>
          </div>
        )}

        {pending ? (
          <button
            type="button"
            onClick={() => router.push(`/event/${pending.code}`)}
            className="rounded-lg bg-amber-400 py-3 font-semibold text-zinc-900 transition-colors hover:bg-amber-300"
          >
            Continue to Event &rarr;
          </button>
        ) : (
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-amber-400 py-3 font-semibold text-zinc-900 transition-colors hover:bg-amber-300 disabled:opacity-50"
          >
            {loading ? 'Creating...' : 'Create Event & Get Join Code'}
          </button>
        )}
      </form>
    </main>
  );
}
