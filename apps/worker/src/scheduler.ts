import { and, eq, lte, sql } from "drizzle-orm";
import {
  dailySessions,
  notifications,
  streaks,
  userConceptState,
  userPreferences,
} from "@cpd/core";
import {
  todayLocal,
  processMiss,
  addLocalDays,
  isRestDay,
} from "@cpd/core";
import { applyDecay } from "@cpd/core";
import type { Container } from "@cpd/ai";
import type { Logger } from "pino";
import { dispatchNotifications } from "./notifications.js";
import { generateDailySessions } from "./daily-session.js";

const REMINDER_SWEEP_MIN = Number(process.env["REMINDER_SWEEP_INTERVAL_MIN"] ?? 5);
const MISSED_INTERVAL_MIN = Number(process.env["MISSED_PROCESSING_INTERVAL_MIN"] ?? 15);
const DECAY_INTERVAL_MIN = Number(process.env["DECAY_SWEEP_INTERVAL_MIN"] ?? 60);
const GENERATION_HOUR = Number(process.env["DAILY_GENERATION_HOUR"] ?? 0);
const MAX_REMINDERS = Number(process.env["NOTIFICATION_MAX_REMINDERS_PER_DAY"] ?? 6);
const PROVIDER_STATE_INTERVAL_MS = 5 * 60 * 1000;
const NOTIFICATION_DISPATCH_INTERVAL_MS = 30_000;
const JOB_HOUSEKEEPING_INTERVAL_MS = 30 * 60 * 1000;
const STALE_RUNNING_MIN = 10;

let _generatedToday = "";

export function startScheduler(
  c: Container,
  log: Logger
): NodeJS.Timeout[] {
  const intervals: NodeJS.Timeout[] = [];

  // --- Daily session generation (hourly check at the configured UTC hour) ---
  intervals.push(
    setInterval(async () => {
      const now = new Date();
      const todayKey = now.toISOString().slice(0, 10);
      if (now.getUTCHours() === GENERATION_HOUR && _generatedToday !== todayKey) {
        _generatedToday = todayKey;
        try {
          await generateDailySessions(c, log);
        } catch (err) {
          log.error({ err }, "Daily session generation failed");
          _generatedToday = "";
        }
      }
    }, 60_000)
  );

  // --- Reminder sweep ---
  intervals.push(
    setInterval(async () => {
      try {
        await sweepReminders(c, log);
      } catch (err) {
        log.error({ err }, "Reminder sweep failed");
      }
    }, REMINDER_SWEEP_MIN * 60_000)
  );

  // --- Missed session processing ---
  intervals.push(
    setInterval(async () => {
      try {
        await processMissedSessions(c, log);
      } catch (err) {
        log.error({ err }, "Missed session processing failed");
      }
    }, MISSED_INTERVAL_MIN * 60_000)
  );

  // --- Concept decay ---
  intervals.push(
    setInterval(async () => {
      try {
        await sweepConceptDecay(c, log);
      } catch (err) {
        log.error({ err }, "Concept decay sweep failed");
      }
    }, DECAY_INTERVAL_MIN * 60_000)
  );

  // --- Notification dispatch ---
  intervals.push(
    setInterval(async () => {
      try {
        await dispatchNotifications(c.db, log);
      } catch (err) {
        log.error({ err }, "Notification dispatch failed");
      }
    }, NOTIFICATION_DISPATCH_INTERVAL_MS)
  );

  // --- Provider state persistence ---
  intervals.push(
    setInterval(async () => {
      try {
        await c.saveProviderState();
      } catch (err) {
        log.error({ err }, "Provider state save failed");
      }
    }, PROVIDER_STATE_INTERVAL_MS)
  );

  // --- Job queue housekeeping ---
  intervals.push(
    setInterval(async () => {
      try {
        await cleanupJobs(c, log);
      } catch (err) {
        log.error({ err }, "Job housekeeping failed");
      }
    }, JOB_HOUSEKEEPING_INTERVAL_MS)
  );

  // Run once on startup
  dispatchNotifications(c.db, log).catch((err) =>
    log.error({ err }, "Initial notification dispatch failed")
  );

  return intervals;
}

// ─── Helper: convert Date|string|null to string|null for StreakRecord ──────

