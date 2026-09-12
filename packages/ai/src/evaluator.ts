/**
 * Submission evaluation — the tutor "grades the homework".
 *
 * Everything is inferred from the learner's work:
 *  - correctness (sandbox execution / answer checks)
 *  - struggle (attempts, hints used, time taken)
 *  - code quality (sanitizer findings → mistake patterns)
 *  - review recall quality (SM-2 scheduling)
 *
 * Outcomes update: submissions, mistakes (heat map), user_concept_state
 * (mastery state machine), daily_task status, and session completion
 * (streak, XP, completions). No manual feedback from the learner.
 */

import { initialState, type MistakePatternCode } from "@cpd/core";
import type { ExecutorLanguage } from "@cpd/core";
import {
  newReviewState,
  applyReview,
  qualityFromOutcome,
  checkAnswer,
  applyOutcome,
  recordCompletion,
  type ContentPayload,
  type ConceptRecord,
  type MasteryOutcome,
  type StreakRecord
} from "@cpd/core";
import { executeCode } from "./executor-client.js";
import { todayLocal } from "@cpd/core";
import type { SubmissionRepository } from "./repositories/submission-repository.js";
import type { StreakRepository } from "./repositories/streak-repository.js";

export interface SubmitInput {
  userId: string;
  taskId: string;
  /** MCQs: answer index; TRACING/PREDICTION: text; ASSESSMENT: array of {i, answer}. */
  answer?: unknown;
  code?: string;
  language?: string;
  hintsUsed?: number;
  durationMs?: number;
  /** LESSON/REAL_WORLD/PROJECT tasks are completed by marking them done. */
  completed?: boolean;
}

export interface SubmitResult {
  verdict: "PASS" | "FAIL" | "COMPILE_ERROR" | "PARTIAL";
  score: number;
  feedback: string[];
  results: { index: number; passed: boolean; description?: string; expected?: unknown; actual?: unknown; stderr?: string }[];
  attempt: number;
  nodeState?: string;
  nextReviewAt?: string | null;
  sessionCompleted: boolean;
  xpEarned: number;
}

const XP_FIRST_TRY = 15;
const XP_PASS = 10;
const XP_HINT_PENALTY = 3;

export function sanitizerPattern(stderr: string): MistakePatternCode | null {
  if (/AddressSanitizer|heap-use-after-free/.test(stderr)) return "null_deref";
  if (/stack-buffer-overflow/.test(stderr)) return "buffer_overflow";
  if (/UndefinedBehaviorSanitizer|runtime error/.test(stderr)) return "overflow";
  if (/LeakSanitizer|leak/.test(stderr)) return "mem_leak";
  return null;
}

export function mistakeSeverityFrom(p: MistakePatternCode): "LOW" | "MEDIUM" | "HIGH" {
  if (p === "null_deref" || p === "buffer_overflow" || p === "uninitialized" || p === "mem_leak") return "HIGH";
  if (p === "syntax_error" || p === "type_error" || p === "complexity_error") return "LOW";
  return "MEDIUM";
}

export function outcomeFor(verdict: SubmitResult["verdict"], attempt: number, hintsUsed: number, kind: MasteryOutcome["kind"], difficulty: number): MasteryOutcome {
  const passed = verdict === "PASS";
  return {
    passed,
    kind,
    firstTry: passed && attempt === 1 && hintsUsed === 0,
    hintsUsed,
    difficulty,
    failCount: attempt - 1
  };
}

export interface EvaluatorDeps {
  submissions: SubmissionRepository;
  streaks: StreakRepository;
}

export async function completeSession(deps: EvaluatorDeps, userId: string, sessionId: string, tz: string): Promise<{ streak: number; longest: number; xp: number }> {
  const today = todayLocal(tz);
  const session = await deps.submissions.findSessionById(sessionId);
  if (!session || session.status === "COMPLETED") {
    const st = await deps.streaks.findStreak(userId);
    return { streak: st?.currentLength ?? 0, longest: st?.longestLength ?? 0, xp: 0 };
  }

  await deps.submissions.updateSessionStatus(sessionId, "COMPLETED");

  await deps.streaks.insertDailyCompletion(
    userId,
    sessionId,
    today,
    { requiredTasksDone: 0, requiredTasksTotal: 0, exercisesPassed: 0, assessmentPassed: false, lessonCompleted: false }
  );

  // streak
  const streakRow = await deps.streaks.findStreak(userId);
  const base: StreakRecord = streakRow
    ? {
        currentLength: streakRow.currentLength,
        longestLength: streakRow.longestLength,
        currentStart: streakRow.currentStart,
        lastCompletedDate: streakRow.lastCompletedDate
      }
    : { currentLength: 0, longestLength: 0, currentStart: null, lastCompletedDate: null };
  const next = recordCompletion(base, today, today);
  await deps.streaks.upsertStreak(userId, {
    currentLength: next.currentLength,
    longestLength: next.longestLength,
    currentStart: next.currentStart,
    lastCompletedDate: next.lastCompletedDate
  });

  // daily XP bonus
  const bonus = session.kind === "RECOVERY" ? 20 : 10;
  await deps.streaks.insertXpLedger(userId, bonus, `session_completed:${session.kind}`);

  return { streak: next.currentLength, longest: next.longestLength, xp: bonus };
}

