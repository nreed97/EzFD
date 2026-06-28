'use client';

import { ARRL_SECTIONS } from '@/lib/types';

const REGIONS: { label: string; sections: string[] }[] = [
  { label: '1st District', sections: ['CT','EMA','ME','NH','RI','VT','WMA'] },
  { label: '2nd District', sections: ['ENY','NLI','NNJ','NNY','SNJ','WNY'] },
  { label: '3rd District', sections: ['DE','EPA','MDC','WPA'] },
  { label: '4th District', sections: ['AL','GA','KY','NC','NFL','SFL','SC','TN','VA','WCF'] },
  { label: '5th District', sections: ['AR','LA','MS','NM','NTX','OK','STX','WTX'] },
  { label: '6th District', sections: ['EB','LAX','ORG','PAC','SB','SCV','SDG','SF','SJV','SV'] },
  { label: '7th District', sections: ['AK','AZ','EWA','ID','MT','NV','OR','UT','WWA','WY'] },
  { label: '8th District', sections: ['MI','OH','WV'] },
  { label: '9th District', sections: ['IL','IN','WI'] },
  { label: '0th District', sections: ['CO','IA','KS','MN','MO','ND','NE','SD'] },
  { label: 'Canada',       sections: ['AB','BC','MB','NB','NL','NS','NT','ON','PEI','QC','SK','YT'] },
];

interface Props {
  workedSections: string[];
}

export default function SectionsNeeded({ workedSections }: Props) {
  const worked = new Set(workedSections);
  const totalNeeded = ARRL_SECTIONS.length - workedSections.length;

  if (totalNeeded === 0) {
    return (
      <div className="flex h-full items-center justify-center text-green-400 font-semibold text-lg">
        All {ARRL_SECTIONS.length} sections worked!
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mb-3 flex items-baseline gap-2">
        <span className="text-2xl font-bold font-mono text-zinc-100 light:text-zinc-900">{totalNeeded}</span>
        <span className="text-sm text-zinc-400 light:text-zinc-600">
          sections needed · {workedSections.length} of {ARRL_SECTIONS.length} worked
        </span>
      </div>

      <div className="flex flex-col gap-3">
        {REGIONS.map(region => {
          const needed = region.sections.filter(s => !worked.has(s));
          if (needed.length === 0) return null;
          return (
            <div key={region.label}>
              <div className="mb-1 flex items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  {region.label}
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
