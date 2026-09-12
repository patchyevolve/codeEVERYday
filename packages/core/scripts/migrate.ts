import "dotenv/config";
import { runMigrations } from "../src/db/migrate.js";

const url = process.env.DATABASE_URL ?? "postgres://cpd:cpd@localhost:5433/cpd";

runMigrations(url)
  .then(() => {
    console.log(`Migrations applied to ${url}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });