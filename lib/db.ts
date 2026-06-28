import { Pool } from 'pg';

// Singleton pool — shared across hot reloads in dev, single instance in prod
const g = globalThis as typeof globalThis & { _pgPool?: Pool };

export function getPool(): Pool {
  if (!g._pgPool) {
    g._pgPool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return g._pgPool;
}