function toLocalDateStr(val: Date | string | null): string | null {
  if (val === null) return null;
  if (typeof val === "string") return val;
  return val.toISOString().slice(0, 10);
}

// ─── Reminder Sweep ──────────────────────────────────────────────────────────

async function sweepReminders(c: Container, log: Logger): Promise<void> {
  const db = c.db;
  const now = new Date();

  // Query all unstarted sessions — filter per-user by their local date
  const unstarted = await db
    .select({
      id: dailySessions.id,
      userId: dailySessions.userId,
      dueAt: dailySessions.dueAt,
      localDate: dailySessions.localDate,
    })
    .from(dailySessions)
    .where(eq(dailySessions.status, "AVAILABLE"));

  for (const session of unstarted) {
    if (!session.dueAt) continue;

    const [prefs] = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, session.userId))
      .limit(1);

    const timezone = prefs?.timezone ?? "UTC";
    const today = todayLocal(timezone);
    if (session.localDate !== today) continue;

    const dueAt = new Date(session.dueAt);
    const minutesSinceDue = (now.getTime() - dueAt.getTime()) / 60_000;

    const escalation = prefs?.escalation ?? {
      stepsMinutes: [30, 90, 180],
      strongAt: 360,
      windowEnd: "21:00",
    };

    const windowParts = (escalation.windowEnd ?? "21:00").split(":");
    const endH = Number(windowParts[0] ?? "21");
    const endM = Number(windowParts[1] ?? "0");
    const windowEnd = new Date(now);
    windowEnd.setUTCHours(endH, endM, 0, 0);
    if (now > windowEnd) continue;

    const existingReminders = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, session.userId),
          sql`${notifications.type} LIKE '%REMINDER%'`,
          sql`date(${notifications.createdAt}) = ${today}`
        )
      );
    const reminderCount = existingReminders[0]?.count ?? 0;
    if (reminderCount >= MAX_REMINDERS) continue;

    const steps = escalation.stepsMinutes ?? [30, 90, 180];
    const strongAt = escalation.strongAt ?? 360;

    if (minutesSinceDue >= strongAt) {
      await insertReminder(db, session.userId, "STRONG_REMINDER", now);
    } else {
      for (const step of steps) {
        if (minutesSinceDue >= step && minutesSinceDue < step + REMINDER_SWEEP_MIN) {
          await insertReminder(db, session.userId, "REMINDER", now);
          break;
        }
      }
    }
  }
}

async function insertReminder(
  db: Parameters<typeof dispatchNotifications>[0],
  userId: string,
  type: "REMINDER" | "STRONG_REMINDER" | "FINAL_REMINDER",
  now: Date
) {
  const dateStr = now.toISOString().slice(0, 10);
  const uniqueKey = `reminder:${userId}:${type}:${dateStr}:${now.getUTCHours()}:${now.getUTCMinutes()}`;
  await db.insert(notifications).values({
    userId,
    type,
    channel: "IN_APP",
    uniqueKey,
    subject: type === "STRONG_REMINDER" ? "Don't forget your session!" : "Reminder: practice time",
    body: { reminderType: type },
    scheduledFor: now,
  });
}

// ─── Missed Session Processing ───────────────────────────────────────────────

