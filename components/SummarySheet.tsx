'use client';

import type { Event, Score, Bonuses } from '@/lib/types';

const BOOL_LABELS: Partial<Record<keyof Bonuses, string>> = {
  emergency_power:   'Emergency power',
  w1aw_bulletin:     'W1AW FD bulletin',
  satellite:         'Satellite QSO',
  natural_power:     'Natural power (solar/wind)',
  public_info_table: 'Public information table',
  media_publicity:   'Media publicity',
  educational:       'Educational activity',
  message_to_sm:     'Message to section manager',
  all_licensed:      '100% attendees licensed',
  elected_official:  'Elected official visit',
  web_posting:       'Club website posting',
  social_media:      'Social media post',
  safety_officer:    'Safety officer',
};

interface Props {
  event: Event;
  score: Score;
  bonuses: Bonuses;
  operators: string[];
  onClose: () => void;
}

function bonusLineItems(bonuses: Bonuses, score: Score): { label: string; pts: number }[] {
  const items: { label: string; pts: number }[] = [];
  for (const [k, label] of Object.entries(BOOL_LABELS)) {
    if (bonuses[k as keyof Bonuses]) {
      const pts = k === 'emergency_power' ? score.total_score : k.endsWith('_official') || k === 'web_posting' || k === 'social_media' ? 50 : k === 'safety_officer' ? 25 : 100;
      items.push({ label, pts });
    }
  }
  if (bonuses.youth_ops)    items.push({ label: `Youth operators (${bonuses.youth_ops})`,        pts: bonuses.youth_ops * 20 });
  if (bonuses.gota_qsos)    items.push({ label: `GOTA QSOs (${bonuses.gota_qsos})`,              pts: Math.min(bonuses.gota_qsos * 10, 1000) });
  if (bonuses.served_agency) items.push({ label: `Served agency reps (${bonuses.served_agency})`, pts: Math.min(bonuses.served_agency * 10, 100) });
  if (bonuses.nts_traffic)  items.push({ label: `NTS messages (${bonuses.nts_traffic})`,          pts: Math.min(bonuses.nts_traffic * 10, 100) });
  if (score.sections_worked >= 84) items.push({ label: 'Worked all 84 sections', pts: 100 });
  return items;
}

export default function SummarySheet({ event, score, bonuses, operators, onClose }: Props) {
  const bonusPoints = score.bonus_points;
  const claimedScore = score.claimed_score;
  const lineItems = bonusLineItems(bonuses, score);
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
                  <ScoreRow label={`Power mult (×${score.power_multiplier})`} value={score.power_multiplier} op="×" />
                  <ScoreRow label="Base score" value={score.total_score} bold />

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
