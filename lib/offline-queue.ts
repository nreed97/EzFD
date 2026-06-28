import type { Band, Mode } from './types';

const QUEUE_PREFIX = 'ezfd_queue_';

export interface PendingQSO {
  local_id: string;
  submitted_at: string;
  event_id: string;
  callsign: string;
  band: Band;
  mode: Mode;
  rcvd_class: string;
  rcvd_section: string;
  operator_call: string;
  station_number: number;
}

function queueKey(eventId: string) {
  return `${QUEUE_PREFIX}${eventId}`;
}

export function loadQueue(eventId: string): PendingQSO[] {
  try {
    const raw = localStorage.getItem(queueKey(eventId));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveQueue(eventId: string, queue: PendingQSO[]) {
  try {
    localStorage.setItem(queueKey(eventId), JSON.stringify(queue));
  } catch {
    // Storage full — degrade gracefully
  }
}

export function enqueue(eventId: string, data: Omit<PendingQSO, 'local_id' | 'submitted_at' | 'event_id'>): PendingQSO {
  const entry: PendingQSO = {
    local_id: crypto.randomUUID(),
    submitted_at: new Date().toISOString(),
    event_id: eventId,
    ...data,
  };
  const queue = loadQueue(eventId);
  queue.push(entry);
  saveQueue(eventId, queue);
  return entry;
}

export function dequeue(eventId: string, localId: string) {
  const queue = loadQueue(eventId).filter(q => q.local_id !== localId);
  saveQueue(eventId, queue);
}

export function clearQueue(eventId: string) {
  localStorage.removeItem(queueKey(eventId));
}