async function processMissedSessions(c: Container, log: Logger): Promise<void> {
  const db = c.db;
  const now = new Date();

  const overdue = await db
    .select()
    .from(dailySessions)
    .where(
      and(
        lte(dailySessions.deadlineAt, now),
        sql`${dailySessions.status} IN ('SCHEDULED', 'AVAILABLE')`
      )
    );

  for (const session of overdue) {
    try {
      await db
        .update(dailySessions)
        .set({ status: "MISSED" })
        .where(eq(dailySessions.id, session.id));

      const [existingStreak] = await db
        .select()
        .from(streaks)
        .where(eq(streaks.userId, session.userId))
        .limit(1);

      const streakRecord = existingStreak
        ? {
            currentLength: existingStreak.currentLength,
            longestLength: existingStreak.longestLength,
            currentStart: toLocalDateStr(existingStreak.currentStart),
            lastCompletedDate: toLocalDateStr(existingStreak.lastCompletedDate),
          }
        : { currentLength: 0, longestLength: 0, currentStart: null, lastCompletedDate: null };

      const updated = processMiss(streakRecord, session.localDate);

      const deadlineDate = toLocalDateStr(session.deadlineAt) ?? session.localDate;
      await db
        .insert(streaks)
        .values({
          userId: session.userId,
          currentLength: updated.currentLength,
          longestLength: updated.longestLength,
          currentStart: updated.currentStart,
          lastCompletedDate: updated.lastCompletedDate,
          brokenAt: session.deadlineAt ?? now,
        })
        .onConflictDoUpdate({
          target: streaks.userId,
          set: {
            currentLength: updated.currentLength,
            longestLength: updated.longestLength,
            currentStart: updated.currentStart,
            lastCompletedDate: updated.lastCompletedDate,
            brokenAt: session.deadlineAt ?? now,
          },
        });

      const tomorrow = addLocalDays(session.localDate, 1);
      const [prefs] = await db
        .select()
        .from(userPreferences)
        .where(eq(userPreferences.userId, session.userId))
        .limit(1);

      if (prefs) {
        const restDays = prefs.restDays ?? [];
        const tz = prefs.timezone ?? "UTC";
        if (!isRestDay(tomorrow, tz, restDays)) {
          const uniqueKey = `recovery:${session.userId}:${session.id}:${tomorrow}`;
          await db.insert(notifications).values({
            userId: session.userId,
            type: "RECOVERY_SCHEDULED",
            channel: "IN_APP",
            uniqueKey,
            subject: "Recovery session scheduled",
            body: { date: tomorrow },
            scheduledFor: now,
          });
        }
      }

      const missedKey = `missed:${session.userId}:${session.localDate}`;
      await db.insert(notifications).values({
        userId: session.userId,
        type: "MISSED_DAY",
        channel: "IN_APP",
        uniqueKey: missedKey,
        subject: "You missed a practice day",
        body: { localDate: session.localDate },
        scheduledFor: now,
      });

      log.info({ userId: session.userId, sessionId: session.id }, "Session marked MISSED");
    } catch (err) {
      log.error({ err, sessionId: session.id }, "Failed to process missed session");
    }
  }
}

// ─── Concept Decay ───────────────────────────────────────────────────────────

async function sweepConceptDecay(c: Container, log: Logger): Promise<void> {
  const db = c.db;

  const stale = await db
    .select()
    .from(userConceptState)
    .where(sql`${userConceptState.lastPracticedAt} < now() - interval '7 days'`)
    .limit(100);

  for (const concept of stale) {
    const daysSince = Math.floor(
      (Date.now() - new Date(concept.lastPracticedAt!).getTime()) / 86_400_000
    );
    const updated = applyDecay(
      {
        state: concept.state,
        mastery: concept.mastery,
        recallStrength: concept.recallStrength,
        consecutiveSuccess: concept.consecutiveSuccess,
        consecutiveFail: concept.consecutiveFail,
        totalAttempts: concept.totalAttempts,
      },
      daysSince
    );

    await db
      .update(userConceptState)
      .set({
        state: updated.state,
        mastery: updated.mastery,
        recallStrength: updated.recallStrength,
      })
      .where(
        and(
          eq(userConceptState.userId, concept.userId),
          eq(userConceptState.nodeId, concept.nodeId)
        )
      );
  }

  if (stale.length > 0) {
    log.info({ count: stale.length }, "Concept decay sweep complete");
  }
}

// ─── Job Housekeeping ────────────────────────────────────────────────────────

async function cleanupJobs(c: Container, log: Logger): Promise<void> {
  const db = c.db;

  // Re-queue jobs stuck in RUNNING for more than STALE_RUNNING_MIN minutes
  const staleJobs = await db.execute(sql`
    UPDATE ai_jobs
    SET status = 'QUEUED', started_at = NULL
    WHERE status = 'RUNNING'
      AND started_at < now() - interval '${sql.raw(String(STALE_RUNNING_MIN))} minutes'
    RETURNING id
  `);

  const rows = (staleJobs as { rows?: unknown[] }).rows;
  if (Array.isArray(rows) && rows.length > 0) {
    log.warn({ count: rows.length }, "Re-queued stale RUNNING jobs");
  }

  // Delete old completed/failed jobs (> 7 days)
  await db.execute(sql`
    DELETE FROM ai_jobs
    WHERE status IN ('COMPLETED', 'FAILED')
      AND completed_at < now() - interval '7 days'
  `);
}
