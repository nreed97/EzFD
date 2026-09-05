'use client';

import { useState } from 'react';
import type { Band, Mode, DisplayQSO, QSO } from '@/lib/types';
import { VALID_EXCHANGES } from '@/lib/types';

const BAND_GRID: Band[][] = [
  ['160m', '80m',  '40m'],
  ['20m',  '15m',  '10m'],
  ['6m',   '2m',   'SAT'],
];
const MODES: Mode[] = ['PH', 'CW', 'DIG'];

interface Props {
  qsos: DisplayQSO[];
  onDelete: (id: string, localId?: string) => void;
  onUpdate: (qso: QSO) => void;
  currentOpCall: string;
  /** The event's soft-deleted contacts, fetched on demand. Undefined until
   *  the operator asks to see them. */
  eventId?: string;
}

function formatUTC(iso: string | Date) {
  const d = new Date(iso);
  return d.toUTCString().slice(17, 22) + 'Z';
}

const MODE_COLORS: Record<string, string> = {
  PH:  'text-blue-400 light:text-blue-700',
  CW:  'text-yellow-400 light:text-yellow-700',
  DIG: 'text-green-400 light:text-green-700',
};

const BAND_COLORS: Record<string, string> = {
  '160m': 'text-rose-400 light:text-rose-700',
  '80m':  'text-orange-400 light:text-orange-700',
  '40m':  'text-amber-400 light:text-amber-700',
  '20m':  'text-lime-400 light:text-lime-700',
  '15m':  'text-emerald-400 light:text-emerald-700',
  '10m':  'text-cyan-400 light:text-cyan-700',
  '6m':   'text-sky-400 light:text-sky-700',
  '2m':   'text-violet-400 light:text-violet-700',
};

// ---------------------------------------------------------------------------
// Inline edit modal
// ---------------------------------------------------------------------------
interface EditModalProps {
  qso: DisplayQSO;
  onSave: (updated: QSO) => void;
  onClose: () => void;
  /** Recorded as updated_by — self-asserted, like every identity here. */
  currentOpCall: string;
}

