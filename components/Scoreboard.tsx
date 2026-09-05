'use client';

import type { Score } from '@/lib/types';

interface Props {
  score: Score;
  bonusPoints?: number;
  /** Winter Field Day multiplies by objectives rather than power, and has no
   *  bonus points at all. */
  isWfd?: boolean;
  /** The logging screen's copy: the mode split and the score, and nothing
   *  else.
   *
   *  The full panel is 318px, which is what pushed the logging pane past the
   *  bottom of a 768-tall laptop. Everything it drops — QSO points, the
   *  multiplier, sections, the base score, the bonus line and the by-band
   *  table — is on the dashboard, a menu tap away, and none of it changes
   *  between one contact and the next in a way an operator acts on mid-run.
   *  The two numbers that do are here. */
  compact?: boolean;
}

export default function Scoreboard({ score, bonusPoints = 0, isWfd = false, compact = false }: Props) {
  const total = score.total_score;
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 text-xs light:border-zinc-200 light:bg-zinc-100/50">
      <h3 className="mb-2 font-semibold text-zinc-400 uppercase tracking-wider text-[10px] light:text-zinc-500">Score</h3>

      <div className="grid grid-cols-3 gap-y-1 mb-3">
        <div>
          <div className="text-blue-400 font-mono text-lg font-bold leading-none light:text-blue-700">{score.phone_qsos}</div>
          <div className="text-zinc-500 text-[10px]">Phone</div>
        </div>
        <div>
          <div className="text-yellow-400 font-mono text-lg font-bold leading-none light:text-yellow-700">{score.cw_qsos}</div>
          <div className="text-zinc-500 text-[10px]">CW</div>
        </div>
        <div>
          <div className="text-green-400 font-mono text-lg font-bold leading-none light:text-green-700">{score.digital_qsos}</div>
          <div className="text-zinc-500 text-[10px]">Digital</div>
        </div>
      </div>

      {compact ? (
        <div className="flex items-baseline justify-between border-t border-zinc-800 pt-2 light:border-zinc-200">
          <span className="font-semibold text-zinc-100 light:text-zinc-900">
            {bonusPoints > 0 ? 'Claimed' : 'Score'}
          </span>
          <span className="font-mono text-lg font-bold text-amber-400">{total.toLocaleString()}</span>
        </div>
      ) : (
      <>
      <div className="flex items-baseline justify-between border-t border-zinc-800 pt-2 mb-1 light:border-zinc-200">
        <span className="text-zinc-400 light:text-zinc-600">QSO pts</span>
        <span className="font-mono text-zinc-200 light:text-zinc-800">{score.qso_points}</span>
      </div>
      {/* Exactly one multiplier is in play, and which one depends on the
          contest: Field Day multiplies by power, Winter Field Day by its
          Objective Multiplier + 1. Sections are shown below because operators
          chase them, but they must never read as part of the product —
          sections multiplying the score was a real bug in this file's
          history, and they are not even a bonus. */}
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-zinc-400 light:text-zinc-600">{isWfd ? '× Objectives' : '× Power'}</span>
        <span className="font-mono text-zinc-200 light:text-zinc-800">
          {isWfd ? score.objective_multiplier : score.power_multiplier}×
        </span>
      </div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-zinc-400 light:text-zinc-600">Sections</span>
        <span className="font-mono text-zinc-200 light:text-zinc-800">{score.sections_worked}</span>
      </div>
      <div className="flex items-baseline justify-between border-t border-zinc-700 pt-2 light:border-zinc-200">
        <span className="font-semibold text-zinc-200 light:text-zinc-800">{bonusPoints > 0 ? 'Base Score' : 'Est. Score'}</span>
        <span className="font-mono text-lg font-bold text-amber-400 light:text-amber-600">{score.total_score.toLocaleString()}</span>
      </div>
      {bonusPoints > 0 && (
        <>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-zinc-400 light:text-zinc-600">+ Bonuses</span>
            <span className="font-mono text-zinc-200 light:text-zinc-800">+{bonusPoints.toLocaleString()}</span>
          </div>
          <div className="flex items-baseline justify-between border-t border-zinc-700 pt-1.5 mt-1 light:border-zinc-200">
            <span className="font-semibold text-zinc-100 light:text-zinc-900">Claimed Score</span>
            <span className="font-mono text-xl font-bold text-amber-400 light:text-amber-600">{(score.total_score + bonusPoints).toLocaleString()}</span>
          </div>
        </>
      )}

      {Object.keys(score.by_band).length > 0 && (
        <div className="mt-3 border-t border-zinc-800 pt-2 light:border-zinc-200">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">By Band</div>
          {(Object.entries(score.by_band) as [string, { ph: number; cw: number; dig: number }][]).map(([band, stats]) => (
            <div key={band} className="flex items-center justify-between py-0.5">
              <span className="font-mono text-zinc-400 light:text-zinc-600">{band}</span>
              <span className="font-mono text-zinc-300 light:text-zinc-700">
                <span className="text-blue-400 light:text-blue-700">{stats.ph}</span>/
                <span className="text-yellow-400 light:text-yellow-700">{stats.cw}</span>/
                <span className="text-green-400 light:text-green-700">{stats.dig}</span>
              </span>
            </div>
          ))}
        </div>
      )}
      </>
      )}
    </div>
  );
}
