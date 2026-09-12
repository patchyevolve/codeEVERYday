import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { z } from "zod";
import {
  users,
  userPreferences,
  dailySessions,
  dailyTasks,
  contentItems,
  domainNodes,
  domainEdges,
  userConceptState,
  streaks,
  xpLedger,
  userGoals,
  goalMilestones,
  dailyCompletions,
  submissions,
  executions,
  mistakes,
  userLearningPath,
  hashPassword,
  verifyPassword,
  todayLocal,
  createPool,
  type ContentPayload
} from "@cpd/core";
import { createContainer, buildLearnerProfile, evaluateSubmission, debugAssist, type Container } from "@cpd/ai";
import type { DB } from "@cpd/core";
import { currentUserId, setSessionCookie, clearSessionCookie } from "./auth.js";
import { sanitizePayload } from "./sanitize.js";

export interface AppContext {
  db: DB;
  pool: Pool;
  container: Container;
}

export interface BuildAppOptions {
  ctx?: AppContext;
  logger?: boolean | object;
  disableRateLimit?: boolean;
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? false,
  });

  app.register(cookie);
  app.register(cors, {
    origin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
    credentials: true,
  });
  app.register(helmet);
  if (!opts.disableRateLimit) {
    app.register(rateLimit, {
      max: 100,
      timeWindow: "1 minute",
    });
  }

  let ctx: AppContext;
  if (opts.ctx) {
    ctx = opts.ctx;
  } else {
    const pool = createPool(process.env.DATABASE_URL ?? "postgres://localhost:5432/cpd");
    try {
      const schemaObj = { users, userPreferences, dailySessions, dailyTasks, contentItems, domainNodes, domainEdges, userConceptState, streaks, xpLedger, userGoals, goalMilestones, dailyCompletions, submissions, executions, mistakes, userLearningPath };
      const db = drizzle(pool, { schema: schemaObj }) as unknown as DB;
      const container = createContainer(db);
      ctx = { db, pool, container };
    } catch (err) {
      await pool.end().catch(() => {});
      throw err;
    }
  }

  const { db, pool, container } = ctx;

  if (!opts.ctx) {
    app.addHook("onClose", async () => {
      await pool.end();
    });
  }

  /* ─── helpers ──────────────────────────────────────────────── */

  function requireAuth(req: FastifyRequest, reply: FastifyReply): string | null {
    const userId = currentUserId(req);
    if (!userId) {
      reply.code(401).send({ error: "unauthorized" });
      return null;
    }
    return userId;
  }

  async function prefRow(userId: string) {
    const [pref] = await db.select().from(userPreferences).where(eq(userPreferences.userId, userId));
    return pref;
  }

  async function streakFor(userId: string) {
    const [s] = await db.select().from(streaks).where(eq(streaks.userId, userId));
    return s ?? null;
  }

  async function todaySession(userId: string, tz: string) {
    const today = todayLocal(tz);
    const [existing] = await db
      .select()
      .from(dailySessions)
      .where(and(eq(dailySessions.userId, userId), eq(dailySessions.localDate, today)))
      .orderBy(dailySessions.createdAt);
    if (existing && existing.status !== "COMPLETED") return existing;
    return existing ?? null;
  }

  async function tasksForSession(sessionId: string) {
    return db
      .select()
      .from(dailyTasks)
      .where(eq(dailyTasks.sessionId, sessionId))
      .orderBy(dailyTasks.position);
  }

  function taskView(t: typeof dailyTasks.$inferSelect, payload: ContentPayload | null) {
    return {
      id: t.id,
      kind: t.kind,
      position: t.position,
      title: t.title,
      estMinutes: t.estMinutes,
      required: t.required,
      status: t.status,
      completedAt: t.completedAt,
      content: payload ? sanitizePayload(payload) : null
    };
  }

  /* ─── auth ──────────────────────────────────────────────────── */

  const registerSchema = z.object({
    email: z.string().email(),
    name: z.string().min(1).max(80),
    password: z.string().min(8).max(200),
    languageKey: z.enum(["cpp", "python", "rust", "c", "bash", "js", "asm", "sql"]).default("cpp"),
    timezone: z.string().default("UTC")
  });

  app.post("/api/auth/register", { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } }, async (req, reply) => {
    const body = registerSchema.parse(req.body);
    const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, body.email));
    if (existing.length > 0) return reply.code(409).send({ error: "email already registered" });
    const user = await db
      .insert(users)
      .values({ email: body.email, name: body.name, passwordHash: hashPassword(body.password) })
      .returning({ id: users.id, email: users.email, name: users.name })
      .then((r) => r[0]!);
    await db
      .insert(userPreferences)
      .values({
        userId: user.id,
        languageKey: body.languageKey,
        timezone: body.timezone,
        dailyMinutes: 45,
        startTimeLocal: "09:00"
      })
      .onConflictDoNothing();
    setSessionCookie(reply, user.id);
    return { user: { id: user.id, email: user.email, name: user.name } };
  });

  const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

  app.post("/api/auth/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = loginSchema.parse(req.body);
    const [user] = await db.select().from(users).where(eq(users.email, body.email));
    if (!user || !verifyPassword(body.password, user.passwordHash)) {
      return reply.code(401).send({ error: "invalid credentials" });
    }
    setSessionCookie(reply, user.id);
    return { user: { id: user.id, email: user.email, name: user.name } };
  });

  app.post("/api/auth/logout", async (_req, reply) => {
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get("/api/me", async (req, reply) => {
    const userId = requireAuth(req, reply);
    if (!userId) return;
    const user = await db.select().from(users).where(eq(users.id, userId)).then((r) => r[0]);
    if (!user) {
      clearSessionCookie(reply);
      return reply.code(401).send({ error: "user not found" });
    }
    const pref = await prefRow(userId);
    const streak = await streakFor(userId);
    return {
      user: { id: user.id, email: user.email, name: user.name, level: user.level, totalXp: user.totalXp },
      preferences: pref,
      streak
    };
  });

  /* ─── onboarding ────────────────────────────────────────────── */

  const onboardingSchema = z.object({
    languageKey: z.enum(["cpp", "python", "rust", "c", "bash", "js", "asm", "sql"]),
    timezone: z.string().min(1),
    dailyMinutes: z.number().int().min(10).max(240).default(45),
    goals: z
      .array(
        z.object({
          domain: z.enum(["NETWORKING", "CYBERSECURITY", "LOW_LEVEL", "AI_ENGINEERING", "WEBDEV", "SYSTEMS", "GENERAL"]),
          title: z.string().min(3),
          description: z.string().optional(),
          horizonDays: z.number().int().min(30).max(730).default(180),
          milestones: z.array(z.string().min(3)).min(1).max(10)
        })
      )
      .max(5)
  });

  app.post("/api/onboarding", async (req, reply) => {
    const userId = requireAuth(req, reply);
    if (!userId) return;
    const body = onboardingSchema.parse(req.body);

    await db
      .update(userPreferences)
      .set({ languageKey: body.languageKey, timezone: body.timezone, dailyMinutes: body.dailyMinutes })
      .where(eq(userPreferences.userId, userId));

    for (const [gi, g] of body.goals.entries()) {
      const goal = await db
        .insert(userGoals)
        .values({ userId, domain: g.domain, title: g.title, description: g.description ?? null, horizonDays: g.horizonDays, position: gi })
        .returning({ id: userGoals.id })
        .then((r) => r[0]!);
      for (const [mi, m] of g.milestones.entries()) {
        await db.insert(goalMilestones).values({
          goalId: goal.id,
          title: m,
          definition: m,
          position: mi,
          status: mi === 0 ? "ACTIVE" : "LOCKED"
        });
      }
    }
    return { ok: true };
  });

  /* ─── dashboard / today ─────────────────────────────────────── */

  app.get("/api/dashboard", async (req, reply) => {
    const userId = requireAuth(req, reply);
    if (!userId) return;
    const pref = await prefRow(userId);
    const tz = pref?.timezone ?? "UTC";
    const streak = await streakFor(userId);

    const weak = await db
      .select({ nodeKey: domainNodes.nodeKey, label: domainNodes.label, state: userConceptState.state, mastery: userConceptState.mastery })
      .from(userConceptState)
      .innerJoin(domainNodes, eq(domainNodes.id, userConceptState.nodeId))
      .where(and(eq(userConceptState.userId, userId), sql`${userConceptState.state} IN ('WEAK', 'REVIEW_REQUIRED', 'DECAYING')`));

    const goals = await db
      .select({
        id: userGoals.id,
        domain: userGoals.domain,
        title: userGoals.title,
        status: userGoals.status,
        position: userGoals.position,
        milestoneId: goalMilestones.id,
        milestoneTitle: goalMilestones.title,
        milestoneStatus: goalMilestones.status,
        milestonePosition: goalMilestones.position
      })
      .from(userGoals)
      .leftJoin(goalMilestones, eq(goalMilestones.goalId, userGoals.id))
      .where(eq(userGoals.userId, userId))
      .orderBy(userGoals.position, goalMilestones.position);

    const session = await todaySession(userId, tz);
    return { streak, weak, goals, today: session ? { id: session.id, kind: session.kind, status: session.status, plannedMinutes: session.plannedMinutes } : null };
  });

  app.get("/api/today", async (req, reply) => {
    const userId = requireAuth(req, reply);
    if (!userId) return;
    const pref = await prefRow(userId);
    const tz = pref?.timezone ?? "UTC";

    let session = await todaySession(userId, tz);
    if (session && session.status === "COMPLETED") {
      await db.delete(dailySessions).where(eq(dailySessions.id, session.id));
      session = null;
    }
    if (!session) {
      const profile = await buildLearnerProfile(container.learnerDeps, userId);
      const objective = await container.tutorEngine.decideObjective(userId, profile);
      const composed = await container.tutorEngine.composeSession(userId, profile, objective);
      const s = await db.select().from(dailySessions).where(eq(dailySessions.id, composed.sessionId)).then((r) => r[0]);
      session = s ?? null;
    }
    if (!session) return reply.code(500).send({ error: "could not compose session" });

    const tasks = await tasksForSession(session.id);
    const items = await db
      .select()
      .from(contentItems)
      .where(inArray(contentItems.id, tasks.map((t) => t.contentItemId)));
    const itemById = new Map(items.map((i) => [i.id, i]));

    return {
      session: { id: session.id, kind: session.kind, status: session.status, plannedMinutes: session.plannedMinutes, completedAt: session.completedAt },
      tasks: tasks.map((t) => {
        const item = t.contentItemId ? itemById.get(t.contentItemId) : null;
        return taskView(t, item ? (item.payload as ContentPayload) : null);
      })
    };
  });

  /* ─── tasks ─────────────────────────────────────────────────── */

  async function loadTask(userId: string, taskId: string, reply: FastifyReply) {
    const [task] = await db.select().from(dailyTasks).where(eq(dailyTasks.id, taskId));
    if (!task) {
      reply.code(404).send({ error: "task not found" });
      return null;
    }
    const [session] = await db.select().from(dailySessions).where(eq(dailySessions.id, task.sessionId));
    if (!session || session.userId !== userId) {
      reply.code(403).send({ error: "not your task" });
      return null;
    }
    const [item] = task.contentItemId ? await db.select().from(contentItems).where(eq(contentItems.id, task.contentItemId)) : [undefined];
    return { task, session, item: item ?? null };
  }

  app.get("/api/tasks/:id", async (req, reply) => {
    const userId = requireAuth(req, reply);
    if (!userId) return;
    const { id } = req.params as { id: string };
    const loaded = await loadTask(userId, id, reply);
    if (!loaded) return;
    const { task, item } = loaded;
    const attempt = await db
      .select({ n: count() })
      .from(submissions)
      .where(and(eq(submissions.taskId, task.id), eq(submissions.userId, userId)))
      .then((r) => r[0]!.n);
    return taskView(task, item ? (item.payload as ContentPayload) : null).content
      ? { ...taskView(task, item ? (item.payload as ContentPayload) : null), attempt }
      : { ...taskView(task, null), attempt };
  });

  app.get("/api/tasks/:id/hints", async (req, reply) => {
    const userId = requireAuth(req, reply);
    if (!userId) return;
    const { id } = req.params as { id: string };
    const loaded = await loadTask(userId, id, reply);
    if (!loaded) return;
    const { task, item } = loaded;
    if (!item) return reply.code(404).send({ error: "no content" });
    const payload = item.payload as ContentPayload;
    if (!("hints" in payload)) return { hints: [] };
    const used = Number((req.query as { used?: string }).used ?? 0);
    return { hints: payload.hints.filter((h) => h.threshold <= used).map((h) => h.text) };
  });

  const submitSchema = z.object({
    answer: z.unknown().optional(),
    code: z.string().max(200_000).optional(),
    language: z.string().optional(),
    hintsUsed: z.number().int().min(0).default(0),
    durationMs: z.number().int().min(0).optional(),
    completed: z.boolean().optional()
  });

  app.post("/api/tasks/:id/submit", async (req, reply) => {
    const userId = requireAuth(req, reply);
    if (!userId) return;
    const { id } = req.params as { id: string };
    const body = submitSchema.parse(req.body);
    const result = await evaluateSubmission(
      { submissions: container.submissionRepo, streaks: container.streakRepo },
      {
        userId,
        taskId: id,
        answer: body.answer,
        code: body.code,
        language: body.language,
        hintsUsed: body.hintsUsed,
        durationMs: body.durationMs,
        completed: body.completed
      }
    );
    return result;
  });

  app.post("/api/tasks/:id/debug-assist", async (req, reply) => {
    const userId = requireAuth(req, reply);
    if (!userId) return;
    const body = z.object({ submissionId: z.string().min(1) }).parse(req.body);
    const result = await debugAssist(
      { submissions: container.submissionRepo, streaks: container.streakRepo },
      { userId, submissionId: body.submissionId }
    );
    return result;
  });

  /* ─── graph ─────────────────────────────────────────────────── */

  app.get("/api/graph", async (req, reply) => {
    const userId = requireAuth(req, reply);
    if (!userId) return;
    const nodes = await db.select().from(domainNodes);
    const edges = await db.select().from(domainEdges);
    const states = await db
      .select({ nodeId: userConceptState.nodeId, state: userConceptState.state, mastery: userConceptState.mastery, nextReviewAt: userConceptState.nextReviewAt })
      .from(userConceptState)
      .where(eq(userConceptState.userId, userId));
    const stateById = new Map(states.map((s) => [s.nodeId, s]));
    return {
      nodes: nodes.map((n) => ({ id: n.id, nodeKey: n.nodeKey, label: n.label, difficulty: n.difficulty, estMinutes: n.estMinutes, depth: n.depth, languageKey: n.languageKey, ...(stateById.get(n.id) ?? {}) })),
      edges: edges.map((e) => ({ fromId: e.fromId, toId: e.toId, kind: e.kind }))
    };
  });

  /* ─── settings + notifications ──────────────────────────────── */

  app.get("/api/settings", async (req, reply) => {
    const userId = requireAuth(req, reply);
    if (!userId) return;
    const pref = await prefRow(userId);
    return { preferences: pref };
  });

  const settingsSchema = z.object({
    dailyMinutes: z.number().int().min(10).max(240).optional(),
    startTimeLocal: z.string().optional(),
    timezone: z.string().optional(),
    difficultyPref: z.number().int().min(1).max(5).optional(),
    quietHoursEnabled: z.boolean().optional(),
    quietHours: z.object({ start: z.string(), end: z.string() }).nullable().optional(),
    weeklySchedule: z.record(z.string(), z.boolean()).optional(),
    restDays: z.array(z.string()).optional()
  });

  app.put("/api/settings", async (req, reply) => {
    const userId = requireAuth(req, reply);
    if (!userId) return;
    const body = settingsSchema.parse(req.body);
    await db.update(userPreferences).set(body as never).where(eq(userPreferences.userId, userId));
    return { ok: true };
  });

  app.get("/api/notifications", async (req, reply) => {
    const userId = requireAuth(req, reply);
    if (!userId) return;
    const pref = await prefRow(userId);
    const tz = pref?.timezone ?? "UTC";
    const streak = await streakFor(userId);
    const out: { kind: string; message: string; at?: string }[] = [];

    if (streak && streak.brokenAt) out.push({ kind: "STREAK_BROKEN", message: `Your ${streak.longestLength}-day best was broken. Get back on track today.` });

    const reviewDue = await db
      .select({ label: domainNodes.label })
      .from(userConceptState)
      .innerJoin(domainNodes, eq(domainNodes.id, userConceptState.nodeId))
      .where(and(eq(userConceptState.userId, userId), sql`${userConceptState.nextReviewAt} <= now()`))
      .limit(5);
    for (const r of reviewDue) out.push({ kind: "REVIEW_DUE", message: `Review due: ${r.label}.` });

    const weak = await db
      .select({ label: domainNodes.label })
      .from(userConceptState)
      .innerJoin(domainNodes, eq(domainNodes.id, userConceptState.nodeId))
      .where(and(eq(userConceptState.userId, userId), sql`${userConceptState.state} IN ('WEAK', 'REVIEW_REQUIRED')`))
      .limit(5);
    for (const w of weak) out.push({ kind: "WEAK_NODE", message: `You struggled with ${w.label}. Today's tutor plan will repair it.` });

    const session = await todaySession(userId, tz);
    if (!session) out.push({ kind: "SESSION", message: "Your daily session is ready." });
    else if (session.status === "COMPLETED") out.push({ kind: "SESSION", message: "Session complete — come back tomorrow." });
    else out.push({ kind: "SESSION", message: "Today's session is waiting for you." });

    return { notifications: out };
  });

  app.setErrorHandler((err: Error & { statusCode?: number; validation?: unknown }, _req, reply) => {
    if (err instanceof z.ZodError) {
      return reply.code(400).send({ error: "validation error", details: err.issues });
    }
    if (err.statusCode) {
      return reply.code(err.statusCode).send({ error: err.message });
    }
    app.log.error(err);
    return reply.code(500).send({ error: "internal server error" });
  });

  await app.ready();
  return app;
}
