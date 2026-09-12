/** Domain-wide constants. */

export const XP = {
  EXERCISE_PASS_FIRST_TRY: 25,
  EXERCISE_PASS_WITH_RETRIES: 12,
  EXERCISE_FAIL: 2,
  ASSESSMENT_PASS: 40,
  LESSON_COMPLETE: 15,
  DAILY_SESSION_COMPLETE: 50,
  STREAK_BONUS_BASE: 10,
  RECOVERY_REVIEW_BONUS: 10,
  MISS_PENALTY: 30
} as const;

export const LEVELS = [
  0, 100, 250, 450, 700, 1000, 1350, 1750, 2200, 2700, 3250, 3850, 4500, 5200, 5950, 6750, 7600, 8500, 9450, 10450
] as const;

export const LEVEL_NAMES: Record<number, string> = {
  0: "Absolute Fundamentals",
  1: "Basic Programming",
  2: "Problem Solving",
  3: "Data Structures",
  4: "Algorithms",
  5: "Intermediate Software Development",
  6: "Advanced Programming",
  7: "Systems / Architecture",
  8: "Professional Engineering"
};

export const MASTERY = {
  TARGET: 0.85,
  REVIEW_INTERVALS_DAYS: [1, 3, 7, 14, 30, 60, 120],
  DECAY_DAYS: 21, // no practice for 21 days -> DECAYING
  DECAY_MASTERY_RATE: 0.05 // mastery lost per review cycle while decaying
} as const;

export const STREAK = {
  DAILY_BONUS_XP: 10,
  MILESTONES: [3, 7, 14, 30, 60, 100, 180, 365]
} as const;

export const NOTIFICATION_LIMITS = {
  MAX_PER_DAY: 12,
  MAX_REMINDERS_PER_DAY: 6
} as const;

export const CURRICULUM_LEVELS = [
  "Absolute Fundamentals",
  "Basic Programming",
  "Problem Solving",
  "Data Structures",
  "Algorithms",
  "Intermediate Software Development",
  "Advanced Programming",
  "Systems / Architecture",
  "Professional Engineering"
] as const;

export function xpForLevel(level: number): number {
  return LEVELS[Math.min(level, LEVELS.length - 1)] ?? LEVELS[LEVELS.length - 1]!;
}

export function levelFromXp(xp: number): number {
  let level = 0;
  for (let i = 1; i < LEVELS.length; i++) {
    if (xp >= (LEVELS[i] ?? Number.POSITIVE_INFINITY)) level = i;
    else break;
  }
  return level;
}