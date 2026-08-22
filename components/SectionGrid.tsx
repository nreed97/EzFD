'use client';

import { SECTION_DATA, SECTION_GROUPS } from '@/lib/sections';


interface Props {
  workedSections: string[];
}

export default function SectionGrid({ workedSections }: Props) {
  const workedSet = new Set(workedSections.map(s => s.toUpperCase()));
  const total = Object.keys(SECTION_DATA).length;
  const worked = workedSet.size;

  return (
    <div className="h-full overflow-y-auto bg-zinc-950 p-4 light:bg-white">
      <div className="mb-3 flex items-baseline gap-2">
        <span className="text-sm font-semibold text-zinc-300 light:text-zinc-700">Sections</span>
        <span className="text-xs text-zinc-500">
          <span className="font-mono font-bold text-amber-400">{worked}</span>
          <span className="text-zinc-600"> / {total} worked</span>
        </span>
      </div>

      <div className="flex flex-col gap-3">
        {SECTION_GROUPS.map(group => (
          <div key={group.label}>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-zinc-600 light:text-zinc-400">
              {group.title}
            </div>
            <div className="flex flex-wrap gap-1">
              {group.sections.map(s => {
                const w = workedSet.has(s);
                const info = SECTION_DATA[s];
                return (
                  <div
                    key={s}
                    title={info?.name ?? s}
                    className={`rounded px-2 py-1 font-mono text-xs font-semibold transition-colors ${
                      w
                        ? 'bg-amber-400 text-zinc-900'
                        : 'bg-zinc-800 text-zinc-500 light:bg-zinc-100 light:text-zinc-400'
                    }`}
                  >
                    {s}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
