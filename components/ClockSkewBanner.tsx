'use client';

import { useClockSkew, formatSkew } from '@/lib/useClockSkew';

/**
 * Warns when the server's clock disagrees with this device's.
 *
 * QSOs are stamped by the server, so a wrong server clock silently corrupts
 * every contact's time — and the operator sees plausible-looking times either
 * way. This is deliberately event-level rather than per-QSO: the condition is
 * global and persistent, so one standing banner says more than a warning on
 * each contact.
 *
 * The wording doesn't claim which clock is right. Usually it's the server (a
 * field server with no RTC and no NTP), but an operator's laptop can be the
 * wrong one just as easily, and the fix differs.
 */
export default function ClockSkewBanner() {
  const skew = useClockSkew();
  if (!skew?.significant) return null;

  const ahead = skew.skewMs > 0;

  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-red-700 bg-red-900/30 px-3 py-2 text-xs text-red-400 light:border-red-500 light:bg-red-50 light:text-red-700"
    >
      <span className="text-base leading-none">🕒</span>
      <span>
        <strong>
          This server&apos;s clock is {formatSkew(skew.skewMs)} {ahead ? 'ahead of' : 'behind'} this device.
        </strong>{' '}
        QSOs are timestamped by the server, so contacts logged now will carry
        that time. Contest logs are checked against other stations&apos; logs by
        time, so fix this before operating.
        {skew.dbDisagrees && ' The app and database clocks also disagree with each other.'}
        {' '}Set the server clock from the admin console (<span className="font-mono">Server time / clock</span>).
      </span>
    </div>
  );
}
