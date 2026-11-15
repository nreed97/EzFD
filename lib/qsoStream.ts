import type { QSO } from './types';

/**
 * Apply one realtime QSO event to a list.
 *
 * This exists because soft delete changed the shape of the stream. A delete
 * used to arrive as `op: 'DELETE'` and every listener dropped the row; now the
 * row is only marked, so it arrives as an `UPDATE` carrying `deleted_at`. A
 * listener that just replaces the row on UPDATE would leave deleted contacts
 * on screen in every *other* operator's window — visible to everyone except
 * the person who deleted it.
 *
 * Restore has the mirror problem: it is also an UPDATE, on a row the listener
 * has already dropped, so it has to be re-added rather than replaced.
 *
 * Three components consume this stream (the logger, the CW popout and the
 * dashboard). One rule, in one place — a divergent fourth copy of a list
 * update is exactly how this codebase has been bitten before.
 */
export function applyQsoEvent(prev: QSO[], op: string, record: QSO, newestFirst: boolean): QSO[] {
  const withoutIt = prev.filter(q => q.id !== record.id);

  // A soft-deleted contact leaves every live view, however it got that way.
  if (record.deleted_at) return withoutIt;

  if (op === 'DELETE') return withoutIt;

  // INSERT, UPDATE, or a restore of something previously dropped: put it back
  // exactly once, without disturbing the order of anything else.
  if (prev.some(q => q.id === record.id)) {
    return prev.map(q => (q.id === record.id ? record : q));
  }
  return newestFirst ? [record, ...withoutIt] : [...withoutIt, record];
}

/**
 * Refetch the log after the live stream reconnects.
 *
 * The stream carries changes, not state, and nothing is replayed to a window
 * that was not connected when a change was announced. So a window that sat
 * through a server restart or a flaky link came back showing the log as it
 * was when the stream dropped: contacts other operators logged in the gap
 * were missing from the list, from the score and — the one that costs points —
 * from the dupe check, until somebody reloaded the page.
 *
 * `saw` records the events that arrive while the fetch is in flight, and they
 * are applied on top of the snapshot. Without that a contact announced after
 * the server ran the query but before the answer landed would be overwritten
 * by a snapshot that predates it, which is the same gap again, only narrower.
 *
 * A failed fetch changes nothing: the list on screen is still the best one
 * there is, and the next reconnect tries again.
 */
export function createLogCatchUp(
  eventId: string,
  newestFirst: boolean,
  replace: (rows: QSO[]) => void,
) {
  let during: { op: string; record: QSO }[] | null = null;
  return {
    saw(op: string, record: QSO) { during?.push({ op, record }); },
    async run() {
      if (during) return;   // one already in flight
      during = [];
      try {
        const res = await fetch(`/api/qso?event_id=${eventId}`, { cache: 'no-store' });
        if (!res.ok) return;
        // The route answers newest first.
        let rows = await res.json() as QSO[];
        if (!newestFirst) rows = rows.reverse();
        for (const ev of during) rows = applyQsoEvent(rows, ev.op, ev.record, newestFirst);
        replace(rows);
      } catch {
        // Still unreachable. The next reconnect runs this again.
      } finally {
        during = null;
      }
    },
  };
}
