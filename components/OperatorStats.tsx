'use client';

import { useState } from 'react';
import type { QSO, EventType } from '@/lib/types';
import {
  operatorStats, sortOpStats, UNATTRIBUTED,
  type OpStatsSort, type SortDirection,
} from '@/lib/opStats';

/**
 * Who worked what, for the dashboard.
 *
 * Every figure comes out of `lib/opStats.ts` — nothing is computed here. The
 * sidebar's Operators panel reads the same table, so the two surfaces cannot
 * print different rates for the same operator, which is the failure the
 * section list and the bonus schedule both had when they were written out
 * twice.
 */

const MODE_COLORS: Record<string, string> = {
  PH:  'text-blue-400 light:text-blue-600',
  CW:  'text-yellow-400 light:text-yellow-600',
  DIG: 'text-green-400 light:text-green-600',
};

export interface OpPresence {
  op_call: string;
  station: number;
  band: string;
  mode: string;
  updated_at: string;
}

interface Props {
  qsos: QSO[];
  eventType: EventType;
  presence?: OpPresence[];
  /** Passed in rather than read, so the "on air now" dot updates with the
   *  dashboard's one ticking clock instead of only when something else
   *  re-renders this component. */
  nowMs: number;
}

const INACTIVE_MS = 15 * 60 * 1000;

/** `18:42Z`. The whole log is UTC and a local time here would be the one
 *  place on the dashboard that is not. */
