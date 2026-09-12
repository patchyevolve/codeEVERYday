/**
 * Adaptive difficulty engine.
 *
 * Adjusts the difficulty at which exercises are drawn for a concept
 * based on demonstrated performance, hint dependence and recall strength.
 */

export interface PerformanceSignal {
  accuracy: number; // 0..1 over recent attempts
  attempts: number;
  hintsUsed: number;
  recallStrength: number; // 0..1
  consecutiveFail: number;
}

export const MIN_DIFFICULTY = 1;
export const MAX_DIFFICULTY = 5;

export function adaptiveDifficulty(perf: PerformanceSignal, current: number): number {
  let delta = 0;

  if (perf.accuracy >= 0.9 && perf.attempts >= 3 && perf.hintsUsed <= 1 && perf.recallStrength >= 0.6) {
    delta = 1;
  } else if (perf.accuracy >= 0.75 && perf.attempts >= 5 && perf.hintsUsed <= 2) {
    delta = 0;
  } else if (perf.accuracy < 0.5 && perf.attempts >= 2) {
    delta = -1;
  }
  if (perf.consecutiveFail >= 3) delta = Math.min(delta, -1);

  const next = current + delta;
  return Math.max(MIN_DIFFICULTY, Math.min(MAX_DIFFICULTY, next));
}

export function clampDifficulty(d: number): number {
  return Math.max(MIN_DIFFICULTY, Math.min(MAX_DIFFICULTY, d));
}