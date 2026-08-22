'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ARRL_SECTIONS, EVENT_TYPE_LABELS, eventTypeLabel } from '@/lib/types';
import type { EventType, SlotEnforcement, DupeRule } from '@/lib/types';
import DateTimeField from '@/components/DateTimeField';

// ARRL Field Day entry classes (rule 4). The number in front is the count of
// simultaneously-transmitting stations, not the operator count.
const FD_CLASS_LETTERS = [
  { value: 'A', label: 'A — Club portable (3+)' },
  { value: 'B', label: 'B — 1 or 2 op portable' },
  { value: 'C', label: 'C — Mobile' },
  { value: 'D', label: 'D — Home, mains power' },
  { value: 'E', label: 'E — Home, emergency power' },
  { value: 'F', label: 'F — EOC' },
];

// Winter Field Day categories — a different set from Field Day's A–F, with no
// emergency-power or EOC split. The leading number is transmitters, as for FD.
const WFD_CLASS_LETTERS = [
  { value: 'H', label: 'H — Home' },
  { value: 'I', label: 'I — Indoor' },
  { value: 'O', label: 'O — Outdoor' },
  { value: 'M', label: 'M — Mobile' },
];

export default function NewEventPage() {
  const router = useRouter();
  const [eventType, setEventType] = useState<EventType>('FD');
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
  // Special event station settings — ignored for FD/WFD.
  const [sesForm, setSesForm] = useState({
    starts_at: '',
    ends_at: '',
    ses_description: '',
    ses_qsl_info: '',
  });
  const [slotEnforcement, setSlotEnforcement] = useState<SlotEnforcement>('SOFT');
  const [slotMinutes, setSlotMinutes] = useState(120);
  const [dupeRule, setDupeRule] = useState<DupeRule>('DAY');
  const [requireApproval, setRequireApproval] = useState(false);

  const isSes = eventType === 'SES';

  function setSes(key: keyof typeof sesForm, value: string) {
    setSesForm(prev => ({ ...prev, [key]: value }));
  }
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
        // A datetime-local value has no timezone. Operators think in UTC
        // during an event, so it's read as UTC rather than as browser-local.
        starts_at: sesForm.starts_at ? `${sesForm.starts_at}:00Z` : null,
        ends_at:   sesForm.ends_at   ? `${sesForm.ends_at}:00Z`   : null,
        ses_description: sesForm.ses_description,
        ses_qsl_info: sesForm.ses_qsl_info,
        slot_enforcement: slotEnforcement,
        slot_minutes: slotMinutes,
        dupe_rule: dupeRule,
        require_operator_approval: requireApproval,
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

      <h1 className="mb-2 text-3xl font-bold text-amber-400">
        {isSes ? 'Create Special Event Station' : `Create ${eventTypeLabel(eventType)} Event`}
      </h1>
      <p className="mb-6 text-sm text-zinc-400 light:text-zinc-600">{EVENT_TYPE_LABELS[eventType].blurb}</p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 light:border-zinc-200 light:bg-zinc-50">
          <h2 className="mb-1 font-semibold text-zinc-300 light:text-zinc-700">Event Type</h2>
          <p className="mb-4 text-xs text-zinc-500">
            Pick this first &mdash; it decides the exchange, the scoring and which
            of the settings below apply.
          </p>
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">Event Type</legend>
            {(['FD', 'WFD', 'SES'] as EventType[]).map(type => (
              <button
                key={type}
                type="button"
                aria-pressed={eventType === type}
                onClick={() => {
                  setEventType(type);
                  if (type !== 'SES') setClassLetter(type === 'WFD' ? 'H' : 'A');
                  // FD/WFD require a section; an SES defaults to none.
                  set('arrl_section', type === 'SES' ? '' : 'EPA');
                  // Contest dupes are once per event; a special event may
                  // run for weeks, where working someone again on another
                  // day is normal.
                  setDupeRule(type === 'SES' ? 'DAY' : 'EVENT');
                }}
                className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                  eventType === type
                    ? 'border-amber-400 bg-amber-400/10'
                    : 'border-zinc-700 hover:border-zinc-500 light:border-zinc-300'
                }`}
              >
                <span className={`block text-sm font-semibold ${
                  eventType === type ? 'text-amber-400' : 'text-zinc-300 light:text-zinc-700'
                }`}>
                  {EVENT_TYPE_LABELS[type].name}
                </span>
                <span className="block text-xs text-zinc-500">{EVENT_TYPE_LABELS[type].blurb}</span>
              </button>
            ))}
          </fieldset>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 light:border-zinc-200 light:bg-zinc-50">
          <h2 className="mb-4 font-semibold text-zinc-300 light:text-zinc-700">
            {isSes ? 'Station Info' : 'Club Info'}
          </h2>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-sm text-zinc-400">{isSes ? 'Event Name' : 'Club Name'}</span>
              <input
                required
                value={form.club_name}
                onChange={e => set('club_name', e.target.value)}
                placeholder={isSes ? 'Lighthouse Weekend 2026' : 'Anytown Amateur Radio Club'}
                className="input"
              />
            </label>
            <div className="flex gap-3">
              <label className="flex flex-1 flex-col gap-1">
                <span className="text-sm text-zinc-400">{isSes ? 'Special Event Callsign' : 'Club Callsign'}</span>
                <input
                  required
                  value={form.club_call}
                  onChange={e => set('club_call', e.target.value.toUpperCase())}
                  placeholder={isSes ? 'W9X' : 'W0NY'}
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
            {isSes ? (
              <>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <div className="flex flex-1 flex-col gap-1">
                    <span className="text-sm text-zinc-400">Starts (UTC)</span>
                    <DateTimeField
                      label="Start"
                      value={sesForm.starts_at}
                      onChange={v => setSes('starts_at', v)}
                    />
                  </div>
                  <div className="flex flex-1 flex-col gap-1">
                    <span className="text-sm text-zinc-400">Ends (UTC)</span>
                    <DateTimeField
                      label="End"
                      value={sesForm.ends_at}
                      onChange={v => setSes('ends_at', v)}
                    />
                  </div>
                </div>
                <label className="flex flex-col gap-1">
                  <span className="text-sm text-zinc-400">Description (optional)</span>
                  <input
                    value={sesForm.ses_description}
                    onChange={e => setSes('ses_description', e.target.value)}
                    placeholder="Commemorating the 150th anniversary of ..."
                    className="input"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-sm text-zinc-400">QSL Info (optional)</span>
                  <input
                    value={sesForm.ses_qsl_info}
                    onChange={e => setSes('ses_qsl_info', e.target.value)}
                    placeholder="QSL via LoTW, or SASE to ..."
                    className="input"
                  />
                </label>
              </>
            ) : (
            <>
            <p className="text-xs text-zinc-500">
              {eventType === 'WFD'
                ? 'Winter Field Day exchange: your category (transmitters + letter) and ARRL/RAC section — DX stations send "DX".'
                : 'ARRL Field Day exchange: your class (transmitters + letter) and ARRL/RAC section.'}
              {' '}Both are sent on every QSO and stamped on the Cabrillo entry.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <fieldset className="flex min-w-0 flex-col gap-1 sm:flex-2">
                <span className="text-sm text-zinc-400">{eventType === 'WFD' ? 'WFD Category' : 'FD Class'}</span>
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
              <label className="flex min-w-0 flex-col gap-1 sm:flex-1">
                <span className="text-sm text-zinc-400">ARRL/RAC Section</span>
                <select value={form.arrl_section} onChange={e => set('arrl_section', e.target.value)} className="input">
                  {ARRL_SECTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
            </div>
            </>
            )}
            {/* Power category only affects the ARRL score multiplier. */}
            <fieldset className={`flex flex-col gap-1 ${isSes ? 'hidden' : ''}`}>
              <span className="text-sm text-zinc-400">Power Category</span>
              <span className="text-xs text-zinc-500">
                Score multiplier only &mdash; HIGH &times;1, LOW &times;2, QRP &times;5. It
                doesn&apos;t change the exchange you send.
              </span>
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
              {isSes && (
                <span className="text-xs text-zinc-500">
                  A nominal location for the event. Each operator sets their own
                  grid and state on the roster — that&apos;s what lands in the ADIF
                  MY_ fields, since a distributed activation has one location per
                  operator rather than one per event.
                </span>
              )}
            </label>
          </div>
        </div>

        {/* Coordination — SES only */}
        {isSes && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 light:border-zinc-200 light:bg-zinc-50">
            <h2 className="mb-1 font-semibold text-zinc-300 light:text-zinc-700">Call Coordination</h2>
            <p className="mb-4 text-xs text-zinc-500">
              Operators check the callsign out for a band and mode. The database
              refuses overlapping checkouts, so two stations can&apos;t be signing
              the same call on the same band and mode at once.
            </p>
            <div className="flex flex-col gap-3">
              <fieldset className="flex flex-col gap-1">
                <span className="text-sm text-zinc-400">Enforcement</span>
                <div className="flex gap-2">
                  {([
                    ['SOFT', 'Warn only'],
                    ['HARD', 'Block logging'],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setSlotEnforcement(value)}
                      className={`flex-1 rounded-lg border py-2 text-sm font-semibold transition-colors ${
                        slotEnforcement === value
                          ? 'border-amber-400 bg-amber-400/10 text-amber-400'
                          : 'border-zinc-700 text-zinc-400 hover:border-zinc-500 light:border-zinc-300 light:text-zinc-600'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <span className="text-xs text-zinc-500">
                  {slotEnforcement === 'SOFT'
                    ? 'Logging a QSO without holding the band/mode shows a warning but still records the contact — recommended, since refusing a contact that already happened on the air loses real data.'
                    : 'Logging is refused unless the operator holds the band/mode. QSOs replayed from the offline queue are always accepted regardless.'}
                </span>
              </fieldset>
              <div className="flex flex-col gap-3 sm:flex-row">
                <label className="flex flex-1 flex-col gap-1">
                  <span className="text-sm text-zinc-400">Default slot length</span>
                  <select
                    value={slotMinutes}
                    onChange={e => setSlotMinutes(Number(e.target.value))}
                    className="input"
                  >
                    {[30, 60, 120, 180, 240].map(m => (
                      <option key={m} value={m}>{m >= 60 ? `${m / 60} hour${m > 60 ? 's' : ''}` : `${m} minutes`}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-1 flex-col gap-1">
                  <span className="text-sm text-zinc-400">Duplicate rule</span>
                  <select
                    value={dupeRule}
                    onChange={e => setDupeRule(e.target.value as DupeRule)}
                    className="input"
                  >
                    <option value="DAY">Once per band/mode per day</option>
                    <option value="EVENT">Once per band/mode for the whole event</option>
                    <option value="NONE">Never flag duplicates</option>
                  </select>
                </label>
              </div>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={requireApproval}
                  onChange={e => setRequireApproval(e.target.checked)}
                  className="mt-1"
                />
                <span>
                  <span className="block text-sm text-zinc-300 light:text-zinc-700">
                    Require operator approval
                  </span>
                  <span className="block text-xs text-zinc-500">
                    Off by default, matching FD and WFD: anyone with the join code can
                    log. Turn this on and a new operator lands in the roster as
                    pending and can&apos;t log until you approve them in
                    <code className="mx-1 rounded bg-zinc-800 px-1 light:bg-zinc-200">ezfd-admin.sh</code>
                    &mdash; worth it when a shared special event callsign is at stake.
                  </span>
                </span>
              </label>
            </div>
          </div>
        )}

        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 light:border-zinc-200 light:bg-zinc-50">
          <h2 className="mb-1 font-semibold text-zinc-300 light:text-zinc-700">Call Databases (optional)</h2>
          <p className="mb-4 text-xs text-zinc-500">Downloaded once when the event is created and used to prefill/verify callsigns during logging.</p>
          <div className="flex flex-col gap-3">
            {/* The N1MM call history file is a contest exchange database
                (a station's usual class and section) — nothing for an SES. */}
            <label className={`flex items-start gap-2 ${isSes ? 'hidden' : ''}`}>
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
                  Downloads the {eventTypeLabel(eventType)} call history for{' '}
                  {form.event_year}{' '}
                  from N1MM and prefills a known station&apos;s Rcvd Class/Section
                  while logging. Falls back to the previous year if that
                  year&apos;s file isn&apos;t published yet.
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
