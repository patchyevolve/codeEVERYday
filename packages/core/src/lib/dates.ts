import { DateTime, Info } from "luxon";

/** All user-facing dates are computed in the user's own timezone. */

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Local date string (YYYY-MM-DD) for a UTC timestamp in the user's timezone. */
export function localDateFor(utc: Date | string, timezone: string): string {
  return DateTime.fromJSDate(toDate(utc), { zone: timezone }).toISODate()!;
}

export function toDate(v: Date | string): Date {
  return typeof v === "string" ? new Date(v) : v;
}

export function utcForLocalTime(
  localDate: string,
  localTime: string,
  timezone: string
): Date {
  const dt = DateTime.fromFormat(`${localDate}T${localTime}`, "yyyy-MM-dd'T'HH:mm", {
    zone: timezone
  });
  if (!dt.isValid) throw new Error(`Invalid local time: ${localTime} in ${timezone}`);
  return dt.toUTC().toJSDate();
}

/** Today's local date in the user's timezone. */
export function todayLocal(timezone: string): string {
  return DateTime.now().setZone(timezone).toISODate()!;
}

/** Adds days to a YYYY-MM-DD date (calendar days, timezone-agnostic). */
export function addLocalDays(localDate: string, days: number): string {
  return DateTime.fromISO(localDate).plus({ days }).toISODate()!;
}

/** Returns the minutes-of-day for the current time in the user's timezone. */
export function currentLocalMinutes(timezone: string): number {
  const now = DateTime.now().setZone(timezone);
  return now.hour * 60 + now.minute;
}

/** Given a local time "HH:MM", returns minutes since midnight. */
export function minutesOfDay(time: string): number {
  const [h, m] = time.split(":").map(Number);
  if (h === undefined || m === undefined || h < 0 || h > 23 || m < 0 || m > 59) {
    throw new Error(`Invalid time: ${time}`);
  }
  return h * 60 + m;
}

export function isInQuietHours(now: Date, quietHours: { start: string; end: string }, timezone: string): boolean {
  const local = DateTime.fromJSDate(now, { zone: timezone });
  const startMin = minutesOfDay(quietHours.start);
  const endMin = minutesOfDay(quietHours.end);
  const nowMin = local.hour * 60 + local.minute;
  if (startMin === endMin) return false;
  if (startMin < endMin) return nowMin >= startMin && nowMin < endMin;
  return nowMin >= startMin || nowMin < endMin;
}

export function weekdayOf(localDate: string, timezone: string): string {
  return DateTime.fromISO(localDate, { zone: timezone }).toFormat("cccc").toLowerCase();
}

export const WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday"
] as const;

export type Weekday = (typeof WEEKDAYS)[number];

export function isRestDay(localDate: string, timezone: string, restDays: string[]): boolean {
  const mmdd = DateTime.fromISO(localDate, { zone: timezone }).toFormat("MM-dd");
  return restDays.includes(mmdd);
}

/** Returns the next occurrence of a local time (HH:MM) in the given timezone, as a UTC Date. */
export function nextLocalTimeOccurrence(localTime: string, timezone: string): Date {
  const localDate = todayLocal(timezone);
  let result = utcForLocalTime(localDate, localTime, timezone);
  if (result <= new Date()) {
    const tomorrow = addLocalDays(localDate, 1);
    result = utcForLocalTime(tomorrow, localTime, timezone);
  }
  return result;
}