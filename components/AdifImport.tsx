'use client';

import { useState, useRef } from 'react';

interface Props {
  eventId: string;
  operatorCall: string;
  stationNumber: number;
  onClose: () => void;
}

interface ImportResult {
  imported: number;
  dupes: number;
  skipped: number;
  total: number;
}

export default function AdifImport({ eventId, operatorCall, stationNumber, onClose }: Props) {
  const [adifText, setAdifText] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setAdifText(ev.target?.result as string ?? '');
    reader.readAsText(file);
  }

  async function handleImport() {
    if (!adifText.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/import/adif', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_id: eventId,
          adif: adifText,
          operator_call: operatorCall,
          station_number: stationNumber,
        }),
      });
      const data = await res.json() as ImportResult & { error?: string };
      if (!res.ok) {
        setError(data.error ?? `Server error ${res.status}`);
      } else {
        setResult(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-zinc-100">Import ADIF</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 text-lg leading-none">✕</button>
        </div>

        <p className="text-xs text-zinc-500">
          Import QSOs from a WSJT-X / JTDX ADIF log file, or paste ADIF text directly.
          Duplicate contacts are flagged but still recorded.
        </p>

        {/* File picker */}
        <div>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
          >
            Choose .adi / .adif file…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".adi,.adif"
            className="hidden"
            onChange={handleFileChange}
          />
          {adifText && (
            <span className="ml-2 text-xs text-zinc-500">
              {adifText.length.toLocaleString()} chars loaded
            </span>
          )}
        </div>

        {/* Paste area */}
        <textarea
          value={adifText}
          onChange={e => setAdifText(e.target.value)}
          placeholder="…or paste ADIF here"
          rows={6}
          className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-amber-400 resize-y"
        />

        {/* Result / error */}
        {result && (
          <div className="rounded-lg border border-green-800 bg-green-900/20 p-3 text-sm text-green-400">
            <span className="font-bold">{result.imported}</span> QSO{result.imported !== 1 ? 's' : ''} imported
            {result.dupes > 0 && (
              <span className="ml-2 text-yellow-400">· <span className="font-bold">{result.dupes}</span> dupe{result.dupes !== 1 ? 's' : ''}</span>
            )}
            {result.skipped > 0 && (
              <span className="ml-2 text-zinc-500">· {result.skipped} skipped (unknown band)</span>
            )}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-800 bg-red-900/20 p-3 text-xs text-red-400">
            {error}
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800"
          >
            {result ? 'Close' : 'Cancel'}
          </button>
          {!result && (
            <button
              type="button"
              onClick={handleImport}
              disabled={!adifText.trim() || loading}
              className="rounded bg-amber-400 px-4 py-1.5 text-xs font-bold text-zinc-900 hover:bg-amber-300 disabled:opacity-50"
            >
              {loading ? 'Importing…' : 'Import'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
