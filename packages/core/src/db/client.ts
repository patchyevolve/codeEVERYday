import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

export type DB = NodePgDatabase<typeof schema>;

export function createPool(databaseUrl: string): Pool {
  return new Pool({
    connectionString: databaseUrl,
    max: 20,
    idleTimeoutMillis: 30_000
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