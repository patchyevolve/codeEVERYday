/**
 * Concept mastery engine — deterministic state machine.
 *
 * States: NOT_STARTED -> LEARNING -> PRACTICING -> PROFICIENT -> MASTERED
 *         WEAK (remediation), DECAYING / REVIEW_REQUIRED (retention loss)
 *
 * A concept is NEVER marked mastered merely because a task was opened or
 * a single exercise passed. Mastery requires sustained demonstrated recall.
 */

export type ConceptState =
  | "NOT_STARTED"
  | "LEARNING"
  | "PRACTICING"
  | "WEAK"
  | "PROFICIENT"
  | "MASTERED"
  | "DECAYING"
  | "REVIEW_REQUIRED";

export interface ConceptRecord {
  state: ConceptState;
  mastery: number;
  recallStrength: number;
  consecutiveSuccess: number;
  consecutiveFail: number;
  totalAttempts: number;
}

export interface MasteryOutcome {
  passed: boolean;
  kind: "exercise" | "assessment" | "review" | "remediation";
  firstTry: boolean;
  hintsUsed: number;
  difficulty: number; // 1..5
  failCount: number; // number of failed submissions for this attempt
}

export const TARGET_MASTERY = 0.85;

export function initialState(): ConceptRecord {
  return {
    state: "NOT_STARTED",
    mastery: 0,
    recallStrength: 0,
    consecutiveSuccess: 0,
    consecutiveFail: 0,
    totalAttempts: 0
  };
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/**
 * Applies a single exercise/assessment outcome to a concept record.
 * Returns a new record (pure).
 */
export function applyOutcome(rec: ConceptRecord, outcome: MasteryOutcome): ConceptRecord {
  const next: ConceptRecord = { ...rec, totalAttempts: rec.totalAttempts + 1 };

  if (outcome.passed) {
    next.consecutiveSuccess = rec.consecutiveSuccess + 1;
    next.consecutiveFail = 0;
    const difficultyFactor = 0.06 + outcome.difficulty * 0.03;
    const firstTryBonus = outcome.firstTry ? 0.08 : 0.02;
    const hintPenalty = Math.min(0.06, outcome.hintsUsed * 0.02);
    const gain = difficultyFactor + firstTryBonus - hintPenalty;
    next.mastery = clamp01(rec.mastery + gain);
    next.recallStrength = clamp01(rec.recallStrength + 0.1);
  } else {
    next.consecutiveSuccess = 0;
    next.consecutiveFail = rec.consecutiveFail + 1;
    const penalty = 0.08 + outcome.difficulty * 0.02;
    next.mastery = clamp01(rec.mastery - penalty);
    next.recallStrength = clamp01(rec.recallStrength - 0.08);
  }

  next.state = transitionState(next, outcome);
  return next;
}

function transitionState(rec: ConceptRecord, outcome: MasteryOutcome): ConceptState {
  const s = rec.state;

  if (s === "NOT_STARTED") return outcome.passed ? "LEARNING" : "LEARNING";

  if (s === "WEAK") {
    // remediation passed at good level -> back to PRACTICING
    if (outcome.kind === "remediation" && outcome.passed) return "PRACTICING";
    if (outcome.passed && rec.consecutiveSuccess >= 2) return "PRACTICING";
    return "WEAK";
  }

  if (s === "DECAYING" || s === "REVIEW_REQUIRED") {
    if (outcome.passed) {
      return rec.mastery >= TARGET_MASTERY ? "PROFICIENT" : "PRACTICING";
    }
    return "WEAK";
  }

  if (s === "LEARNING") {
    if (outcome.passed) return rec.mastery >= 0.6 ? "PRACTICING" : "LEARNING";
    return "LEARNING";
  }

  if (s === "PRACTICING") {
    if (outcome.passed) {
      if (rec.mastery >= TARGET_MASTERY && rec.consecutiveSuccess >= 2) return "PROFICIENT";
      if (rec.mastery >= TARGET_MASTERY) return "PROFICIENT";
      return "PRACTICING";
    }
    return rec.consecutiveFail >= 2 ? "WEAK" : "PRACTICING";
  }

  if (s === "PROFICIENT") {
    if (outcome.passed && rec.mastery >= TARGET_MASTERY) {
      // sustained: two consecutive passing outcomes at target
      if (rec.consecutiveSuccess >= 2) return "MASTERED";
      return "PROFICIENT";
    }
    if (!outcome.passed && rec.consecutiveFail >= 2) return "WEAK";
    return "PROFICIENT";
  }

  if (s === "MASTERED") {
    // MASTERED is downgraded by time (decay), not by a single slip; two
    // consecutive failures still trigger downgrade.
    if (!outcome.passed && rec.consecutiveFail >= 2) return "REVIEW_REQUIRED";
    return "MASTERED";
  }

  return s;
}

/** Time-based decay: applied when a concept has not been practiced recently. */
export function applyDecay(rec: ConceptRecord, daysSincePractice: number): ConceptRecord {
  if (daysSincePractice <= 0) return rec;
  const decay = Math.min(0.5, daysSincePractice * 0.01);
  const next: ConceptRecord = {
    ...rec,
    mastery: clamp01(rec.mastery - decay),
    recallStrength: clamp01(rec.recallStrength - Math.min(0.4, daysSincePractice * 0.015))
  };
  if (next.state === "MASTERED") {
    if (next.mastery < TARGET_MASTERY) next.state = "DECAYING";
  } else if (next.state === "PROFICIENT" && next.mastery < 0.6) {
    next.state = "REVIEW_REQUIRED";
  } else if ((next.state === "LEARNING" || next.state === "PRACTICING") && next.mastery < 0.2) {
    next.state = "WEAK";
  }
  return next;
}

export function isWeakOrFailing(rec: ConceptRecord): boolean {
  return rec.state === "WEAK" || rec.state === "REVIEW_REQUIRED" || rec.state === "DECAYING";
}

export const MASTERY_ORDER: ConceptState[] = [
  "NOT_STARTED",
  "LEARNING",
  "PRACTICING",
  "WEAK",
  "PROFICIENT",
  "MASTERED",
  "DECAYING",
  "REVIEW_REQUIRED"
];