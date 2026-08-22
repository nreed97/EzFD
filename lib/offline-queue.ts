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
  // SES exchange — absent on contest QSOs.
  rst_sent?: string;
  rst_rcvd?: string;
  rcvd_name?: string;
  rcvd_qth?: string;
  rcvd_grid?: string;
  comment?: string;
}

function queueKey(eventId: string) {
  return `${QUEUE_PREFIX}${eventId}`;
}

// crypto.randomUUID() requires a secure context (HTTPS/localhost).
// Fall back to getRandomValues-based UUID v4 for plain-HTTP testing.
function randomUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  return [...b].map((v, i) =>
    ([4, 6, 8, 10].includes(i) ? '-' : '') + v.toString(16).padStart(2, '0')
  ).join('');
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
    local_id: randomUUID(),
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