function EditModal({ qso, onSave, onClose, currentOpCall }: EditModalProps) {
  const [callsign, setCallsign] = useState(qso.callsign);
  const [band, setBand] = useState<Band>(qso.band);
  const [mode, setMode] = useState<Mode>(qso.mode);
  const [rcvdClass, setRcvdClass] = useState(qso.rcvd_class ?? '');
  const [rcvdSection, setRcvdSection] = useState(qso.rcvd_section ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!callsign) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/qso/${qso.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operator_call: currentOpCall, callsign, band, mode, rcvd_class: rcvdClass, rcvd_section: rcvdSection }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setError(body.error ?? 'Save failed');
        return;
      }
      onSave(await res.json());
    } catch {
      setError('Network error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/75 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl light:border-zinc-200 light:bg-white"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-200 light:text-zinc-800">Edit QSO</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 light:hover:text-zinc-700 text-lg leading-none">✕</button>
        </div>

        <div className="flex flex-col gap-3">
          <div>
            <label className="block text-xs text-zinc-400 mb-1 light:text-zinc-600">Callsign</label>
            <input
              value={callsign}
              onChange={e => setCallsign(e.target.value.toUpperCase().replace(/[^A-Z0-9/]/g, ''))}
              className="input w-full font-mono text-lg tracking-widest"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs text-zinc-400 mb-1 light:text-zinc-600">Band</label>
            <div className="grid grid-cols-3 gap-1">
              {BAND_GRID.flat().map(b => (
                <button
                  key={b}
                  type="button"
                  onClick={() => setBand(b)}
                  className={`rounded py-1.5 text-xs font-mono font-semibold transition-colors ${
                    band === b ? 'bg-amber-400 text-zinc-900' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 light:bg-zinc-100 light:text-zinc-700 light:hover:bg-zinc-200'
                  }`}
                >
                  {b}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs text-zinc-400 mb-1 light:text-zinc-600">Mode</label>
            <div className="flex rounded-lg overflow-hidden border border-zinc-700 light:border-zinc-300">
              {MODES.map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`flex-1 py-2 text-sm font-bold transition-colors ${
                    mode === m ? 'bg-amber-400 text-zinc-900' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 light:bg-zinc-100 light:text-zinc-700 light:hover:bg-zinc-200'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <div className="w-24">
              <label className="block text-xs text-zinc-400 mb-1 light:text-zinc-600">Rcvd Class</label>
              <input
                value={rcvdClass}
                onChange={e => setRcvdClass(e.target.value.toUpperCase())}
                className="input w-full font-mono"
                maxLength={4}
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-zinc-400 mb-1 light:text-zinc-600">Rcvd Section</label>
              <input
                list="edit-section-list"
                value={rcvdSection}
                onChange={e => setRcvdSection(e.target.value.toUpperCase())}
                className="input w-full font-mono"
                maxLength={5}
              />
              <datalist id="edit-section-list">
                {VALID_EXCHANGES.map(s => <option key={s} value={s} />)}
              </datalist>
            </div>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleSave}
              disabled={saving || !callsign}
              className="flex-1 rounded-lg bg-amber-400 py-2 text-sm font-bold text-zinc-900 hover:bg-amber-300 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={onClose}
              className="flex-1 rounded-lg border border-zinc-700 py-2 text-sm text-zinc-300 hover:bg-zinc-800 light:border-zinc-300 light:text-zinc-700 light:hover:bg-zinc-100"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main table
// ---------------------------------------------------------------------------
export default function QSOTable({ qsos, onDelete, onUpdate, currentOpCall, eventId }: Props) {
  const [editingQSO, setEditingQSO] = useState<DisplayQSO | null>(null);
  // Deleted contacts are fetched only when asked for: they're the exception,
  // and loading them with every render would put a query on the hot path of
  // the logger for a panel almost nobody opens.
  const [showDeleted, setShowDeleted] = useState(false);
  const [deleted, setDeleted] = useState<QSO[] | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);

  async function loadDeleted() {
    if (!eventId) return;
    const res = await fetch(`/api/qso?event_id=${eventId}&deleted=1`).catch(() => null);
    if (res?.ok) setDeleted(await res.json());
  }

  async function toggleDeleted() {
    const next = !showDeleted;
    setShowDeleted(next);
    if (next) await loadDeleted();
  }

  async function restore(id: string) {
    setRestoring(id);
    const res = await fetch(`/api/qso/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operator_call: currentOpCall }),
    }).catch(() => null);
    setRestoring(null);
    if (res?.ok) {
      // The restored row arrives in every open window over SSE; drop it from
      // the deleted list here so this one agrees immediately.
      setDeleted(prev => (prev ?? []).filter(q => q.id !== id));
    }
  }

  function handleUpdate(updated: QSO) {
    onUpdate(updated);
    setEditingQSO(null);
  }

  return (
    <>
      {editingQSO && (
        <EditModal qso={editingQSO} onSave={handleUpdate} onClose={() => setEditingQSO(null)} currentOpCall={currentOpCall} />
      )}

      <div className="h-full overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-zinc-950 text-xs text-zinc-500 uppercase light:bg-white light:text-zinc-400">
            <tr>
              <th className="px-3 py-2 text-left w-16">UTC</th>
              <th className="px-3 py-2 text-left">Callsign</th>
              <th className="px-3 py-2 text-left w-16">Band</th>
              <th className="px-3 py-2 text-left w-12">Mode</th>
              <th className="px-3 py-2 text-left w-16">Class</th>
              <th className="px-3 py-2 text-left w-16">Sect</th>
              <th className="px-3 py-2 text-left w-12">Op</th>
              <th className="px-2 py-2 w-12"></th>
            </tr>
          </thead>
          <tbody>
            {qsos.map(qso => (
              <tr
                key={qso._local_id ?? qso.id}
                className={`border-b border-zinc-800/50 light:border-zinc-200 transition-colors ${
                  qso._pending
                    ? 'bg-yellow-950/20 light:bg-yellow-50/50 opacity-70'
                    : qso.is_dupe
                      ? 'opacity-40'
                      : 'hover:bg-zinc-900/50 light:hover:bg-zinc-100'
                }`}
              >
                <td className="px-3 py-1.5 font-mono text-xs text-zinc-400 light:text-zinc-600">{formatUTC(qso.datetime_utc)}</td>
                <td className="px-3 py-1.5 font-mono font-semibold text-zinc-100 light:text-zinc-900">
                  <span className="flex items-center gap-1.5 flex-wrap">
                    {qso.callsign}
                    {qso._pending && (
                      <span className="text-2xs text-yellow-500 animate-pulse">↑ sync</span>
                    )}
                    {qso.is_dupe && !qso._pending && (
                      <span className="rounded bg-zinc-700 px-1.5 py-0.5 text-2xs font-medium uppercase tracking-wide text-zinc-400">
                        dupe
                      </span>
                    )}
                  </span>
                </td>
                <td className={`px-3 py-1.5 font-mono text-xs ${BAND_COLORS[qso.band] ?? 'text-zinc-300'}`}>
                  {qso.band}
                </td>
                <td className={`px-3 py-1.5 font-mono text-xs font-bold ${MODE_COLORS[qso.mode] ?? 'text-zinc-300'}`}>
                  {qso.mode}
                </td>
                <td className="px-3 py-1.5 font-mono text-xs text-zinc-400 light:text-zinc-600">{qso.rcvd_class ?? '—'}</td>
                <td className="px-3 py-1.5 font-mono text-xs text-zinc-400 light:text-zinc-600">{qso.rcvd_section ?? '—'}</td>
                <td className="px-3 py-1.5 font-mono text-xs text-zinc-500 light:text-zinc-600">
                  {qso.operator_call === currentOpCall
                    ? <span className="text-amber-400">{qso.operator_call}</span>
                    : qso.operator_call ?? '—'}
                </td>
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-1">
                    {!qso._pending && (
                      <button
                        onClick={() => setEditingQSO(qso)}
                        className="text-zinc-600 hover:text-zinc-300 light:text-zinc-400 light:hover:text-zinc-700 transition-colors text-xs"
                        title="Edit QSO"
                      >
                        ✎
                      </button>
                    )}
                    <button
                      onClick={() => {
                        if (confirm(`Delete QSO with ${qso.callsign}?`)) {
                          onDelete(qso.id, qso._local_id);
                        }
                      }}
                      className="text-zinc-700 hover:text-red-400 light:text-zinc-400 transition-colors text-xs"
                      title="Delete QSO"
                    >
                      ✕
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {qsos.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-zinc-600 light:text-zinc-400">
                  No QSOs logged yet. Start logging!
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Deleted contacts. A hard delete left no recovery path at all — an
            operator who removed the wrong QSO at 3 AM had nothing to go back
            to, and a contact missing from the log was indistinguishable from
            one never logged. */}
        {eventId && (
          <div className="border-t border-zinc-800 px-3 py-2 light:border-zinc-200">
            <button
              onClick={toggleDeleted}
              className="text-xs text-zinc-600 hover:text-zinc-300 light:text-zinc-400 light:hover:text-zinc-700 transition-colors"
            >
              {showDeleted ? '▾' : '▸'} Deleted contacts
              {deleted !== null && ` (${deleted.length})`}
            </button>

            {showDeleted && (
              deleted === null ? (
                <p className="py-2 text-xs text-zinc-600">Loading…</p>
              ) : deleted.length === 0 ? (
                <p className="py-2 text-xs text-zinc-600 light:text-zinc-400">
                  Nothing has been deleted from this log.
                </p>
              ) : (
                <table className="mt-2 w-full text-xs">
                  <tbody>
                    {deleted.map(q => (
                      <tr key={q.id} className="border-b border-zinc-900 last:border-0 light:border-zinc-100">
                        <td className="py-1 pr-2 font-mono text-zinc-500">{formatUTC(q.datetime_utc)}</td>
                        <td className="py-1 pr-2 font-mono text-zinc-400 light:text-zinc-600">{q.callsign}</td>
                        <td className="py-1 pr-2 text-zinc-600">{q.band} {q.mode}</td>
                        <td className="py-1 pr-2 text-zinc-600">
                          {q.deleted_by ? `deleted by ${q.deleted_by}` : 'deleted'}
                          {q.deleted_at ? ` · ${formatUTC(q.deleted_at)}` : ''}
                        </td>
                        <td className="py-1 text-right">
                          <button
                            onClick={() => restore(q.id)}
                            disabled={restoring === q.id}
                            className="text-amber-500 hover:text-amber-300 disabled:opacity-50 light:text-amber-700"
                            title="Put this contact back in the log"
                          >
                            {restoring === q.id ? '…' : 'Restore'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            )}
          </div>
        )}
      </div>
    </>
  );
}
