'use client';

import type { QSO } from '@/lib/types';

interface Props {
  qsos: QSO[];
}

export default function RateChart({ qsos }: Props) {
  const validQSOs = qsos.filter(q => !q.is_dupe);

  // Group by UTC hour slot (each slot = a unique calendar hour)
  const slots = new Map<number, number>();
  for (const q of validQSOs) {
    const slot = Math.floor(new Date(q.datetime_utc).getTime() / 3_600_000);
    slots.set(slot, (slots.get(slot) ?? 0) + 1);
  }

  if (slots.size === 0) {
    return (
      <div className="flex h-full items-center justify-center text-zinc-500 text-sm">
        No QSOs logged yet
      </div>
    );
  }

  // Fill every hour from first QSO to last (so empty hours show as zero)
  const sortedSlots = Array.from(slots.keys()).sort((a, b) => a - b);
  const first = sortedSlots[0];
  const last = sortedSlots[sortedSlots.length - 1];
  const bars: { label: string; count: number }[] = [];
  for (let s = first; s <= last; s++) {
    const d = new Date(s * 3_600_000);
    bars.push({
      label: `${String(d.getUTCHours()).padStart(2, '0')}Z`,
      count: slots.get(s) ?? 0,
    });
  }

  const maxCount = Math.max(...bars.map(b => b.count), 1);
  const totalQSOs = validQSOs.length;

  return (
    <div className="h-full overflow-y-auto bg-zinc-950 p-4 light:bg-white">
      <div className="mb-3 flex items-baseline gap-3">
        <span className="text-sm font-semibold text-zinc-300 light:text-zinc-700">QSO Rate by Hour</span>
        <span className="text-xs text-zinc-500">{totalQSOs.toLocaleString()} total valid QSOs</span>
      </div>

      <div className="flex flex-col gap-1 min-w-0">
        {bars.map(({ label, count }) => (
          <div key={label} className="flex items-center gap-2 min-w-0">
            <span className="w-9 shrink-0 text-right font-mono text-2xs text-zinc-500 light:text-zinc-400">
              {label}
            </span>
            <div className="flex-1 min-w-0 h-5 flex items-center">
              {count > 0 ? (
                <div
                  className="h-4 rounded-sm bg-amber-400 light:bg-amber-500 flex items-center justify-end pr-1 transition-all"
                  style={{ width: `${Math.max((count / maxCount) * 100, 2)}%` }}
                >
                  {count >= 3 && (
                    <span className="text-2xs font-mono font-bold text-zinc-900">{count}</span>
                  )}
                </div>
              ) : (
                <div className="h-px w-full bg-zinc-800 light:bg-zinc-200" />
              )}
              {count > 0 && count < 3 && (
                <span className="ml-1 text-2xs font-mono text-zinc-400">{count}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 text-2xs text-zinc-600 light:text-zinc-400">
        Peak: {maxCount} QSOs/hr &nbsp;·&nbsp; {bars.length} hour{bars.length !== 1 ? 's' : ''} of operation
      </div>
    </div>
  );
}
