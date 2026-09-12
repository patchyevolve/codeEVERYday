import { eq, and, lte, sql } from "drizzle-orm";
import {
  notifications,
  notificationAttempts,
  users,
  userPreferences,
} from "@cpd/core";
import { isInQuietHours, todayLocal, nextLocalTimeOccurrence } from "@cpd/core";
import type { DB } from "@cpd/core";
import type { Logger } from "pino";

const MAX_PER_DAY = Number(process.env["NOTIFICATION_MAX_PER_DAY"] ?? 12);
const MAX_REMINDERS = Number(
  process.env["NOTIFICATION_MAX_REMINDERS_PER_DAY"] ?? 6
);

export async function dispatchNotifications(
  db: DB,
  log: Logger
): Promise<void> {
  const now = new Date();

  const queued = await db
    .select({
      id: notifications.id,
      userId: notifications.userId,
      type: notifications.type,
      channel: notifications.channel,
      subject: notifications.subject,
      body: notifications.body,
      uniqueKey: notifications.uniqueKey,
      attempts: notifications.attempts,
    })
    .from(notifications)
    .where(
      and(
        eq(notifications.status, "QUEUED"),
        lte(notifications.scheduledFor, now)
      )
    )
    .limit(20);

  for (const notif of queued) {
    try {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, notif.userId))
        .limit(1);
      if (!user) {
        await markFailed(db, notif.id, "User not found");
        continue;
      }

      const [prefs] = await db
        .select()
        .from(userPreferences)
        .where(eq(userPreferences.userId, notif.userId))
        .limit(1);

      const timezone = prefs?.timezone ?? "UTC";
      const today = todayLocal(timezone);

      if (prefs?.quietHours && isInQuietHours(now, prefs.quietHours, timezone)) {
        await db
          .update(notifications)
          .set({ status: "QUEUED", scheduledFor: getNextAvailableTime(prefs.quietHours, timezone) })
          .where(eq(notifications.id, notif.id));
        continue;
      }

      const dailyCount = await getDailyCount(db, notif.userId, today);
      const isReminder = notif.type.includes("REMINDER");
      const reminderCount = isReminder
        ? await getReminderCount(db, notif.userId, today)
        : 0;

      if (dailyCount >= MAX_PER_DAY || (isReminder && reminderCount >= MAX_REMINDERS)) {
        log.warn(
          { userId: notif.userId, dailyCount, reminderCount },
          "Notification limit reached, cancelling"
        );
        await db
          .update(notifications)
          .set({ status: "CANCELLED" })
          .where(eq(notifications.id, notif.id));
        continue;
      }

      if (notif.channel === "IN_APP") {
        await db
          .update(notifications)
          .set({ status: "SENT", sentAt: now })
          .where(eq(notifications.id, notif.id));

        await db.insert(notificationAttempts).values({
          notificationId: notif.id,
          provider: "in_app",
          status: "SUCCESS",
        });
      } else if (notif.channel === "EMAIL") {
        await handleEmail(db, log, notif);
      } else {
        log.debug({ channel: notif.channel }, "Unsupported notification channel, marking SENT");
        await db
          .update(notifications)
          .set({ status: "SENT", sentAt: now })
          .where(eq(notifications.id, notif.id));
      }
    } catch (err) {
      log.error({ err, notificationId: notif.id }, "Notification dispatch failed");
      await markFailed(db, notif.id, String(err));
    }
  }
}

async function handleEmail(
  db: DB,
  log: Logger,
  notif: { id: string; userId: string; subject: string | null; body: unknown; attempts: number }
) {
  const smtpHost = process.env["SMTP_HOST"];
  if (!smtpHost) {
    log.debug("SMTP not configured, marking email as SENT (dry-run)");
    await db
      .update(notifications)
      .set({ status: "SENT", sentAt: new Date() })
      .where(eq(notifications.id, notif.id));
    await db.insert(notificationAttempts).values({
      notificationId: notif.id,
      provider: "smtp_dry_run",
      status: "SUCCESS",
    });
    return;
  }

  try {
    // TODO: integrate real SMTP transport when needed
    await db.insert(notificationAttempts).values({
      notificationId: notif.id,
      provider: "smtp",
      status: "SUCCESS",
    });
    await db
      .update(notifications)
      .set({ status: "SENT", sentAt: new Date() })
      .where(eq(notifications.id, notif.id));
  } catch (err) {
    await db.insert(notificationAttempts).values({
      notificationId: notif.id,
      provider: "smtp",
      status: "FAILURE",
      error: String(err),
    });
    if (notif.attempts + 1 >= 3) {
      await db
        .update(notifications)
        .set({ status: "FAILED", attempts: notif.attempts + 1 })
        .where(eq(notifications.id, notif.id));
    } else {
      await db
        .update(notifications)
        .set({ status: "QUEUED", attempts: notif.attempts + 1 })
        .where(eq(notifications.id, notif.id));
    }
  }
}

async function markFailed(db: DB, notificationId: string, error: string) {
  const [existing] = await db
    .select({ attempts: notifications.attempts })
    .from(notifications)
    .where(eq(notifications.id, notificationId))
    .limit(1);
  const attempts = (existing?.attempts ?? 0) + 1;
  const status = attempts >= 3 ? "FAILED" : "QUEUED";
  await db
    .update(notifications)
    .set({ status, attempts })
    .where(eq(notifications.id, notificationId));
  await db.insert(notificationAttempts).values({
    notificationId,
    provider: "unknown",
    status: "FAILURE",
    error,
  });
}

async function getDailyCount(db: DB, userId: string, date: string): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        sql`date(${notifications.createdAt}) = ${date}`,
        sql`${notifications.status} != 'CANCELLED'`
      )
    );
  return result[0]?.count ?? 0;
}

async function getReminderCount(db: DB, userId: string, date: string): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        sql`date(${notifications.createdAt}) = ${date}`,
        sql`${notifications.type} LIKE '%REMINDER%'`,
        sql`${notifications.status} != 'CANCELLED'`
      )
    );
  return result[0]?.count ?? 0;
}

function getNextAvailableTime(quietHours: { start: string; end: string }, timezone: string): Date {
  return nextLocalTimeOccurrence(quietHours.end, timezone);
}