function hhmmZ(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}Z`;
}

/** One decimal below 10, none above: `0.4`, `3.7`, `41`. A rate of `41.3/hr`
 *  is precision the number does not have. */
function rate(value: number | null): string {
  if (value === null) return '—';
  return value < 10 ? value.toFixed(1) : String(Math.round(value));
}

interface Column {
  id: OpStatsSort;
  label: string;
  title: string;
  /** Sorting a count is most useful largest-first; sorting a callsign or a
   *  time is most useful smallest-first. Clicking a header the first time
   *  should give the reader the order they meant. */
  firstClick: SortDirection;
  numeric?: boolean;
}

const COLUMNS: Column[] = [
  { id: 'call',          label: 'Operator', title: 'Callsign as logged',                          firstClick: 'asc' },
  { id: 'qsos',          label: 'Q',        title: 'Scoring contacts — duplicates excluded',      firstClick: 'desc', numeric: true },
  { id: 'qsoPoints',     label: 'Pts',      title: 'QSO points, before any multiplier',           firstClick: 'desc', numeric: true },
  { id: 'bestHour',      label: 'Best hr',  title: 'Most contacts in any 60 minutes',             firstClick: 'desc', numeric: true },
  { id: 'spanRate',      label: 'Avg/hr',   title: 'Contacts per hour from first to last. Blank until they span an hour \u2014 below that, dividing extrapolates rather than averages', firstClick: 'desc', numeric: true },
  { id: 'bands',         label: 'Bands',    title: 'Bands worked',                                firstClick: 'desc' },
  { id: 'sections',      label: 'Sect',     title: 'Sections worked',                             firstClick: 'desc', numeric: true },
  { id: 'firstSections', label: 'New',      title: 'Sections nobody in the log had reached yet',  firstClick: 'desc', numeric: true },
  { id: 'dupes',         label: 'Dupe',     title: 'Duplicates logged — not in Q or Pts',         firstClick: 'desc', numeric: true },
  { id: 'first',         label: 'On',       title: 'First and last contact, UTC',                 firstClick: 'asc' },
];

export default function OperatorStats({ qsos, eventType, presence = [], nowMs }: Props) {
  const [sortBy, setSortBy] = useState<OpStatsSort>('qsos');
  const [dir, setDir] = useState<SortDirection>('desc');

  const table = operatorStats(qsos, eventType);
  const rows = sortOpStats(table.rows, sortBy, dir);

  const presenceByOp: Record<string, OpPresence> = {};
  for (const p of presence) presenceByOp[p.op_call] = p;

  // Someone who has signed in but not logged yet is still an operator at the
  // site, and a table that omits them looks like they are not there. They get
  // a row of zeroes rather than no row.
  const logged = new Set(table.rows.map(r => r.call));
  const signedInOnly = presence
    .map(p => p.op_call)
    .filter((call, i, all) => all.indexOf(call) === i && !logged.has(call));

  const columns = COLUMNS.filter(c =>
    table.showsSections || (c.id !== 'sections' && c.id !== 'firstSections'));

  function sortOn(col: Column) {
    if (col.id === sortBy) setDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortBy(col.id); setDir(col.firstClick); }
  }

  if (table.rows.length === 0 && signedInOnly.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-zinc-500 light:text-zinc-400">
        Nobody has logged a contact yet.
      </div>
    );
  }

  const numeric = 'text-right font-mono tabular-nums';

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-zinc-800 px-4 py-2 text-xs text-zinc-500 light:border-zinc-200 light:text-zinc-500">
        <span>
          <span className="font-mono font-bold text-zinc-200 light:text-zinc-800">{table.totals.operators}</span>
          {' '}operator{table.totals.operators === 1 ? '' : 's'}
        </span>
        <span>
          <span className="font-mono font-bold text-zinc-200 light:text-zinc-800">{table.totals.qsos}</span>
          {' '}scoring contacts
        </span>
        {table.totals.dupes > 0 && (
          <span>
            <span className="font-mono font-bold text-zinc-400 light:text-zinc-600">{table.totals.dupes}</span>
            {' '}duplicate{table.totals.dupes === 1 ? '' : 's'}
          </span>
        )}
        {/* Points are per-operator QSO points and this says so, because the
            column beside the scoreboard invites exactly the comparison it
            cannot survive: the entry's score is these points multiplied,
            plus bonuses that belong to nobody in particular. */}
        <span className="text-zinc-600 light:text-zinc-400">
          QSO points only — the power multiplier and bonuses belong to the entry, not to an operator
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-zinc-900 light:bg-zinc-50">
            <tr className="border-b border-zinc-800 light:border-zinc-200">
              {columns.map(col => (
                <th
                  key={col.id}
                  title={col.title}
                  onClick={() => sortOn(col)}
                  className={`cursor-pointer select-none px-2 py-1.5 font-medium uppercase tracking-wider text-zinc-500 hover:text-zinc-300 light:hover:text-zinc-800 ${
                    col.numeric ? 'text-right' : 'text-left'
                  } ${sortBy === col.id ? 'text-amber-400 light:text-amber-700' : ''}`}
                >
                  {col.label}
                  <span className="ml-0.5 inline-block w-2">
                    {sortBy === col.id ? (dir === 'asc' ? '↑' : '↓') : ''}
                  </span>
                </th>
              ))}
              {table.hasGota && (
                <th title="Contacts made at the GOTA station" className={`px-2 py-1.5 font-medium uppercase tracking-wider text-zinc-500 ${numeric}`}>
                  GOTA
                </th>
              )}
              <th className="px-2 py-1.5 text-left font-medium uppercase tracking-wider text-zinc-500">On air</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const p = r.call ? presenceByOp[r.call] : undefined;
              const active = p ? nowMs - new Date(p.updated_at).getTime() <= INACTIVE_MS : false;
              return (
                <tr
                  key={r.call ?? 'unattributed'}
                  className="border-b border-zinc-800/50 hover:bg-zinc-800/30 light:border-zinc-200 light:hover:bg-zinc-100"
                >
                  <td className="px-2 py-1">
                    {r.call === UNATTRIBUTED ? (
                      <span
                        title="Contacts with no operator recorded — an ADIF import. Listed so the columns add up to the log."
                        className="italic text-zinc-500 light:text-zinc-400"
                      >
                        no operator
                      </span>
                    ) : (
                      <span className="font-mono font-bold text-zinc-200 light:text-zinc-800">{r.call}</span>
                    )}
                    {r.stations.length > 1 && (
                      <span
                        title={`Logged from stations ${r.stations.join(', ')}`}
                        className="ml-1.5 text-2xs text-zinc-500"
                      >
                        stn {r.stations.join('/')}
                      </span>
                    )}
                  </td>
                  <td className={`px-2 py-1 font-bold text-zinc-100 light:text-zinc-900 ${numeric}`}>{r.qsos}</td>
                  <td className={`px-2 py-1 text-amber-400 light:text-amber-700 ${numeric}`}>{r.qsoPoints}</td>
                  <td className={`px-2 py-1 text-zinc-300 light:text-zinc-700 ${numeric}`} title={r.bestHourAt ? `Hour beginning ${hhmmZ(r.bestHourAt)}` : undefined}>
                    {r.bestHour || '—'}
                  </td>
                  <td className={`px-2 py-1 text-zinc-400 light:text-zinc-600 ${numeric}`}>{rate(r.spanRate)}</td>
                  <td className="px-2 py-1">
                    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                      <span className="font-mono text-2xs text-zinc-300 light:text-zinc-700">
                        {r.bands.length > 0 ? r.bands.join(' ') : '—'}
                      </span>
                      {r.modes.map(m => (
                        <span key={m} className={`text-2xs font-mono ${MODE_COLORS[m] ?? 'text-zinc-400'}`}>{m}</span>
                      ))}
                    </span>
                  </td>
                  {table.showsSections && (
                    <>
                      <td className={`px-2 py-1 text-zinc-300 light:text-zinc-700 ${numeric}`}>{r.sections || '—'}</td>
                      <td
                        className={`px-2 py-1 ${numeric} ${r.firstSections.length > 0 ? 'text-emerald-400 light:text-emerald-700' : 'text-zinc-600'}`}
                        title={r.firstSections.length > 0 ? `First in the log to work ${r.firstSections.join(', ')}` : undefined}
                      >
                        {r.firstSections.length || '—'}
                      </td>
                    </>
                  )}
                  <td className={`px-2 py-1 ${numeric} ${r.dupes > 0 ? 'text-zinc-400 light:text-zinc-600' : 'text-zinc-700 light:text-zinc-300'}`}>
                    {r.dupes || '—'}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1 font-mono text-2xs text-zinc-500 light:text-zinc-500">
                    {r.first ? `${hhmmZ(r.first)}–${hhmmZ(r.last)}` : '—'}
                  </td>
                  {table.hasGota && (
                    <td className={`px-2 py-1 ${numeric} ${r.gota > 0 ? 'text-sky-400 light:text-sky-700' : 'text-zinc-700 light:text-zinc-300'}`}>
                      {r.gota || '—'}
                    </td>
                  )}
                  <td className="whitespace-nowrap px-2 py-1">
                    {p ? (
                      <span className="flex items-center gap-1.5">
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? 'bg-green-400' : 'bg-zinc-600'}`} />
                        <span className="font-mono text-2xs text-amber-400 light:text-amber-700">{p.band}</span>
                        <span className={`font-mono text-2xs ${MODE_COLORS[p.mode] ?? 'text-zinc-400'}`}>{p.mode}</span>
                        {!active && <span className="text-2xs text-zinc-600">idle</span>}
                      </span>
                    ) : (
                      <span className="text-2xs text-zinc-700 light:text-zinc-300">—</span>
                    )}
                  </td>
                </tr>
              );
            })}

            {signedInOnly.map(call => {
              const p = presenceByOp[call];
              const active = nowMs - new Date(p.updated_at).getTime() <= INACTIVE_MS;
              return (
                <tr key={`present-${call}`} className="border-b border-zinc-800/50 opacity-60 light:border-zinc-200">
                  <td className="px-2 py-1">
                    <span className="font-mono font-bold text-zinc-200 light:text-zinc-800">{call}</span>
                  </td>
                  <td colSpan={columns.length - 1 + (table.hasGota ? 1 : 0)} className="px-2 py-1 text-2xs italic text-zinc-500">
                    signed in, nothing logged yet
                  </td>
                  <td className="whitespace-nowrap px-2 py-1">
                    <span className="flex items-center gap-1.5">
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? 'bg-green-400' : 'bg-zinc-600'}`} />
                      <span className="font-mono text-2xs text-amber-400 light:text-amber-700">{p.band}</span>
                      <span className={`font-mono text-2xs ${MODE_COLORS[p.mode] ?? 'text-zinc-400'}`}>{p.mode}</span>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
          {/* The totals are the point of the row, not decoration: they are how
              a reader checks this table against the scoreboard beside it
              without adding a column up by hand. */}
          <tfoot className="sticky bottom-0 bg-zinc-900 light:bg-zinc-50">
            <tr className="border-t border-zinc-700 light:border-zinc-300">
              <td className="px-2 py-1.5 text-2xs uppercase tracking-wider text-zinc-500">Total</td>
              <td className={`px-2 py-1.5 font-bold text-zinc-100 light:text-zinc-900 ${numeric}`}>{table.totals.qsos}</td>
              <td className={`px-2 py-1.5 font-bold text-amber-400 light:text-amber-700 ${numeric}`}>{table.totals.qsoPoints}</td>
              <td colSpan={table.showsSections ? 5 : 3} />
              <td className={`px-2 py-1.5 text-zinc-400 light:text-zinc-600 ${numeric}`}>{table.totals.dupes || '—'}</td>
              <td />
              {table.hasGota && (
                <td className={`px-2 py-1.5 text-sky-400 light:text-sky-700 ${numeric}`}>{table.totals.gota || '—'}</td>
              )}
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
