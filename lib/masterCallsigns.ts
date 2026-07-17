import { getPool } from './db';

// MASTER.SCP ("Super Check Partial") — a single evergreen list of known
// callsigns shared by every contest logger (N1MM, Logger32, etc.), updated
// by AD1C ahead of major contests. Not contest- or event-specific, so it's
// cached globally instead of per-event.
const MASTER_SCP_URL = process.env.EZFD_MASTER_SCP_URL || 'https://www.supercheckpartial.com/downloads/MASTER.SCP';
const STALE_MS = 24 * 60 * 60 * 1000;
const INSERT_CHUNK_SIZE = 2000;

export function parseMasterScp(text: string): string[] {
  const calls = new Set<string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('!') || line.startsWith('#')) continue;
    const call = line.split(/\s+/)[0]?.toUpperCase();
    if (call && /^[A-Z0-9/]+$/.test(call)) calls.add(call);
  }
  return [...calls];
}

export async function refreshMasterCallsignsIfStale(): Promise<void> {
  const pool = getPool();
  const { rows } = await pool.query('SELECT MAX(updated_at) AS last FROM master_callsigns');
  const last = rows[0]?.last ? new Date(rows[0].last) : null;
  if (last && Date.now() - last.getTime() < STALE_MS) return;

  const res = await fetch(MASTER_SCP_URL);
  if (!res.ok) throw new Error(`Failed to download master callsign file (HTTP ${res.status})`);
  const text = await res.text();
  const calls = parseMasterScp(text);
  if (calls.length === 0) throw new Error('Master callsign file downloaded but contained no callsigns');

  await pool.query('TRUNCATE master_callsigns');
  for (let i = 0; i < calls.length; i += INSERT_CHUNK_SIZE) {
    const chunk = calls.slice(i, i + INSERT_CHUNK_SIZE);
    const values: string[] = [];
    const rows = chunk.map((call, idx) => {
      values.push(call);
      return `($${idx + 1})`;
    });
    await pool.query(
      `INSERT INTO master_callsigns (callsign) VALUES ${rows.join(',')} ON CONFLICT DO NOTHING`,
      values
    );
  }
}

export async function isKnownMasterCallsign(callsign: string): Promise<boolean> {
  const pool = getPool();
  const { rows } = await pool.query('SELECT 1 FROM master_callsigns WHERE callsign = $1', [callsign.toUpperCase()]);
  return rows.length > 0;
}