export async function evaluateSubmission(deps: EvaluatorDeps, input: SubmitInput): Promise<SubmitResult> {
  const { userId, taskId } = input;

  const task = await deps.submissions.findTaskById(taskId);
  if (!task) throw new Error("task not found");
  const session = await deps.submissions.findSessionById(task.sessionId);
  if (!session) throw new Error("session not found");
  if (session.userId !== userId) throw new Error("not your task");

  if (session.status === "SCHEDULED" || session.status === "AVAILABLE") {
    await deps.submissions.updateSessionStatus(session.id, "IN_PROGRESS");
  }

  const item = await deps.submissions.findContentItemById(task.contentItemId);
  if (!item) throw new Error("content item not found");
  const payload = item.payload as ContentPayload;
  const node = await deps.submissions.findNodeById(item.nodeId);
  if (!node) throw new Error("node not found");

  const attempt = await deps.submissions.countAttempts(userId, taskId, item.id);

  const hintsUsed = input.hintsUsed ?? 0;
  const durationMs = input.durationMs ?? null;
  const feedback: string[] = [];
  let verdict: SubmitResult["verdict"] = "FAIL";
  let score = 0;
  let results: SubmitResult["results"] = [];

  // ----- grade by kind -------------------------------------------------
  if (payload.kind === "CODING" || payload.kind === "DEBUGGING") {
    if (!input.code) throw new Error("code required for coding task");
    const language = (input.language ?? payload.harness?.language ?? "cpp") as ExecutorLanguage;
    const execRes = await executeCode(language, input.code, payload.harness!, payload.testCases, payload.harness!.timeoutMs ?? 10000, payload.harness!.memoryMb ?? 512);
    results = execRes.results;

    const sub = await deps.submissions.insertSubmission({
      userId,
      contentItemId: item.id,
      sessionId: session.id,
      taskId,
      kind: payload.kind,
      code: input.code,
      language,
      status: execRes.status,
      score: results.length ? results.filter((r) => r.passed).length / results.length : 0,
      results,
      hintsUsed,
      durationMs
    });

    await deps.submissions.insertExecution({
      submissionId: sub.id,
      sandbox: { method: execRes.sandboxMethod },
      status: execRes.status,
      summary: execRes.compileError ? undefined : `results=${results.filter((r) => r.passed).length}/${results.length}`
    });

    if (execRes.status === "COMPILE_ERROR") {
      verdict = "COMPILE_ERROR";
      feedback.push("Your code did not compile.");
      const ce = execRes.compileError;
      if (ce) feedback.push(ce.split("\n")[0] ?? ce);
      await deps.streaks.recordMistake(userId, node.id, "syntax_error", mistakeSeverityFrom("syntax_error"), execRes.compileError ? execRes.compileError.slice(0, 300) : null, sub.id, item.id);
    } else if (execRes.status === "PASS") {
      verdict = "PASS";
      score = 1;
      feedback.push(attempt === 0 && hintsUsed === 0 ? "Solved it first try. Excellent." : "All tests pass.");
    } else {
      const failed = results.filter((r) => !r.passed);
      const sani = sanitizerPattern(execRes.stderr ?? "");
      if (sani) {
        feedback.push(`Your code triggered a safety check: ${sani}`);
        await deps.streaks.recordMistake(userId, node.id, sani, mistakeSeverityFrom(sani), execRes.stderr?.slice(0, 300) ?? null, sub.id, item.id);
      } else {
        feedback.push(`${failed.length} test case(s) failed.`);
        if (failed[0]?.description) feedback.push(`Failing case: ${failed[0].description}`);
        await deps.streaks.recordMistake(userId, node.id, "logic_error", mistakeSeverityFrom("logic_error"), failed[0]?.description ?? null, sub.id, item.id);
      }
    }
  } else if (payload.kind === "CONCEPTUAL") {
    const idx = typeof input.answer === "number" ? input.answer : Number(input.answer);
    const passed = checkAnswer({ kind: "mcq", options: payload.options, answerIndex: payload.answerIndex }, idx);
    const sub = await deps.submissions.insertSubmission({ userId, contentItemId: item.id, sessionId: session.id, taskId, kind: payload.kind, answer: idx, language: "none", status: passed ? "PASS" : "FAIL", score: passed ? 1 : 0, hintsUsed, durationMs });
    verdict = passed ? "PASS" : "FAIL";
    score = passed ? 1 : 0;
    feedback.push(passed ? "Correct." : `Not quite. Correct answer: ${payload.options[payload.answerIndex]}`);
    if (!passed) await deps.streaks.recordMistake(userId, node.id, "misread_problem", mistakeSeverityFrom("misread_problem"), `conceptual: chose ${idx}`, sub.id, item.id);
  } else if (payload.kind === "TRACING" || payload.kind === "PREDICTION") {
    const text = typeof input.answer === "string" ? input.answer.trim().toLowerCase() : String(input.answer ?? "").trim().toLowerCase();
    const passed = payload.acceptedAnswers.some((a) => a.trim().toLowerCase() === text);
    const sub = await deps.submissions.insertSubmission({ userId, contentItemId: item.id, sessionId: session.id, taskId, kind: payload.kind, answer: input.answer, language: "none", status: passed ? "PASS" : "FAIL", score: passed ? 1 : 0, hintsUsed, durationMs });
    verdict = passed ? "PASS" : "FAIL";
    score = passed ? 1 : 0;
    feedback.push(passed ? "Correct." : "Not quite — compare your trace against the expected output.");
    if (!passed) await deps.streaks.recordMistake(userId, node.id, "logic_error", mistakeSeverityFrom("logic_error"), `tracing: got "${input.answer}"`, sub.id, item.id);
  } else if (payload.kind === "ASSESSMENT") {
    const answers = (Array.isArray(input.answer) ? input.answer : []) as { i: number; answer: unknown }[];
    const graded = payload.questions.map((q, i) => {
      const a = answers.find((x) => x.i === i)?.answer;
      if (q.kind === "MCQ") return checkAnswer({ kind: "mcq", options: q.options ?? [], answerIndex: q.answerIndex ?? -1 }, Number(a));
      return typeof a === "string" && a.trim().length >= 3;
    });
    const correct = graded.filter(Boolean).length;
    score = payload.questions.length ? correct / payload.questions.length : 0;
    const passed = score >= (payload.passThreshold ?? 0.7);
    verdict = passed ? "PASS" : "FAIL";
    const sub = await deps.submissions.insertSubmission({ userId, contentItemId: item.id, sessionId: session.id, taskId, kind: payload.kind, answer: answers, language: "none", status: passed ? "PASS" : "FAIL", score, hintsUsed, durationMs });
    feedback.push(passed ? `Assessment passed (${correct}/${payload.questions.length}).` : `Assessment scored ${correct}/${payload.questions.length} — needs ${Math.round((payload.passThreshold ?? 0.7) * 100)}% to pass.`);
    if (!passed) {
      payload.questions.forEach((q, i) => {
        if (!graded[i]) {
          void deps.streaks.recordMistake(userId, node.id, "misread_problem", mistakeSeverityFrom("misread_problem"), `assessment q${i} wrong`, sub.id, item.id);
        }
      });
    }
  } else if (payload.kind === "LESSON" || payload.kind === "REAL_WORLD" || payload.kind === "PROJECT") {
    if (!input.completed) throw new Error("this task is completed by marking it done");
    await deps.submissions.insertSubmission({ userId, contentItemId: item.id, sessionId: session.id, taskId, kind: payload.kind, language: "none", status: "PASS", score: 1, hintsUsed: 0, durationMs });
    verdict = "PASS";
    score = 1;
    feedback.push(payload.kind === "LESSON" ? "Lesson reviewed." : "Marked done.");
  } else {
    throw new Error(`unsupported content kind ${payload.kind}`);
  }

  // ----- mastery + state ----------------------------------------------
  const stateRow = await deps.streaks.findConceptState(userId, node.id);

  const rec: ConceptRecord = stateRow
    ? {
        state: stateRow.state,
        mastery: stateRow.mastery,
        recallStrength: stateRow.recallStrength,
        consecutiveSuccess: stateRow.consecutiveSuccess,
        consecutiveFail: stateRow.consecutiveFail,
        totalAttempts: stateRow.totalAttempts
      }
    : initialState();

  const mKind: MasteryOutcome["kind"] =
    payload.kind === "ASSESSMENT" ? "assessment" : session.kind === "REVIEW" ? "review" : session.kind === "RECOVERY" ? "remediation" : "exercise";
  const outcome = outcomeFor(verdict, attempt + 1, hintsUsed, mKind, node.difficulty);
  const updated = applyOutcome(rec, outcome);

  // spaced repetition: recall checks (REVIEW / RECOVERY) reschedule
  let review = stateRow
    ? {
        intervalDays: stateRow.reviewIntervalDays,
        ease: stateRow.reviewEase,
        reviewCount: stateRow.reviewCount,
        nextReviewAt: stateRow.nextReviewAt
      }
    : newReviewState(new Date());
  if (session.kind === "REVIEW" || session.kind === "RECOVERY") {
    const q = qualityFromOutcome(outcome.passed, outcome.firstTry, hintsUsed, updated.mastery);
    review = applyReview(review, { quality: q }, new Date());
  }

  await deps.streaks.upsertConceptState(userId, node.id, {
    state: updated.state,
    mastery: updated.mastery,
    recallStrength: updated.recallStrength,
    consecutiveSuccess: updated.consecutiveSuccess,
    consecutiveFail: updated.consecutiveFail,
    totalAttempts: updated.totalAttempts,
    lastPracticedAt: new Date(),
    nextReviewAt: review.nextReviewAt,
    reviewIntervalDays: review.intervalDays,
    reviewEase: review.ease,
    reviewCount: review.reviewCount
  });

  // ----- XP ------------------------------------------------------------
  let xpEarned = 0;
  if (verdict === "PASS") {
    xpEarned = attempt === 0 && hintsUsed === 0 ? XP_FIRST_TRY : XP_PASS - Math.min(hintsUsed, 3) * XP_HINT_PENALTY;
    await deps.streaks.insertXpLedger(userId, xpEarned, `task_pass:${payload.kind}`, "task", taskId);
  }

  // ----- task + session completion -------------------------------------
  let nextReviewAt: string | null = null;
  if (verdict === "PASS") {
    await deps.submissions.updateTaskStatus(taskId, "DONE");
  } else {
    await deps.submissions.updateTaskStatus(taskId, "PENDING");
  }

  let sessionCompleted = false;
  if (verdict !== "FAIL" && verdict !== "COMPILE_ERROR") {
    const openCount = await deps.submissions.countOpenRequiredTasks(session.id);
    if (openCount === 0) {
      const tz = await deps.submissions.findUserTimezone(userId);
      const comp = await completeSession(deps, userId, session.id, tz);
      sessionCompleted = true;
      feedback.push(`Session complete! Streak: ${comp.streak} day(s).`);
    }
  }

  if ((session.kind === "REVIEW" || session.kind === "RECOVERY") && review.nextReviewAt) nextReviewAt = review.nextReviewAt.toISOString();

  return { verdict, score, feedback, results, attempt: attempt + 1, nodeState: updated.state, nextReviewAt, sessionCompleted, xpEarned };
}
/**
 * Help path for incorrect work — the tutor's version of "come look at my code".
 * Template-based for now; the AI provider can enrich this later.
 */
