'use client';

import { preflight, NOT_CHECKED } from '@/lib/preflight';
import type { Event, Score, Bonuses, QSO } from '@/lib/types';
import { bonusDefs, bonusPoints, transmittersFromClass, WFD_OBJECTIVES } from '@/lib/bonuses';

interface Props {
  event: Event;
  score: Score;
  bonuses: Bonuses;
  operators: string[];
  onClose: () => void;
  /** The log, for the pre-submission read. Findings are derived from it and
   *  from the event's own claims — never from an outside callsign list. */
  qsos: QSO[];
}

/**
 * The bonus lines on the sheet, straight from the same table the scorer sums.
 *
 * This used to re-derive each value from the key name, so the sheet an
 * operator transcribes onto their ARRL entry could differ from the claimed
 * score printed beneath it. Filtering on the computed value means an
 * unclaimed bonus is a zero and a claimed one is exactly what was scored.
 */
function bonusLineItems(event: Event, bonuses: Bonuses, score: Score): { label: string; pts: number }[] {
  const ctx = {
    transmitters: transmittersFromClass(event.class),
    baseScore: score.total_score,
  };
  const items: { label: string; pts: number }[] = [];
  // WFD objectives are multipliers, not points, so they are listed separately
  // below rather than being summed into a bonus total that does not exist.
  if (event.event_type === 'WFD') return items;
  for (const def of bonusDefs(event.event_type)) {
    const pts = bonusPoints(def, bonuses, ctx);
    if (pts === 0) continue;
    const claimed = bonuses[def.key];
    // A counted bonus shows its count, so the sheet says where the number
    // came from — "GOTA QSOs (42)" rather than a bare 210.
    const label = def.kind === 'per-unit' ? `${def.label} (${claimed})` : def.label;
    items.push({ label, pts });
  }
  return items;
}

