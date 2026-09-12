import { and, eq } from "drizzle-orm";
import { users, dailySessions, notifications, userPreferences } from "@cpd/core";
import { todayLocal } from "@cpd/core";
import { buildLearnerProfile } from "@cpd/ai";
import type { Container } from "@cpd/ai";
import type { Logger } from "pino";

export async function generateDailySessions(
  c: Container,
  log: Logger
): Promise<void> {
  const db = c.db;
  const activeUsers = await db
    .select()
    .from(users)
    .where(eq(users.isActive, true));

  log.info({ count: activeUsers.length }, "Generating daily sessions");

  for (const user of activeUsers) {
    try {
      const [prefs] = await db
        .select()
        .from(userPreferences)
        .where(eq(userPreferences.userId, user.id))
        .limit(1);

      const timezone = prefs?.timezone ?? "UTC";
      const localDate = todayLocal(timezone);

      const [existing] = await db
        .select()
        .from(dailySessions)
        .where(
          and(
            eq(dailySessions.userId, user.id),
            eq(dailySessions.localDate, localDate)
          )
        )
        .limit(1);

      if (existing) {
        continue;
      }

      if (prefs?.restDays?.includes(localDate)) {
        log.debug({ userId: user.id, localDate }, "Rest day, skipping");
        continue;
      }

      const profile = await buildLearnerProfile(c.learnerDeps, user.id);

      const objective = await c.tutorEngine.decideObjective(user.id, profile);
      const result = await c.tutorEngine.composeSession(
        user.id,
        profile,
        objective,
        { dueAt: new Date(), deadlineAt: new Date(Date.now() + 24 * 60 * 60 * 1000) }
      );

      const uniqueKey = `session-available:${user.id}:${localDate}`;
      await db.insert(notifications).values({
        userId: user.id,
        type: "SESSION_AVAILABLE",
        channel: "IN_APP",
        uniqueKey,
        subject: "Your daily session is ready",
        body: { localDate, sessionId: result.sessionId, tasks: result.tasks },
        scheduledFor: new Date(),
      });

      log.info({ userId: user.id, localDate, sessionId: result.sessionId }, "Daily session generated");
    } catch (err) {
      log.error({ err, userId: user.id }, "Failed to generate daily session");
    }
  }
}
