import { getPool } from './db';

export interface ParsedCallHistoryEntry {
  callsign: string;
  sent_class: string | null;
  section: string | null;
  name: string | null;
  user_text: string | null;
}

// N1MM publishes each contest's call history file at a URL keyed by contest
// + year (the file itself is contest-year-specific — it's compiled from that
// year's ARRL FD/WFD club registrations, unlike the evergreen MASTER.SCP).
// Override via env if N1MM changes their URL scheme.
export function n1mmCallHistoryUrl(eventType: 'FD' | 'WFD', year: number): string {
  const envOverride = eventType === 'WFD'
    ? process.env.EZFD_WFD_CALL_HISTORY_URL
    : process.env.EZFD_FD_CALL_HISTORY_URL;
  if (envOverride) return envOverride.replace('{year}', String(year));

  const slug = eventType === 'WFD' ? 'wfd' : 'fd';
  return `https://n1mmwp.hamdocs.com/mmfiles/${slug}_${year}-LAST.txt/`;
}

// The current year's file may not be published yet (e.g. creating a WFD
// event before N1MM has posted that year's history) — fall back to the
// prior year's file, which is still a reasonable prefill source.
const YEAR_FALLBACK_ATTEMPTS = 2;

async function fetchCallHistoryText(eventType: 'FD' | 'WFD', year: number): Promise<string> {
  let lastStatus = 0;
  for (let i = 0; i < YEAR_FALLBACK_ATTEMPTS; i++) {
    const url = n1mmCallHistoryUrl(eventType, year - i);
    const res = await fetch(url);
    if (res.ok) return res.text();
    lastStatus = res.status;
  }
  throw new Error(`Failed to download call history file for ${eventType} ${year} (or ${year - YEAR_FALLBACK_ATTEMPTS + 1}) — last HTTP ${lastStatus}`);
}

// Confirmed real-world FD/WFD column order — files always ship an explicit
// !!Order!! header line, which takes priority over this fallback.
const DEFAULT_ORDER = ['Call', 'Exch1', 'Sect', 'UserText'];

export function parseCallHistoryFile(text: string): ParsedCallHistoryEntry[] {
  let order = DEFAULT_ORDER;
  const entries: ParsedCallHistoryEntry[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;

    if (/^!!order!!/i.test(line)) {
      order = line.split(',').slice(1).map(f => f.trim());
      continue;
    }
    if (line.startsWith('!!')) continue; // other directives (!!Include!! etc.) — not needed for prefill

    const fields = line.split(',').map(f => f.trim());
    const row: Record<string, string> = {};
    order.forEach((name, i) => { row[name.toLowerCase()] = fields[i] ?? ''; });

    const callsign = row['call']?.toUpperCase();
    if (!callsign) continue;

    entries.push({
      callsign,
      sent_class: row['exch1']?.toUpperCase().trim() || null,
      section: (row['sect'] || row['psect'])?.toUpperCase().trim() || null,
      name: row['name']?.trim() || null,
      user_text: row['usertext']?.trim() || null,
    });
  }

  return entries;
}

const INSERT_CHUNK_SIZE = 1000;

export async function refreshCallHistory(eventId: string, eventType: 'FD' | 'WFD', year: number): Promise<{ count: number }> {
  const text = await fetchCallHistoryText(eventType, year);
  const entries = parseCallHistoryFile(text);

  const pool = getPool();
  await pool.query('DELETE FROM call_history_entries WHERE event_id = $1', [eventId]);

  for (let i = 0; i < entries.length; i += INSERT_CHUNK_SIZE) {
    const chunk = entries.slice(i, i + INSERT_CHUNK_SIZE);
    const values: unknown[] = [eventId];
    const rows = chunk.map((entry) => {
      const base = values.length; // number of params already pushed
      values.push(entry.callsign, entry.sent_class, entry.section, entry.name, entry.user_text);
      return `($1, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
    });
    await pool.query(
      `INSERT INTO call_history_entries (event_id, callsign, sent_class, section, name, user_text)
       VALUES ${rows.join(',')}
       ON CONFLICT (event_id, callsign) DO NOTHING`,
      values
    );
  }

  return { count: entries.length };
}

export async function lookupCallHistory(eventId: string, callsign: string) {
  const pool = getPool();
  const { rows } = await pool.query(
    'SELECT sent_class, section, name, user_text FROM call_history_entries WHERE event_id = $1 AND callsign = $2',
    [eventId, callsign.toUpperCase()]
  );
  return rows[0] ?? null;
}
