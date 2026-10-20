import { randomInt, timingSafeEqual } from 'crypto';

/**
 * Whether a request may do what EZFD_ADMIN_KEY guards: creating, restoring
 * and merging events. With no key configured, anyone may — that is the
 * IP-only field server, where the network is the boundary.
 *
 * The comparison is constant-time. A plain `!==` returns as soon as the first
 * byte differs, which lets a patient client recover the key a byte at a time
 * from response timings.
 */
export function adminKeyOk(supplied: unknown): boolean {
  const required = process.env.EZFD_ADMIN_KEY;
  if (!required) return true;
  if (typeof supplied !== 'string' || !supplied) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(required);
  return a.length === b.length && timingSafeEqual(a, b);
}

const JOIN_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Six characters from an alphabet with no 0/O or 1/I, from the CSPRNG.
 *  The join code is the only credential an event has, so it must not come
 *  from `Math.random()`, whose output can be predicted from earlier values. */
export function generateJoinCode(): string {
  return Array.from({ length: 6 }, () => JOIN_CHARS[randomInt(JOIN_CHARS.length)]).join('');
}
