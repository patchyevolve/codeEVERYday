/**
 * Spaced repetition scheduler — SM-2 inspired.
 * A concept is reviewed at growing intervals only when recall succeeds.
 * Failed recall resets the interval and marks the concept REVIEW_REQUIRED.
 */

export interface ReviewState {
  intervalDays: number;
  ease: number; // SM-2 ease factor, starts at 2.5
  reviewCount: number;
  nextReviewAt: Date | null;
}

export function newReviewState(now: Date): ReviewState {
  return { intervalDays: 1, ease: 2.5, reviewCount: 0, nextReviewAt: null };
}

export interface ReviewOutcome {
  quality: 0 | 1 | 2 | 3 | 4 | 5; // SM-2 quality: 5 = perfect recall, 0 = complete blackout
}

export function applyReview(state: ReviewState, outcome: ReviewOutcome, now: Date): ReviewState {
  const q = outcome.quality;
  if (q >= 3) {
    // successful recall
    const nextInterval =
      state.reviewCount === 0
        ? 1
        : state.reviewCount === 1
          ? 3
          : Math.round(state.intervalDays * state.ease);
    const ease = Math.max(1.3, state.ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
    return {
      intervalDays: nextInterval,
      ease,
      reviewCount: state.reviewCount + 1,
      nextReviewAt: addDays(now, nextInterval)
    };
  }
  // failed recall: repeat soon, ease drops
  const ease = Math.max(1.3, state.ease - 0.2);
  return {
    intervalDays: 1,
    ease,
    reviewCount: state.reviewCount,
    nextReviewAt: addDays(now, 1)
  };
}

export function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

/** Map an exercise/assessment outcome to an SM-2 quality. */
export function qualityFromOutcome(passed: boolean, firstTry: boolean, hintsUsed: number, mastery: number): 0 | 3 | 4 | 5 {
  if (!passed) return 0;
  if (firstTry && hintsUsed === 0 && mastery >= 0.7) return 5;
  if (firstTry) return 4;
  return 3;
}