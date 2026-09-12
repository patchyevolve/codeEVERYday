import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");

export async function runMigrations(databaseUrl: string, folder: string = migrationsFolder): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: folder });
  } finally {
    await pool.end();
  }
}