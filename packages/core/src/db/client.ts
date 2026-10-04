import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

export type DB = NodePgDatabase<typeof schema>;

/**
 * Pool defaults are env-tunable because the right size depends on topology:
 * every process gets its own pool, so N API replicas × DB_POOL_MAX must stay
 * well under Postgres' max_connections. `connectionTimeoutMillis` bounds the
 * wait when the pool is exhausted — without it pg blocks indefinitely and a
 * saturated pool surfaces as a hung request instead of a fast error.
 */
export function createPool(databaseUrl: string): Pool {
  return new Pool({
    connectionString: databaseUrl,
    max: Number(process.env.DB_POOL_MAX ?? 20),
    idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS ?? 30_000),
    connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS ?? 10_000),
  });
}

let _db: DB | null = null;
let _pool: Pool | null = null;

export function getDb(): DB {
  if (!_db) {
    const url = process.env.DATABASE_URL ?? "postgres://localhost:5432/cpd";
    _pool = createPool(url);
    _db = drizzle(_pool, { schema });
  }
  return _db;
}

export async function resetDbInstance(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
  _db = null;
}

export { schema };