export default function SummarySheet({ event, score, bonuses, operators, qsos, onClose }: Props) {
  // Winter Field Day multiplies QSO points by its Objective Multiplier + 1 and
  // has no bonus points, so the sheet shows a different calculation entirely.
  const isWfd = event.event_type === 'WFD';
  const bonusPoints = score.bonus_points;
  const claimedScore = score.claimed_score;
  const lineItems = bonusLineItems(event, bonuses, score);
  const findings = preflight(qsos, event, score, bonuses);
  const now = new Date();

  return (
    <>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #fd-summary-sheet, #fd-summary-sheet * { visibility: visible; }
          #fd-summary-sheet { position: absolute; top: 0; left: 0; width: 100%; background: white; color: black; }
        }
      `}</style>

      <div className="fixed inset-0 z-[1000] flex items-start justify-center bg-black/75 p-4 overflow-y-auto">
        <div className="w-full max-w-xl my-8">
          <div id="fd-summary-sheet" className="rounded-xl border border-zinc-700 bg-zinc-900 text-zinc-200 light:border-zinc-200 light:bg-white light:text-zinc-900">

            <div className="flex items-center justify-between border-b border-zinc-800 light:border-zinc-200 px-5 py-4">
              <div>
                <h2 className="font-bold text-zinc-100 light:text-zinc-900">{event.event_type === 'WFD' ? 'Winter Field Day' : 'Field Day'} Summary Sheet</h2>
                <p className="text-xs text-zinc-500 mt-0.5">{event.event_type === 'WFD' ? 'Winter Field Day' : 'ARRL Field Day'} {event.event_year}</p>
              </div>
              <div className="flex gap-2 print:hidden">
                <button
                  onClick={() => window.print()}
                  className="rounded border border-zinc-600 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 light:border-zinc-300 light:text-zinc-700 light:hover:bg-zinc-50"
                >
                  Print
                </button>
                <button
                  onClick={onClose}
                  className="rounded border border-zinc-700 px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 light:border-zinc-200 light:text-zinc-500 light:hover:bg-zinc-50"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="p-5 flex flex-col gap-4 text-sm">

              {/* Read before submitting. Hidden from the printed sheet: the
                  sheet is what gets transcribed onto an entry, and these are
                  notes for the person holding it, not part of the claim. */}
              <section className="print:hidden">
                <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                  Before you submit
                </h3>
                {findings.length === 0 ? (
                  <p className="rounded-lg border border-emerald-800 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-300 light:border-emerald-300 light:bg-emerald-50 light:text-emerald-800">
                    Nothing to flag in the log or the claims made about it.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {findings.map(f => (
                      <li
                        key={f.id}
                        className={`rounded-lg border px-3 py-2 ${
                          f.severity === 'fix'
                            ? 'border-red-800 bg-red-950/30 light:border-red-300 light:bg-red-50'
                            : 'border-amber-800/70 bg-amber-950/20 light:border-amber-300 light:bg-amber-50'
                        }`}
                      >
                        <div className="flex items-baseline gap-2">
                          <span className={`shrink-0 rounded px-1 text-[9px] font-bold uppercase tracking-wide ${
                            f.severity === 'fix'
                              ? 'bg-red-900 text-red-200 light:bg-red-200 light:text-red-900'
                              : 'bg-amber-900 text-amber-200 light:bg-amber-200 light:text-amber-900'
                          }`}>
                            {f.severity === 'fix' ? 'Fix' : 'Check'}
                          </span>
                          <span className="text-xs font-semibold text-zinc-200 light:text-zinc-800">{f.title}</span>
                        </div>
                        <p className="mt-1 text-[11px] leading-relaxed text-zinc-400 light:text-zinc-600">{f.detail}</p>
                        {f.examples && f.examples.length > 0 && (
                          <p className="mt-1 font-mono text-[11px] text-zinc-500">{f.examples.join('   ')}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {/* Naming what nothing looked at, so a quiet report is not read
                    as a clean bill of health for the whole entry. */}
                <details className="mt-2">
                  <summary className="cursor-pointer text-[10px] text-zinc-600 light:text-zinc-400">
                    What this does not check
                  </summary>
                  <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-4 text-[11px] text-zinc-500">
                    {NOT_CHECKED.map(t => <li key={t}>{t}</li>)}
                  </ul>
                </details>
              </section>

              {/* Club info */}
              <section>
                <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">Station Information</h3>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                  <Row label="Club name"    value={event.club_name} />
                  <Row label="Callsign"     value={event.club_call} />
                  <Row label="Class"        value={event.class ?? '—'} />
                  <Row label="Power"        value={event.power ?? 'HIGH'} />
                  <Row label="ARRL section" value={event.arrl_section ?? '—'} />
                  {event.location && <Row label="Location" value={event.location} className="col-span-2" />}
                </div>
              </section>

              <hr className="border-zinc-800 light:border-zinc-200" />

              {/* QSO breakdown */}
              <section>
                <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">QSO Summary</h3>
                <table className="w-full text-xs font-mono">
                  <thead>
                    <tr className="text-zinc-500 text-[10px]">
                      <th className="text-left pb-1">Mode</th>
                      <th className="text-right pb-1">QSOs</th>
                      <th className="text-right pb-1">Pts/QSO</th>
                      <th className="text-right pb-1">Points</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td className="py-0.5 text-blue-400 light:text-blue-700">Phone</td><td className="text-right">{score.phone_qsos}</td><td className="text-right text-zinc-500">×1</td><td className="text-right">{score.phone_qsos}</td></tr>
                    <tr><td className="py-0.5 text-yellow-400 light:text-yellow-700">CW</td><td className="text-right">{score.cw_qsos}</td><td className="text-right text-zinc-500">×2</td><td className="text-right">{score.cw_qsos * 2}</td></tr>
                    <tr><td className="py-0.5 text-green-400 light:text-green-700">Digital</td><td className="text-right">{score.digital_qsos}</td><td className="text-right text-zinc-500">×2</td><td className="text-right">{score.digital_qsos * 2}</td></tr>
                    <tr className="border-t border-zinc-800 light:border-zinc-200 font-semibold">
                      <td className="pt-1 text-zinc-300 light:text-zinc-700">Total QSO points</td>
                      <td className="pt-1 text-right">{score.valid_qsos}</td>
                      <td />
                      <td className="pt-1 text-right text-amber-400 light:text-amber-700">{score.qso_points}</td>
                    </tr>
                  </tbody>
                </table>
              </section>

              {/* Score calculation */}
              <section>
                <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">Score Calculation</h3>
                <div className="flex flex-col gap-1 font-mono text-xs">
                  <ScoreRow label="QSO points" value={score.qso_points} />
                  {isWfd ? (
                    <ScoreRow label={`Objective mult (OM ${score.objective_multiplier - 1} + 1)`} value={score.objective_multiplier} op="×" />
                  ) : (
                    <ScoreRow label={`Power mult (×${score.power_multiplier})`} value={score.power_multiplier} op="×" />
                  )}
                  <ScoreRow label={isWfd ? 'Total score' : 'Base score'} value={score.total_score} bold />

                  {lineItems.length > 0 && (
                    <>
                      <div className="mt-1 text-[10px] uppercase tracking-wider text-zinc-600 light:text-zinc-400">Bonus points</div>
                      {lineItems.map(item => (
                        <ScoreRow key={item.label} label={item.label} value={item.pts} op="+" indent />
                      ))}
                      <ScoreRow label="Total bonuses" value={bonusPoints} op="+" bold />
                    </>
                  )}

                  <div className="my-1 border-t border-zinc-700 light:border-zinc-300" />
                  <div className="flex items-baseline justify-between">
                    <span className="text-base font-bold text-zinc-100 light:text-zinc-900">Claimed Score</span>
                    <span className="text-xl font-bold text-amber-400 light:text-amber-600">{claimedScore.toLocaleString()}</span>
                  </div>
                </div>
              </section>

              {/* Objectives — WFD only, listed with the OM each contributed
                  so the sheet shows how the multiplier was arrived at. */}
              {isWfd && (
                <section>
                  <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                    Objectives ({WFD_OBJECTIVES.filter(o => bonuses[o.key]).length} of {WFD_OBJECTIVES.length})
                  </h3>
                  <div className="flex flex-col gap-0.5 font-mono text-xs">
                    {WFD_OBJECTIVES.filter(o => bonuses[o.key]).map(o => (
                      <div key={o.key} className="flex items-baseline justify-between">
                        <span className="text-zinc-300 light:text-zinc-700">{o.label}</span>
                        <span className="text-zinc-400 light:text-zinc-600">OM +{o.om}</span>
                      </div>
                    ))}
                    <div className="mt-1 flex items-baseline justify-between border-t border-zinc-800 pt-1 font-semibold light:border-zinc-200">
                      <span className="text-zinc-200 light:text-zinc-800">Objective multiplier</span>
                      <span className="text-amber-400 light:text-amber-700">×{score.objective_multiplier}</span>
                    </div>
                  </div>
                </section>
              )}

              {/* Sections worked */}
              {score.sections.length > 0 && (
                <section>
                  <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                    Sections Worked ({score.sections.length})
                  </h3>
                  <div className="flex flex-wrap gap-1">
                    {[...score.sections].sort().map(s => (
                      <span key={s} className="rounded bg-amber-400/10 px-1.5 py-0.5 font-mono text-xs text-amber-400 light:bg-amber-50 light:text-amber-700">
                        {s}
                      </span>
                    ))}
                  </div>
                </section>
              )}

              {/* Operators */}
              {operators.length > 0 && (
                <section>
                  <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                    Operators ({operators.length})
                  </h3>
                  <p className="font-mono text-xs text-zinc-300 light:text-zinc-700">{operators.join(' · ')}</p>
                </section>
              )}

              <hr className="border-zinc-800 light:border-zinc-200" />

              <div className="flex items-center justify-between text-[10px] text-zinc-600 light:text-zinc-400">
                <span>Generated by EzFD · {event.club_call} · {event.event_year}</span>
                <span>{now.toUTCString().replace(' GMT', 'Z')}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function Row({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  return (
    <div className={className}>
      <span className="text-zinc-500 light:text-zinc-400">{label}: </span>
      <span className="font-semibold text-zinc-200 light:text-zinc-800">{value}</span>
    </div>
  );
}

function ScoreRow({ label, value, op = '', bold = false, indent = false }: {
  label: string; value: number; op?: string; bold?: boolean; indent?: boolean;
}) {
  return (
    <div className={`flex items-baseline justify-between ${indent ? 'pl-3' : ''}`}>
      <span className={`${bold ? 'font-semibold text-zinc-200 light:text-zinc-800' : 'text-zinc-400 light:text-zinc-600'}`}>
        {op && <span className="text-zinc-600 mr-1">{op}</span>}
        {label}
      </span>
      <span className={`${bold ? 'font-bold text-zinc-100 light:text-zinc-900' : 'text-zinc-300 light:text-zinc-700'}`}>
        {value.toLocaleString()}
      </span>
    </div>
  );
}
