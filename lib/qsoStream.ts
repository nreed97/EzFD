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
