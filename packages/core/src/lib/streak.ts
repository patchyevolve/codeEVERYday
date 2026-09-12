/**
 * Streak logic — pure functions over completion dates.
 * A streak is a chain of consecutive local dates (in user timezone)
 * with a completed session. Calendar gaps break it.
 */

import { addLocalDays } from "./dates.js";

export interface StreakRecord {
  currentLength: number;
  longestLength: number;
  currentStart: string | null;
  lastCompletedDate: string | null;
}

export function emptyStreak(): StreakRecord {
  return { currentLength: 0, longestLength: 0, currentStart: null, lastCompletedDate: null };
}

/**
 * Record a completion for `completedLocalDate`.
 * Returns a new streak record.
 */
export function recordCompletion(streak: StreakRecord, completedLocalDate: string, todayLocalDate: string): StreakRecord {
  const last = streak.lastCompletedDate;

  if (last === completedLocalDate) {
    return streak; // idempotent
  }

  let currentLength: number;
  let currentStart: string;

  if (last && addLocalDays(last, 1) === completedLocalDate) {
    currentLength = streak.currentLength + 1;
    currentStart = streak.currentStart ?? completedLocalDate;
  } else {
    // broken (or first)
    currentLength = 1;
    currentStart = completedLocalDate;
  }

  // A completion on a past date (backfill) does not extend the current streak
  // beyond today; but a completion in the future is impossible.
  if (completedLocalDate < todayLocalDate && last && completedLocalDate !== addLocalDays(last, 1)) {
    currentLength = 1;
    currentStart = completedLocalDate;
  }

  const longestLength = Math.max(streak.longestLength, currentLength);

  return {
    currentLength,
    longestLength,
    currentStart,
    lastCompletedDate: completedLocalDate
  };
}

/**
 * Called when a missed day is processed. `yesterdayMissed` true when the last
 * completed date is at least 2 days before today (a full calendar day gap).
 */
export function processMiss(streak: StreakRecord, missedLocalDate: string): StreakRecord {
  if (streak.lastCompletedDate && addLocalDays(streak.lastCompletedDate, 1) === missedLocalDate) {
    // The missed day was the next day after the streak ended -> streak broke.
    return {
      ...streak,
      currentLength: 0,
      currentStart: null
    };
  }
  return streak;
}

/** Projects whether today's completion extends the streak. */
export function wouldExtend(streak: StreakRecord, todayLocalDate: string): boolean {
  return (
    streak.lastCompletedDate === todayLocalDate ||
    (!!streak.lastCompletedDate && addLocalDays(streak.lastCompletedDate, 1) === todayLocalDate) ||
    streak.lastCompletedDate === null
  );
}