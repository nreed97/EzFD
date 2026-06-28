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

export default function NewEventPage() {
  const router = useRouter();
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function set(key: string, value: string | number) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    const res = await fetch('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, class: `${classNum}${classLetter}`, admin_key: form.admin_key }),
    });

    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Failed to create event');
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
          <h2 className="mb-4 font-semibold text-zinc-300 light:text-zinc-700">Field Day Setup</h2>
          <div className="flex flex-col gap-3">
            <div className="flex gap-3">
              <fieldset className="flex flex-1 flex-col gap-1">
                <span className="text-sm text-zinc-400">FD Class</span>
                <div className="flex gap-1">
                  <input
                    type="number"
                    min={1}
                    max={99}
                    value={classNum}
                    onChange={e => setClassNum(Math.max(1, parseInt(e.target.value) || 1))}
                    className="input w-16 text-center font-mono"
                    aria-label="Number of transmitters"
                  />
                  <select
                    value={classLetter}
                    onChange={e => setClassLetter(e.target.value)}
                    className="input flex-1"
                    aria-label="Class letter"
                  >
                    {FD_CLASS_LETTERS.map(({ value, label }) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>
                <span className="text-xs text-zinc-500">Class: {classNum}{classLetter}</span>
              </fieldset>
              <label className="flex flex-1 flex-col gap-1">
                <span className="text-sm text-zinc-400">ARRL Section</span>
                <select value={form.arrl_section} onChange={e => set('arrl_section', e.target.value)} className="input">
                  {ARRL_SECTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
            </div>
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
          <h2 className="mb-1 font-semibold text-zinc-300 light:text-zinc-700">QRZ Lookup (optional)</h2>
          <p className="mb-4 text-xs text-zinc-500">Used to auto-fill callsign info for all operators in this event. Requires a QRZ.com XML subscription.</p>
          <div className="flex flex-col gap-3">
            <div className="flex gap-3">
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

        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-amber-400 py-3 font-semibold text-zinc-900 transition-colors hover:bg-amber-300 disabled:opacity-50"
        >
          {loading ? 'Creating...' : 'Create Event & Get Join Code'}
        </button>
      </form>
    </main>
  );
}
