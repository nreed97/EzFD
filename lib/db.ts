import { Pool } from 'pg';

// Singleton pool — shared across hot reloads in dev, single instance in prod
const g = globalThis as typeof globalThis & { _pgPool?: Pool };

export function getPool(): Pool {
  if (!g._pgPool) {
    g._pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.EZFD_DB_POOL_MAX) || 10,
      // A query that runs for a minute is a bug or a lock, not a slow
      // request — even restoring a whole weekend takes seconds — and holding a
      // pooled connection that long starves the rest.
      statement_timeout: 60_000,
    });
    // An idle pooled connection that the server drops (a PostgreSQL restart,
    // an admin terminating backends) emits 'error' on the pool. Unhandled, that
    // is an uncaughtException; the pool discards the client and the next query
    // gets a fresh one, so logging it is all that is needed.
    g._pgPool.on('error', err => {
      console.error('[db] idle connection lost:', err.message);
    });
  }
  return g._pgPool;
}
