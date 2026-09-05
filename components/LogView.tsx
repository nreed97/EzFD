'use client';

import { useMemo, useState, useCallback } from 'react';
import type { Band, Event, Mode, QSO } from '@/lib/types';
import { useNow } from '@/lib/useNow';
import { useStoredJson } from '@/lib/useStoredJson';
import { LOG_COLUMNS, defaultColumns, resolveColumns } from '@/lib/logColumns';
import {
  EMPTY_FILTERS, applyLogFilters, filterOptions, isFiltered,
  type DupeFilter, type LogFilters,
} from '@/lib/logFilters';

/**
 * The whole log, filterable, on the dashboard.
 *
 * Read-only by design. Editing and deleting live in the logging screen's
 * QSOTable, which owns that flow and the audit trail that goes with it; this
 * view is for answering questions about the log and for projecting it on a
 * screen at the site, which are different jobs from entering contacts. Sharing
 * one component would mean one grown to serve both.
 */

const MODE_COLORS: Record<string, string> = {
  PH:  'text-blue-400 light:text-blue-700',
  CW:  'text-yellow-400 light:text-yellow-700',
  DIG: 'text-green-400 light:text-green-700',
};

/** How long a contact stays eligible for the arrival highlight. The animation
 *  itself runs once on mount; this only stops rows re-flashing when a filter
 *  change remounts them minutes later. */
const FLASH_WINDOW_MS = 60_000;
const TICK_MS = 5_000;

interface Props {
  event: Event;
  qsos: QSO[];
}

function timeOf(v: string | Date | null | undefined): number {
  if (!v) return NaN;
  return (v instanceof Date ? v : new Date(v)).getTime();
}