export interface DebugAssistInput {
  userId: string;
  submissionId: string;
}

export interface DebugAssistResult {
  hint: string;
  severity: "hint" | "warning" | "critical";
}

export async function debugAssist(deps: EvaluatorDeps, input: DebugAssistInput): Promise<DebugAssistResult> {
  const sub = await deps.submissions.findSubmissionById(input.submissionId, input.userId);
  if (!sub) throw new Error("submission not found");

  if (sub.status === "COMPILE_ERROR" || sub.status === "TIMEOUT" || sub.status === "RUNTIME_ERROR") {
    if (sub.status === "COMPILE_ERROR") {
      const first = (sub.results?.[0]?.stderr ?? "Your code did not compile.").split("\n")[0];
      return { hint: `Compiler says: ${first}`, severity: "warning" };
    }
    if (sub.status === "TIMEOUT") {
      return { hint: "Your code ran too long — check for infinite loops or quadratic work on the failing case.", severity: "warning" };
    }
    return { hint: "Your program crashed at runtime. Run it locally with the same inputs to find the crash.", severity: "critical" };
  }

  const sanitizer = sub.results?.find((r) => r.stderr && /sanitizer|runtime error/i.test(r.stderr))?.stderr;
  if (sanitizer) {
    return {
      hint: `Memory safety issue detected: ${sanitizer.split("\n")[0]}. Fix the out-of-bounds/use-after-free access.`,
      severity: "critical"
    };
  }

  const failed = sub.results?.filter((r) => !r.passed) ?? [];
  if (failed.length === 0) return { hint: "Your solution passes. Move on to the next task.", severity: "hint" };
  const first = failed[0] ?? { description: undefined };
  const hint = first.description
    ? `Failing case: ${first.description}. Trace your logic by hand on this input — where does the output diverge?`
    : "A test case failed. Write the failing input down and trace your code step by step.";
  return { hint, severity: "hint" };
}
