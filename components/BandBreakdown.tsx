'use client';

import type { Score, Band } from '@/lib/types';

const BAND_ORDER: Band[] = ['160m','80m','40m','20m','15m','10m','6m','2m','1.25m','70cm','SAT'];

interface Props {
  score: Score;
}

export default function BandBreakdown({ score }: Props) {
  const rows = BAND_ORDER
    .filter(b => score.by_band[b])
    .map(b => {
      const s = score.by_band[b]!;
      return { band: b, ph: s.ph, cw: s.cw, dig: s.dig, total: s.ph + s.cw * 2 + s.dig * 2 };
    })
    .sort((a, b) => b.total - a.total);

  const totPh  = rows.reduce((n, r) => n + r.ph, 0);
  const totCw  = rows.reduce((n, r) => n + r.cw, 0);
  const totDig = rows.reduce((n, r) => n + r.dig, 0);
  const totPts = rows.reduce((n, r) => n + r.total, 0);

  if (rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-zinc-500 text-sm">
        No QSOs logged yet
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-zinc-950 p-4 light:bg-white">
      <div className="mb-3 flex items-baseline gap-3">
        <span className="text-sm font-semibold text-zinc-300 light:text-zinc-700">Band Breakdown</span>
        <span className="text-xs text-zinc-500">{score.valid_qsos} valid QSOs · {score.qso_points} pts</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs font-mono border-collapse">
          <thead>
            <tr className="border-b border-zinc-800 light:border-zinc-200">
              <th className="pb-1.5 text-left text-[10px] uppercase tracking-wider text-zinc-500 pr-4">Band</th>
              <th className="pb-1.5 text-right text-[10px] uppercase tracking-wider text-blue-400 light:text-blue-700 w-14">PH</th>
              <th className="pb-1.5 text-right text-[10px] uppercase tracking-wider text-yellow-400 light:text-yellow-700 w-14">CW</th>
              <th className="pb-1.5 text-right text-[10px] uppercase tracking-wider text-green-400 light:text-green-700 w-14">DIG</th>
              <th className="pb-1.5 text-right text-[10px] uppercase tracking-wider text-amber-400 light:text-amber-700 w-16">Pts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.band} className="border-b border-zinc-900 light:border-zinc-100 hover:bg-zinc-900 light:hover:bg-zinc-50">
                <td className="py-1.5 pr-4 font-semibold text-zinc-300 light:text-zinc-700">{r.band}</td>
                <td className={`py-1.5 text-right ${r.ph ? 'text-blue-400 light:text-blue-700' : 'text-zinc-700 light:text-zinc-300'}`}>
                  {r.ph || '—'}
                </td>
                <td className={`py-1.5 text-right ${r.cw ? 'text-yellow-400 light:text-yellow-700' : 'text-zinc-700 light:text-zinc-300'}`}>
                  {r.cw || '—'}
                </td>
                <td className={`py-1.5 text-right ${r.dig ? 'text-green-400 light:text-green-700' : 'text-zinc-700 light:text-zinc-300'}`}>
                  {r.dig || '—'}
                </td>
                <td className="py-1.5 text-right text-amber-400 light:text-amber-700 font-semibold">{r.total}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-zinc-700 light:border-zinc-300">
              <td className="pt-2 font-semibold text-zinc-400 light:text-zinc-600">Total</td>
              <td className="pt-2 text-right text-blue-400 light:text-blue-700 font-semibold">{totPh}</td>
              <td className="pt-2 text-right text-yellow-400 light:text-yellow-700 font-semibold">{totCw}</td>
              <td className="pt-2 text-right text-green-400 light:text-green-700 font-semibold">{totDig}</td>
              <td className="pt-2 text-right text-amber-400 light:text-amber-700 font-bold">{totPts}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="mt-3 text-[10px] text-zinc-600 light:text-zinc-400">
        CW &amp; DIG = 2 pts/QSO · PH = 1 pt/QSO · sorted by points
      </p>
    </div>
  );
}
