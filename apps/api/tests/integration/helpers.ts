import "dotenv/config";
import { buildApp, type AppContext } from "../../src/app.js";
import { signSession } from "../../src/auth.js";

if (!process.env.API_SESSION_SECRET) {
  process.env.API_SESSION_SECRET = "test-secret-for-integration-tests";
}
import { createPool, type DB } from "@cpd/core";
import { drizzle } from "drizzle-orm/node-postgres";
import { createContainer, type Container } from "@cpd/ai";
import { users, userPreferences, dailySessions, dailyTasks, contentItems, domainNodes, domainEdges, userConceptState, streaks, xpLedger, userGoals, goalMilestones, dailyCompletions, submissions, executions, mistakes, userLearningPath } from "@cpd/core";
import { Pool } from "pg";
import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";

let pool: Pool;
let db: DB;
let container: Container;

export async function setupTestApp(): Promise<FastifyInstance> {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const schemaObj = { users, userPreferences, dailySessions, dailyTasks, contentItems, domainNodes, domainEdges, userConceptState, streaks, xpLedger, userGoals, goalMilestones, dailyCompletions, submissions, executions, mistakes, userLearningPath };
  db = drizzle(pool, { schema: schemaObj }) as unknown as DB;
  container = createContainer(db);

  const app = await buildApp({
    ctx: { db, pool, container },
    logger: {
      level: "error",
      transport: { target: "pino/file", options: { destination: 2 } },
    },
    disableRateLimit: true,
  });

  return app;
}

export async function teardownTestApp(app: FastifyInstance): Promise<void> {
  await app.close();
  await pool.end();
}

export async function cleanupTestUsers(p?: Pool): Promise<void> {
  const p2 = p ?? new Pool({ connectionString: process.env.DATABASE_URL });
  const d = drizzle(p2);
  await d.execute(sql`DELETE FROM users WHERE email LIKE '%@example.com'`);
  if (!p) await p2.end();
}

export function makeSessionCookie(userId: string): string {
  return signSession({ uid: userId, exp: Math.floor(Date.now() / 1000) + 3600 });
}

export function authHeaders(userId: string): Record<string, string> {
  return { cookie: `cpd_session=${makeSessionCookie(userId)}` };
}

export { db, container };
