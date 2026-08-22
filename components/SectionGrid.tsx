'use client';

import { SECTION_DATA } from '@/lib/sections';

const GROUPS = [
  { label: '1',        sections: ['CT','EMA','ME','NH','RI','VT','WMA'] },
  { label: '2',        sections: ['ENY','NLI','NNJ','NNY','SNJ','WNY'] },
  { label: '3',        sections: ['DE','EPA','MDC','WPA'] },
  { label: '4',        sections: ['AL','GA','KY','NC','NFL','SFL','SC','TN','VA','WCF','PR','VI'] },
  { label: '5',        sections: ['AR','LA','MS','NM','NTX','OK','STX','WTX'] },
  { label: '6',        sections: ['EB','LAX','ORG','SB','SCV','SDG','SF','SJV','SV','PAC'] },
  { label: '7',        sections: ['AK','AZ','EWA','ID','MT','NV','OR','UT','WWA','WY'] },
  { label: '8',        sections: ['MI','OH','WV'] },
  { label: '9',        sections: ['IL','IN','WI'] },
  { label: '10',       sections: ['CO','IA','KS','MN','MO','ND','NE','SD'] },
  { label: 'Canada',   sections: ['AB','BC','GH','MB','NB','NL','NS','NT','ONE','ONN','ONS','PE','QC','SK'] },
];

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
        {GROUPS.map(group => (
          <div key={group.label}>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-zinc-600 light:text-zinc-400">
              {group.label === 'Canada' ? 'Canada' : `${group.label}${group.label === '1' ? 'st' : group.label === '2' ? 'nd' : group.label === '3' ? 'rd' : 'th'} District`}
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