export default function LogView({ event, qsos }: Props) {
  const nowMs = useNow(TICK_MS);
  const [filters, setFilters] = useState<LogFilters>(EMPTY_FILTERS);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Column choice is per browser, not per event: the operator projecting the
  // log on a wall wants different columns from one checking their own
  // contacts, on the same event. Keyed by event type so an SES and a contest
  // remember separately — their sensible defaults are different sets.
  const [storedCols, setStoredCols] = useStoredJson<string[]>(
    `ezfd_log_cols_${event.event_type}`,
    defaultColumns(event.event_type),
  );
  const columns = useMemo(
    () => resolveColumns(storedCols, event.event_type),
    [storedCols, event.event_type],
  );

  const options = useMemo(() => filterOptions(qsos), [qsos]);
  const rows = useMemo(
    () => applyLogFilters(qsos, filters, nowMs).slice().reverse(),
    [qsos, filters, nowMs],
  );

  // Ids present when this view first mounted. Anything else arrived over SSE
  // while someone was watching, and is what the arrival highlight is for —
  // without this the whole log would flash on first paint. Frozen
  // deliberately: a contact added later must not join the "already seen" set,
  // or switching views would replay every highlight.
  //
  // State with a lazy initialiser rather than a ref, because this is read
  // during render to decide a row's class. Reading a ref there is what
  // `react-hooks/refs` objects to, and rightly — it makes the render
  // non-idempotent under StrictMode's double-invoke. State that is never set
  // is a frozen value the render may legitimately read.
  const [initialIds] = useState(() => new Set(qsos.map(q => q.id)));

  const update = useCallback(<K extends keyof LogFilters>(key: K, value: LogFilters[K]) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  }, []);

  const toggleColumn = useCallback((id: string) => {
    setStoredCols(prev => {
      const cur = Array.isArray(prev) ? prev : [];
      return cur.includes(id) ? cur.filter(c => c !== id) : [...cur, id];
    });
  }, [setStoredCols]);

  const filtered = isFiltered(filters);

  return (
    <div className="flex h-full flex-col gap-2">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <input
          value={filters.callsign}
          onChange={e => update('callsign', e.target.value)}
          placeholder="Callsign"
          className="input w-28 font-mono !py-1"
          aria-label="Filter by callsign"
        />

        <Multi label="Op"   values={options.operators} selected={filters.operators}
               onChange={v => update('operators', v)} />
        <Multi label="Stn"  values={options.stations.map(String)} selected={filters.stations.map(String)}
               onChange={v => update('stations', v.map(Number))} />
        <Multi label="Band" values={options.bands} selected={filters.bands}
               onChange={v => update('bands', v as Band[])} />
        <Multi label="Mode" values={options.modes} selected={filters.modes}
               onChange={v => update('modes', v as Mode[])} />
        <Multi label="Sect" values={options.sections} selected={filters.sections}
               onChange={v => update('sections', v)} />

        <select
          value={filters.sinceMinutes}
          onChange={e => update('sinceMinutes', Number(e.target.value))}
          className="input !py-1 !px-1.5"
          aria-label="Filter by time"
        >
          <option value={0}>Any time</option>
          <option value={15}>Last 15 min</option>
          <option value={60}>Last hour</option>
          <option value={240}>Last 4 h</option>
        </select>

        <select
          value={filters.dupes}
          onChange={e => update('dupes', e.target.value as DupeFilter)}
          className="input !py-1 !px-1.5"
          aria-label="Filter duplicates"
        >
          <option value="all">All contacts</option>
          <option value="hide">Hide dupes</option>
          <option value="only">Dupes only</option>
        </select>

        <label className="flex items-center gap-1 text-zinc-400 light:text-zinc-600">
          <input
            type="checkbox"
            checked={filters.editedOnly}
            onChange={e => update('editedOnly', e.target.checked)}
            className="accent-amber-400"
          />
          Edited
        </label>

        {filtered && (
          <button
            onClick={() => setFilters(EMPTY_FILTERS)}
            className="rounded border border-zinc-700 px-2 py-1 text-zinc-400 hover:bg-zinc-800 light:border-zinc-300 light:text-zinc-600 light:hover:bg-zinc-100"
          >
            Clear
          </button>
        )}

        <div className="ml-auto flex items-center gap-2">
          <span className="font-mono text-zinc-500">
            {filtered ? `${rows.length.toLocaleString()} of ${qsos.length.toLocaleString()}` : `${qsos.length.toLocaleString()} QSOs`}
          </span>
          <button
            onClick={() => setPickerOpen(v => !v)}
            className="rounded border border-zinc-700 px-2 py-1 text-zinc-400 hover:bg-zinc-800 light:border-zinc-300 light:text-zinc-600 light:hover:bg-zinc-100"
          >
            Columns {pickerOpen ? '▲' : '▼'}
          </button>
        </div>
      </div>

      {/* Column picker */}
      {pickerOpen && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 rounded-lg border border-zinc-800 bg-zinc-950 p-2 text-xs light:border-zinc-200 light:bg-white">
          {LOG_COLUMNS.map(c => (
            <label key={c.id} className="flex items-center gap-1 text-zinc-300 light:text-zinc-700">
              <input
                type="checkbox"
                checked={columns.some(sel => sel.id === c.id)}
                onChange={() => toggleColumn(c.id)}
                className="accent-amber-400"
              />
              {c.title ?? c.label}
            </label>
          ))}
          <button
            onClick={() => setStoredCols(defaultColumns(event.event_type))}
            className="ml-auto rounded border border-zinc-700 px-2 py-0.5 text-zinc-400 hover:bg-zinc-800 light:border-zinc-300 light:text-zinc-600 light:hover:bg-zinc-100"
          >
            Reset
          </button>
        </div>
      )}

      {/* The log */}
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-zinc-800 light:border-zinc-200">
        <table className="w-full border-collapse font-mono text-xs">
          <thead className="sticky top-0 z-10 bg-zinc-900 light:bg-zinc-100">
            <tr className="text-left text-2xs uppercase tracking-wider text-zinc-500">
              {columns.map(c => (
                <th
                  key={c.id}
                  title={c.title ?? c.label}
                  className={`whitespace-nowrap px-2 py-1.5 font-semibold ${c.align === 'right' ? 'text-right' : ''}`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(q => {
              const isNew =
                !initialIds.has(q.id) &&
                nowMs - timeOf(q.datetime_utc) < FLASH_WINDOW_MS;
              return (
                <tr
                  key={q.id}
                  className={`border-t border-zinc-800/60 light:border-zinc-200/60 ${
                    q.is_dupe ? 'text-zinc-600 line-through light:text-zinc-400' : 'text-zinc-300 light:text-zinc-700'
                  } ${isNew ? 'qso-arrived' : ''}`}
                >
                  {columns.map(c => (
                    <td
                      key={c.id}
                      className={`whitespace-nowrap px-2 py-1 ${c.align === 'right' ? 'text-right' : ''} ${
                        c.id === 'mode' ? MODE_COLORS[q.mode] ?? '' : ''
                      } ${c.id === 'callsign' ? 'font-semibold' : ''}`}
                    >
                      {c.value(q)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>

        {rows.length === 0 && (
          <p className="p-6 text-center text-xs text-zinc-500">
            {qsos.length === 0
              ? 'No contacts logged yet.'
              : 'No contacts match these filters.'}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * A compact multi-select. Empty selection means "no restriction" — the label
 * shows the count when narrowed so the active filter is visible without
 * opening anything, which matters on a projected dashboard nobody is standing
 * at.
 */
function Multi({
  label, values, selected, onChange,
}: {
  label: string;
  values: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  if (values.length === 0) return null;

  return (
    // Escape closes the dropdown. Handled here on the wrapper rather than with
    // a document listener: keydown bubbles from whichever checkbox has focus,
    // so there is no effect to register and nothing to clean up if the whole
    // control unmounts while open.
    <div
      className="relative"
      onKeyDown={e => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        onClick={() => setOpen(v => !v)}
        className={`rounded border px-2 py-1 ${
          selected.length > 0
            ? 'border-amber-400/50 bg-amber-400/10 text-amber-400 light:border-amber-500/50 light:bg-amber-50 light:text-amber-700'
            : 'border-zinc-700 text-zinc-400 light:border-zinc-300 light:text-zinc-600'
        }`}
      >
        {label}{selected.length > 0 ? ` (${selected.length})` : ''} ▾
      </button>
      {open && (
        <>
          {/* Click-away. A plain overlay rather than a document listener: no
              effect, no cleanup, and it cannot outlive the open state. */}
          <button
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-20 cursor-default"
          />
          <div className="absolute left-0 top-full z-30 mt-1 max-h-64 min-w-[8rem] overflow-auto rounded-lg border border-zinc-700 bg-zinc-900 p-1.5 shadow-xl light:border-zinc-300 light:bg-white">
            {values.map(v => (
              <label key={v} className="flex items-center gap-1.5 px-1 py-0.5 text-zinc-300 light:text-zinc-700">
                <input
                  type="checkbox"
                  checked={selected.includes(v)}
                  onChange={() =>
                    onChange(selected.includes(v) ? selected.filter(s => s !== v) : [...selected, v])
                  }
                  className="accent-amber-400"
                />
                {v}
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
