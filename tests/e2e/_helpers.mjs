/**
 * Shared environment for the E2E suites.
 *
 * Everything that varies between machines/clone paths is read from the
 * environment with sensible defaults, so the suite runs against whatever
 * stack you have up rather than only the original author's container names.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

/** Docker container running Postgres (compose names it <project>_postgres_1). */
export const PG_CONTAINER = process.env.PG_CONTAINER ?? "codepracticedaily-postgres-1";
/** Postgres superuser. */
export const PG_USER = process.env.PG_USER ?? "cpd";
/** Database the application (and these tests) point at. */
export const DB_NAME = process.env.PSQL_DB ?? "cpd";

export const API = process.env.E2E_API_URL ?? "http://localhost:4000";
export const WEB = process.env.E2E_WEB_URL ?? "http://localhost:5173";

/** Directory for screenshots / traces written by the browser suites. */
export const ARTIFACTS_DIR = fileURLToPath(new URL("./.artifacts/", import.meta.url));

// psql appends a command tag ("INSERT 0 1", "UPDATE 3", ...) to its output.
// That is not row data, so strip it — otherwise a `... returning id` query
// yields "uuid\nINSERT 0 1" and JSON.parse blows up.
const PSQL_COMMAND_TAG = /^(INSERT|UPDATE|DELETE|SELECT|CREATE|ALTER|DROP|TRUNCATE|BEGIN|COMMIT|SET) \d+( \d+)?$/;

/** Run a single SQL statement and return trimmed stdout (tags stripped). */
export function psql(sql) {
  const out = execFileSync(
    "docker",
    ["exec", "-i", PG_CONTAINER, "psql", "-U", PG_USER, "-d", DB_NAME, "-t", "-A", "-F", "|", "-c", sql],
    { encoding: "utf8" }
  );
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !PSQL_COMMAND_TAG.test(l))
    .join("\n")
    .trim();
}

/** Run SQL and parse stdout as JSON (use `json_agg`/`row_to_json`). */
export function psqlJson(sql) {
  const out = psql(sql);
  return out ? JSON.parse(out) : null;
}

export function ensureArtifactsDir() {
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  return ARTIFACTS_DIR;
}
