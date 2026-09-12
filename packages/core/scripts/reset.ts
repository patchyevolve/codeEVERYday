import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { sql } from "drizzle-orm";
import { runMigrations } from "../src/db/migrate.js";

const url = process.env.DATABASE_URL ?? "postgres://cpd:cpd@localhost:5433/cpd";

async function main() {
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool);
  await db.execute(sql`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
  await pool.end();
  await runMigrations(url);
  console.log(`Database reset and migrated: ${url}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Reset failed:", err);
    process.exit(1);
  });