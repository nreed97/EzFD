import { Client } from 'pg';
import { getPool } from './db';

/**
 * One PostgreSQL listener for the whole process, shared by every open stream.
 *
 * Each `/api/realtime` stream used to open its own `pg.Client` to run LISTEN.
 * PostgreSQL's default is 100 connections, so a hundred open tabs — or a
 * hundred requests from anybody, for event ids that did not even exist — took
 * every connection the server had, and while they were open every other API
 * call failed with a 500. A club that keeps a logger, a CW window and a
 * dashboard open per operator gets surprisingly close to that honestly, and
 * each of those backends cost memory on a small droplet.
 *
 * Now one connection LISTENs on behalf of everyone. An event's channels are
 * subscribed when its first stream opens and released when its last one
 * closes, and a notification is fanned out in memory. That relies on EzFD
 * being one `node server.js`, which `lib/clockQuorum.ts` already assumes.
 *
 * The channel names are quoted with `escapeIdentifier`, and callers only ever
 * pass an event id that has been checked as a UUID and found in the events
 * table. The old route interpolated the raw URL segment into `LISTEN "..."`
 * and sent it as a simple query, which PostgreSQL runs as several statements —
 * so a `"` in the path closed the identifier and anything after it ran.
 */

export type StreamEvent = 'qso' | 'reservation' | 'presence';

type Deliver = (event: StreamEvent, payload: string) => void;

interface Subscriber {
  deliver: Deliver;
  /** Ends the stream. Called when the shared connection is lost, so every
   *  browser reconnects and re-syncs rather than sitting on a stream that will
   *  never carry another event. */
  end: () => void;
}

const PREFIXES: { prefix: string; event: StreamEvent; table: string | null }[] = [
  { prefix: 'qsos_',     event: 'qso',         table: 'qsos' },
  { prefix: 'ses_',      event: 'reservation', table: 'ses_reservations' },
  { prefix: 'presence_', event: 'presence',    table: null },
];

/** Open streams across the process. Each holds no database connection now,
 *  but each is still a socket and a timer, and nothing else bounds them. */
export const MAX_STREAMS = Number(process.env.EZFD_MAX_STREAMS) || 2000;

interface Hub {
  client: Client | null;
  connecting: Promise<Client> | null;
  /** eventId → subscribers */
  subs: Map<string, Set<Subscriber>>;
  count: number;
}

const g = globalThis as { __ezfdRealtimeHub?: Hub };
const hub: Hub = g.__ezfdRealtimeHub ?? { client: null, connecting: null, subs: new Map(), count: 0 };
g.__ezfdRealtimeHub = hub;

function channels(eventId: string): string[] {
  return PREFIXES.map(p => p.prefix + eventId);
}

/** Drop the shared connection and end every stream on it. */
function reset() {
  const client = hub.client;
  hub.client = null;
  hub.connecting = null;
  client?.end().catch(() => {});
  for (const set of hub.subs.values()) {
    for (const sub of [...set]) sub.end();
  }
}

async function connection(): Promise<Client> {
  if (hub.client) return hub.client;
  if (hub.connecting) return hub.connecting;

  hub.connecting = (async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    client.on('error', reset);
    client.on('end', () => { if (hub.client === client) reset(); });
    client.on('notification', msg => { void dispatch(msg.channel, msg.payload); });
    await client.connect();
    hub.client = client;
    hub.connecting = null;
    return client;
  })();

  try {
    return await hub.connecting;
  } catch (err) {
    hub.connecting = null;
    throw err;
  }
}

async function dispatch(channel: string, payload: string | undefined) {
  if (!payload) return;
  const kind = PREFIXES.find(p => channel.startsWith(p.prefix));
  if (!kind) return;
  const set = hub.subs.get(channel.slice(kind.prefix.length));
  if (!set || set.size === 0) return;

  // A row too big for NOTIFY arrives as its id alone (see ezfd_notify_row in
  // db/schema.sql). Fetch it once here, for every stream, so the browser
  // still receives the shape it always has.
  let out = payload;
  try {
    const msg = JSON.parse(payload) as { op: string; id?: string; truncated?: boolean };
    if (msg.truncated && msg.id && kind.table) {
      const { rows } = await getPool().query(
        `SELECT to_jsonb(t) AS record FROM ${kind.table} t WHERE id = $1`, [msg.id]);
      out = JSON.stringify({ op: msg.op, record: rows[0]?.record ?? { id: msg.id } });
    }
  } catch {
    return;
  }
  for (const sub of set) sub.deliver(kind.event, out);
}

/**
 * Subscribe a stream to an event's channels. Resolves to an unsubscribe
 * function; rejects when the stream limit is reached or the database cannot
 * be reached, and the route then ends the stream so the browser retries.
 */
export async function subscribe(eventId: string, sub: Subscriber): Promise<() => void> {
  if (hub.count >= MAX_STREAMS) throw new Error('Too many open streams');
  const client = await connection();

  let set = hub.subs.get(eventId);
  if (!set) {
    set = new Set();
    hub.subs.set(eventId, set);
    for (const ch of channels(eventId)) {
      await client.query(`LISTEN ${client.escapeIdentifier(ch)}`);
    }
  }
  set.add(sub);
  hub.count++;

  let done = false;
  return () => {
    if (done) return;
    done = true;
    hub.count--;
    const current = hub.subs.get(eventId);
    if (!current) return;
    current.delete(sub);
    if (current.size > 0) return;
    hub.subs.delete(eventId);
    const c = hub.client;
    if (c) {
      for (const ch of channels(eventId)) {
        c.query(`UNLISTEN ${c.escapeIdentifier(ch)}`).catch(() => {});
      }
    }
  };
}

/** Close the shared connection — on shutdown, after the streams have ended. */
export function closeRealtime() {
  const client = hub.client;
  hub.client = null;
  hub.connecting = null;
  client?.end().catch(() => {});
}
