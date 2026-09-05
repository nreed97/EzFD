import { bonusDefs, WFD_OBJECTIVES } from './bonuses';
import { bandsFor } from './bands';
import { entryClassLetter, isARRLSection, transmitterCount, DX_EXCHANGE, MX_EXCHANGE } from './types';
import type { Bonuses, Event, QSO, Score } from './types';

/**
 * A read of the log before it is submitted.
 *
 * Everything here is derived from the log itself, the event's own settings, or
 * a rule transcribed in `docs/rules-reference.md`. Nothing consults an outside
 * list, and that is deliberate rather than incidental.
 *
 * The obvious missing check is "this callsign is not in MASTER.SCP". It is
 * absent for two reasons that compound. The file is fetched best-effort and
 * refreshed on a staleness check, so on a field server with no internet — the
 * deployment this app is built for — the table is empty, and a check against
 * an empty table flags every contact in the log while looking authoritative.
 * And MASTER.SCP is built from contest logs, while Field Day exists to drag
 * out people who never enter contests: the GOTA operator, the new licensee,
 * the member who shows up once a year. A large share of perfectly good Field
 * Day callsigns are simply not in it.
 *
 * That matters beyond the false positives themselves. Two hundred dismissable
 * findings in an eight-hundred-contact log teaches an operator to skim past
 * the whole report, which costs them the checks that are worth reading. A
 * quiet report is the point.
 *
 * For the same reason nothing here is stated as a certainty the app cannot
 * have. `fix` is for a contradiction inside the entry — a claim the log
 * refutes. Everything else is `check`: worth a human's eye, and their call.
 */

export type Severity = 'fix' | 'check';

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  /** Why it matters, in terms of what the entry claims. */
  detail: string;
  /** Concrete instances, so it can be acted on without hunting the log. */
  examples?: string[];
}

/**
 * A shape that cannot be a callsign at all: no digit, no letter, or characters
 * a callsign never contains.
 *
 * Deliberately weak. A stricter pattern — prefix, digit, letters, in that
 * order — rejects real callsigns: some end in a digit, some carry a suffix
 * this app has never seen, and Field Day is exactly the event where the
 * unusual ones turn up. This catches a field somebody typed a name or a
 * fragment into, and nothing else, which is the only thing shape can honestly
 * tell you.
 */
const CALL_CHARS = /^[A-Z0-9/]{3,15}$/;
const HAS_DIGIT = /[0-9]/;
const HAS_LETTER = /[A-Z]/;
const looksLikeCall = (c: string) =>
  CALL_CHARS.test(c) && HAS_DIGIT.test(c) && HAS_LETTER.test(c);

/** Field Day sends a number and a class letter; Winter Field Day its own set. */
const CLASS_SHAPE: Record<string, RegExp> = {
  FD:  /^\d{1,2}[A-F]$/,
  WFD: /^\d{1,2}[HIOM]$/,
};

