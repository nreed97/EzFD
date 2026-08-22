'use client';

import { ARRL_SECTIONS } from '@/lib/types';
import { SECTION_GROUPS } from '@/lib/sections';


interface Props {
  workedSections: string[];
  /** Logged exchanges that aren't a section and aren't DX — almost always
   *  typos. Shown here so they can be corrected while they still matter. */
  unknownSections?: string[];
}

export default function SectionsNeeded({ workedSections, unknownSections = [] }: Props) {
  const worked = new Set(workedSections);
  const totalNeeded = Math.max(0, ARRL_SECTIONS.length - worked.size);

  if (totalNeeded === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4">
        <div className="text-green-400 font-semibold text-lg">
          All {ARRL_SECTIONS.length} sections worked!
        </div>
        {unknownSections.length > 0 && (
          <div className="text-xs text-yellow-400 light:text-yellow-700">
            {unknownSections.length} logged exchange(s) aren&apos;t a known section:{' '}
            <span className="font-mono">{unknownSections.join(', ')}</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mb-3 flex items-baseline gap-2">
        <span className="text-2xl font-bold font-mono text-zinc-100 light:text-zinc-900">{totalNeeded}</span>
        <span className="text-sm text-zinc-400 light:text-zinc-600">
          sections needed · {worked.size} of {ARRL_SECTIONS.length} worked
        </span>
      </div>

      {unknownSections.length > 0 && (
        <div className="mb-3 rounded-lg border border-yellow-600 bg-yellow-900/20 px-3 py-2 text-xs text-yellow-400 light:border-yellow-500 light:bg-yellow-50 light:text-yellow-700">
          <strong>{unknownSections.length} logged {unknownSections.length === 1 ? 'exchange isn' : "exchanges aren"}&apos;t a known section:</strong>{' '}
          <span className="font-mono">{unknownSections.join(', ')}</span>. These
          don&apos;t count toward Worked All Sections — check them for typos in the log.
        </div>
      )}

      <div className="flex flex-col gap-3">
        {SECTION_GROUPS.map(region => {
          const needed = region.sections.filter(s => !worked.has(s));
          if (needed.length === 0) return null;
          return (
            <div key={region.title}>
              <div className="mb-1 flex items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  {region.title}
                </span>
                <span className="text-[10px] text-zinc-600">
                  {needed.length}/{region.sections.length} needed
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {needed.map(s => (
                  <span
                    key={s}
                    className="rounded bg-red-400/10 px-2 py-1 font-mono text-xs font-semibold text-red-400 light:bg-red-50 light:text-red-700"
                  >
                    {s}
                  </span>
                ))}
                {region.sections.filter(s => worked.has(s)).map(s => (
                  <span
                    key={s}
                    className="rounded bg-zinc-800/50 px-2 py-1 font-mono text-xs text-zinc-600 line-through light:bg-zinc-100 light:text-zinc-400"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
