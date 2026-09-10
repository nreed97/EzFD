'use client';

import { useClockSkew, formatSkew, type ClockSkew } from '@/lib/useClockSkew';

/**
 * Warns when the server's clock cannot be trusted.
 *
 * QSOs are stamped by the server, so a wrong server clock silently corrupts
 * every contact's time — and the operator sees plausible-looking times either
 * way. This is deliberately event-level rather than per-QSO: the condition is
 * global and persistent, so one standing banner says more than a warning on
 * each contact.
 *
 * There are two separate things worth saying, and they arrive from opposite
 * directions:
 *
 *   * **A disagreement now.** This device and the server differ. From one
 *     device that is all it is — an operator's own laptop is wrong just as
 *     often as a server. With three or more devices agreeing, it stops being a
 *     disagreement and becomes a verdict, and the banner says so plainly,
 *     because "nine of eleven devices say the server is four minutes behind"
 *     tells an operator what to fix and the hedge does not.
 *
 *   * **Nothing is holding the clock.** No GPS, no RTC, no NTP since some date
 *     months ago. That is worth surfacing before the first contact rather than
 *     after, and it shows even when nothing currently disagrees — a clock can
 *     be adrift and unnoticed simply because nobody has connected yet.
 *
 * What is never shown is an unknown. If the server could not work out what is
 * holding its clock, that is silence, not a warning: the previous version of
 * this check asked `timedatectl` one question and warned everyone who answered
 * no, which on an offline field server means warning the operator who fitted
 * an RTC and did everything right.
 */

/** How the clock is being held, in words an operator can act on. */
function sourceLabel(source: string | null): string | null {
  switch (source) {
    case 'gps':       return 'a GPS receiver';
    case 'chrony':    return 'chrony';
    case 'timesyncd': return 'network time';
    case 'rtc':       return 'a hardware clock';
    default:          return null;
  }
}

function Banner({ tone, children }: { tone: 'red' | 'amber'; children: React.ReactNode }) {
  const cls = tone === 'red'
    ? 'border-red-700 bg-red-900/30 text-red-400 light:border-red-500 light:bg-red-50 light:text-red-700'
    : 'border-amber-700 bg-amber-900/30 text-amber-400 light:border-amber-500 light:bg-amber-50 light:text-amber-700';
  return (
    <div role="alert" className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${cls}`}>
      <span className="text-base leading-none">🕒</span>
      <span>{children}</span>
    </div>
  );
}

const CONSOLE = <span className="font-mono">Server time / clock</span>;

/** The disagreement, worded according to how much evidence there is. */
function skewMessage(skew: ClockSkew) {
  const ahead = skew.skewMs > 0;
  const q = skew.quorum;

  if (q?.serverIsWrong && q.medianSkewMs !== null) {
    const qAhead = q.medianSkewMs > 0;
    return (
      <>
        <strong>
          This server&apos;s clock is {formatSkew(q.medianSkewMs)}{' '}
          {qAhead ? 'ahead' : 'behind'}.
        </strong>{' '}
        {q.agreeing} of {q.devices} connected devices agree, so it is the server
        that is wrong rather than any one operator&apos;s device. QSOs are
        timestamped by the server, and contest logs are checked against other
        stations&apos; logs by time — fix this before operating. Set it from the
        admin console ({CONSOLE}).
      </>
    );
  }

  return (
    <>
      <strong>
        This server&apos;s clock is {formatSkew(skew.skewMs)}{' '}
        {ahead ? 'ahead of' : 'behind'} this device.
      </strong>{' '}
      QSOs are timestamped by the server, so contacts logged now will carry that
      time. Contest logs are checked against other stations&apos; logs by time,
      so fix this before operating.
      {skew.dbDisagrees && ' The app and database clocks also disagree with each other.'}
      {q && q.devices > 1
        ? ` ${q.devices} devices are connected and they do not agree with each other, so check this device's clock too.`
        : ' Only this device is reporting, so it may be this device that is wrong.'}
      {' '}Set the server clock from the admin console ({CONSOLE}).
    </>
  );
}

/** Nothing is keeping this clock honest, said before it costs anything. */
function provenanceMessage(clock: NonNullable<ClockSkew['clock']>) {
  if (clock.unaccountedFor) {
    return (
      <>
        <strong>Nothing is holding this server&apos;s clock.</strong> No network
        time, no GPS and no hardware clock, so the time it is showing came from
        its last shutdown rather than from a source. QSOs are timestamped by the
        server and this cannot be corrected after the event. Set it from the
        admin console ({CONSOLE}), or fit an RTC or GPS receiver.
      </>
    );
  }

  const held = sourceLabel(clock.source);
  return (
    <>
      <strong>
        This server&apos;s clock has not been set for {clock.ageMs !== null ? formatSkew(clock.ageMs) : 'a long time'}.
      </strong>{' '}
      {held ? `It is being held by ${held}, which drifts. ` : ''}
      Check it against a known-good clock before the first contact — QSOs are
      timestamped by the server, and the error cannot be corrected afterwards.
      Set it from the admin console ({CONSOLE}).
    </>
  );
}

export default function ClockSkewBanner() {
  const skew = useClockSkew();
  if (!skew) return null;

  // A live disagreement outranks a provenance warning: it is measured rather
  // than inferred, and it is the one with a number attached.
  if (skew.significant) {
    return <Banner tone="red">{skewMessage(skew)}</Banner>;
  }

  const clock = skew.clock;
  if (clock && (clock.unaccountedFor || clock.stale)) {
    return <Banner tone="amber">{provenanceMessage(clock)}</Banner>;
  }

  return null;
}
