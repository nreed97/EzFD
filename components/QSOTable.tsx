'use client';

import type { DisplayQSO } from '@/lib/types';

interface Props {
  qsos: DisplayQSO[];
  onDelete: (id: string, localId?: string) => void;
  currentOpCall: string;
}

function formatUTC(iso: string) {
  const d = new Date(iso);
  return d.toUTCString().slice(17, 22) + 'Z';
}

const MODE_COLORS: Record<string, string> = {
  PH:  'text-blue-400',
  CW:  'text-yellow-400',
  DIG: 'text-green-400',
};

const BAND_COLORS: Record<string, string> = {
  '160m': 'text-rose-400',
  '80m':  'text-orange-400',
  '40m':  'text-amber-400',
  '20m':  'text-lime-400',
  '15m':  'text-emerald-400',
  '10m':  'text-cyan-400',
  '6m':   'text-sky-400',
  '2m':   'text-violet-400',
};

export default function QSOTable({ qsos, onDelete, currentOpCall }: Props) {
  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-zinc-950 text-xs text-zinc-500 uppercase">
          <tr>
            <th className="px-3 py-2 text-left w-16">UTC</th>
            <th className="px-3 py-2 text-left">Callsign</th>
            <th className="px-3 py-2 text-left w-16">Band</th>
            <th className="px-3 py-2 text-left w-12">Mode</th>
            <th className="px-3 py-2 text-left w-16">Class</th>
            <th className="px-3 py-2 text-left w-16">Sect</th>
            <th className="px-3 py-2 text-left w-12">Op</th>
            <th className="px-2 py-2 w-8"></th>
          </tr>
        </thead>
        <tbody>
          {qsos.map(qso => (
            <tr
              key={qso._local_id ?? qso.id}
              className={`border-b border-zinc-800/50 transition-colors ${
                qso._pending
                  ? 'bg-yellow-950/20 opacity-70'
                  : qso.is_dupe
                    ? 'opacity-35'
                    : 'hover:bg-zinc-900/50'
              }`}
            >
              <td className="px-3 py-1.5 font-mono text-xs text-zinc-400">{formatUTC(qso.datetime_utc)}</td>
              <td className="px-3 py-1.5 font-mono font-semibold text-zinc-100">
                {qso.callsign}
                {qso._pending && (
                  <span className="ml-1.5 text-[10px] text-yellow-500 animate-pulse">↑ sync</span>
                )}
                {qso.is_dupe && !qso._pending && (
                  <span className="ml-1 text-xs text-yellow-500">[D]</span>
                )}
              </td>
              <td className={`px-3 py-1.5 font-mono text-xs ${BAND_COLORS[qso.band] ?? 'text-zinc-300'}`}>
                {qso.band}
              </td>
              <td className={`px-3 py-1.5 font-mono text-xs font-bold ${MODE_COLORS[qso.mode] ?? 'text-zinc-300'}`}>
                {qso.mode}
              </td>
              <td className="px-3 py-1.5 font-mono text-xs text-zinc-400">{qso.rcvd_class ?? '—'}</td>
              <td className="px-3 py-1.5 font-mono text-xs text-zinc-400">{qso.rcvd_section ?? '—'}</td>
              <td className="px-3 py-1.5 font-mono text-xs text-zinc-500">
                {qso.operator_call === currentOpCall
                  ? <span className="text-amber-400">{qso.operator_call}</span>
                  : qso.operator_call ?? '—'}
              </td>
              <td className="px-2 py-1.5">
                <button
                  onClick={() => {
                    if (confirm(`Delete QSO with ${qso.callsign}?`)) {
                      onDelete(qso.id, qso._local_id);
                    }
                  }}
                  className="text-zinc-700 hover:text-red-400 transition-colors text-xs"
                  title="Delete QSO"
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
          {qsos.length === 0 && (
            <tr>
              <td colSpan={8} className="px-3 py-8 text-center text-zinc-600">
                No QSOs logged yet. Start logging!
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