const upper = (v: string | null | undefined) => (v ?? '').toUpperCase().trim();
const sample = (xs: string[], n = 6) => xs.slice(0, n);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function preflight(
  qsos: QSO[],
  event: Event,
  score: Score,
  bonuses: Bonuses,
): Finding[] {
  const findings: Finding[] = [];
  const isWfd = event.event_type === 'WFD';
  const valid = qsos.filter(q => !q.is_dupe);

  // ── the exchange the log recorded ─────────────────────────────────────────

  // Already computed by the scorer, and shown in the logger as a likely typo —
  // but never as something to settle before submitting. An unrecognised
  // section is a contact whose multiplier the entry does not get.
  if (score.unknown_sections.length > 0) {
    findings.push({
      id: 'unknown-sections',
      severity: 'check',
      title: `${plural(score.unknown_sections.length, 'unrecognised section')} in the log`,
      detail:
        'These are neither an ARRL/RAC section nor DX or MX, so they count for nothing. ' +
        'Usually a mistyped section; occasionally a section this build does not know about.',
      examples: sample(score.unknown_sections),
    });
  }

  const classShape = CLASS_SHAPE[event.event_type];
  if (classShape) {
    const bad = [...new Set(
      valid.map(q => upper(q.rcvd_class)).filter(c => c !== '' && !classShape.test(c)),
    )];
    if (bad.length > 0) {
      findings.push({
        id: 'class-shape',
        severity: 'check',
        title: `${plural(bad.length, 'received class')} does not look like one`,
        detail: isWfd
          ? 'Winter Field Day sends a number and H, I, O or M.'
          : 'Field Day sends a number and a letter A through F.',
        examples: sample(bad),
      });
    }
  }

  const oddCalls = [...new Set(
    valid.map(q => upper(q.callsign)).filter(c => c !== '' && !looksLikeCall(c)),
  )];
  if (oddCalls.length > 0) {
    findings.push({
      id: 'callsign-shape',
      severity: 'check',
      title: `${plural(oddCalls.length, 'callsign')} does not look like a callsign`,
      detail:
        'Judged on shape alone — a digit with letters after it — not against any list of ' +
        'known calls, since Field Day brings out operators no contest list has heard of.',
      examples: sample(oddCalls),
    });
  }

  // The strongest busted-call signal available without an outside list, and it
  // comes from the log's own contradictions: the same station cannot have sent
  // two different exchanges.
  const byCall = new Map<string, Set<string>>();
  for (const q of valid) {
    const call = upper(q.callsign);
    if (!call) continue;
    const exch = `${upper(q.rcvd_class)} ${upper(q.rcvd_section)}`.trim();
    if (!exch) continue;
    const seen = byCall.get(call) ?? new Set<string>();
    seen.add(exch);
    byCall.set(call, seen);
  }
  const conflicting = [...byCall.entries()].filter(([, e]) => e.size > 1);
  if (conflicting.length > 0) {
    findings.push({
      id: 'exchange-conflict',
      severity: 'check',
      title: `${plural(conflicting.length, 'station')} sent two different exchanges`,
      detail:
        'One of each pair is mistyped — a station sends the same class and section all weekend. ' +
        'Worth settling: the wrong one may be the only contact giving you that section.',
      examples: sample(conflicting.map(([call, e]) => `${call}: ${[...e].join('  /  ')}`)),
    });
  }

  // ── bands the contest does not score ──────────────────────────────────────
  if (!['SES'].includes(event.event_type)) {
    const offered = new Set<string>(bandsFor(event.event_type));
    const unscored = [...new Set(valid.map(q => q.band).filter(b => !offered.has(b)))];
    if (unscored.length > 0) {
      findings.push({
        id: 'unscored-band',
        severity: 'check',
        title: `Contacts on ${plural(unscored.length, 'band')} this entry cannot score`,
        detail:
          'The entry form does not offer these, so they most likely arrived by ADIF import. ' +
          'They are in the log and in the exports, and they earn nothing.',
        examples: sample(unscored),
      });
    }
  }

  // ── what the bonuses claim ────────────────────────────────────────────────
  const letter = entryClassLetter(event.class);
  for (const def of bonusDefs(event.event_type)) {
    const claimed = def.kind === 'per-unit'
      ? (def.key === 'gota_qsos' ? score.gota_qsos > 0 || Number(bonuses[def.key] ?? 0) > 0
                                 : Number(bonuses[def.key] ?? 0) > 0)
      : !!bonuses[def.key];
    if (!claimed) continue;

    // The eligibility column of rule 7.3 — which this app has always let an
    // operator tick past, and the guides had to tell people to check by hand.
    if (letter && !def.classes.includes(letter)) {
      findings.push({
        id: `bonus-class-${def.key}`,
        severity: 'check',
        title: `${def.label} is claimed, and rule ${def.rule} does not list class ${letter}`,
        detail:
          `That bonus is for ${def.classes.join(', ')}. This entry is ${event.class}. ` +
          'Check the rule before submitting — the app does not refuse a claim, it only says so.',
      });
    }
  }

  // A coach with nobody to coach.
  if (event.event_type === 'FD' && bonuses.gota_coach && score.gota_qsos === 0) {
    findings.push({
      id: 'gota-coach-no-contacts',
      severity: 'check',
      title: 'The GOTA coach bonus is claimed with no GOTA contacts in the log',
      detail:
        'Fine if the club logs its GOTA station elsewhere. Otherwise the coach bonus ' +
        'is claimed for a station that did not operate.',
    });
  }

  // Rule 7.3.1 pays per transmitter, so the class number is worth 100 points
  // each. The class counts transmitters *capable* of operating, not ones that
  // logged, so a quiet transmitter is legitimate — hence a check, not a fix.
  if (event.event_type === 'FD' && bonuses.emergency_power) {
    const claimedTx = transmitterCount(event.class);
    const seenTx = new Set(valid.map(q => q.station_number ?? 1)).size;
    if (claimedTx > seenTx) {
      findings.push({
        id: 'transmitters-vs-log',
        severity: 'check',
        title: `Class ${event.class} claims ${claimedTx} transmitters; the log shows contacts from ${seenTx}`,
        detail:
          `The emergency power bonus pays 100 per transmitter, so this claim is worth ` +
          `${claimedTx * 100} rather than ${seenTx * 100}. Class counts transmitters able to ` +
          'operate, not ones that logged, so this can be perfectly correct — worth confirming.',
      });
    }
  }

  // ── Winter Field Day objectives the log can settle ────────────────────────
  // These multiply rather than add, so a wrong one is the most expensive claim
  // on the sheet: at OM 6 on 500 QSO points it moves the score by 3,000.
  if (isWfd) {
    const bandsWorked = new Map<string, number>();
    const modes = new Set<string>();
    for (const q of valid) {
      bandsWorked.set(q.band, (bandsWorked.get(q.band) ?? 0) + 1);
      modes.add(q.mode);
    }
    const bandsWithThree = [...bandsWorked.values()].filter(n => n >= 3).length;
    const om = (key: string) => WFD_OBJECTIVES.find(o => o.key === key);

    const bandGoals: Array<[keyof Bonuses, number]> = [['wfd_six_bands', 6], ['wfd_twelve_bands', 12]];
    for (const [key, need] of bandGoals) {
      if (!bonuses[key] || bandsWithThree >= need) continue;
      const def = om(key);
      findings.push({
        id: `wfd-${String(key)}`,
        severity: 'fix',
        title: `"${def?.label}" is claimed, and the log shows ${bandsWithThree}`,
        detail:
          `Only ${plural(bandsWithThree, 'band')} has three or more contacts. This objective is ` +
          `worth OM ${def?.om}, and the objective multiplier multiplies every QSO point — so ` +
          'claiming it wrongly moves the whole score, not a fixed number of points.',
      });
    }

    if (bonuses.wfd_multi_mode && modes.size < 2) {
      findings.push({
        id: 'wfd-multi-mode',
        severity: 'fix',
        title: `"${om('wfd_multi_mode')?.label}" is claimed, and the log has one mode`,
        detail: `Every contact is ${[...modes][0] ?? 'unlogged'}. Worth OM ${om('wfd_multi_mode')?.om}, and it multiplies.`,
      });
    }

    const satBands = valid.filter(q => q.band === 'SAT').length;
    for (const key of ['wfd_sat_fm', 'wfd_sat_ssb_cw'] as const) {
      if (bonuses[key] && satBands === 0) {
        findings.push({
          id: `wfd-${key}`,
          severity: 'fix',
          title: `"${om(key)?.label}" is claimed, and the log has no satellite contact`,
          detail:
            'Nothing in the log is on the SAT band. Log the satellite contact or drop the ' +
            `objective — it is worth OM ${om(key)?.om}, and it multiplies.`,
        });
      }
    }

    // Six *continuous* hours needs a judgement about what a break is, so only
    // the case the log flatly contradicts is reported: a log that does not
    // span six hours cannot contain six continuous ones.
    if (bonuses.wfd_six_hours && valid.length > 1) {
      const times = valid
        .map(q => new Date(q.datetime_utc).getTime())
        .filter(Number.isFinite);
      if (times.length > 1) {
        const spanHours = (Math.max(...times) - Math.min(...times)) / 3_600_000;
        if (spanHours < 6) {
          findings.push({
            id: 'wfd-six-hours',
            severity: 'fix',
            title: `"${om('wfd_six_hours')?.label}" is claimed, and the log spans ${spanHours.toFixed(1)} hours`,
            detail:
              'First contact to last is under six hours, so six continuous hours of operating ' +
              `is not in this log. Worth OM ${om('wfd_six_hours')?.om}, and it multiplies.`,
          });
        }
      }
    }
  }

  // Deliberately unsorted beyond this: `fix` first, then the order above,
  // which runs from the log outward to the claims made about it.
  return [...findings.filter(f => f.severity === 'fix'),
          ...findings.filter(f => f.severity === 'check')];
}

/** Everything that could not be checked, named — so a quiet report is not read
 *  as a clean bill of health for things nothing looked at. */
export const NOT_CHECKED = [
  'Whether a callsign is real. Field Day brings out operators no contest list has heard of, ' +
  'and the Super Check Partial file is not always downloaded.',
  'Whether a bonus actually happened — the visit, the message, the demonstration.',
  'Duplicate contacts, which are already excluded from the score as they are logged.',
] as const;

export { isARRLSection, DX_EXCHANGE, MX_EXCHANGE };
