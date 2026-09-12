import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { seedV2 } from "@cpd/curriculum";

const url = process.env.DATABASE_URL ?? "postgres://cpd:cpd@localhost:5433/cpd";

async function main() {
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool);
  const result = await seedV2(db);
  console.log(`Seeded curriculum v2: ${JSON.stringify(result)}`);
  await pool.end();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });