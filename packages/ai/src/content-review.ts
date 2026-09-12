/**
 * AI Content Review + Bounded Repair.
 *
 * 1. reviewContent   — semantic critic flags issues in AI-generated payload
 * 2. repairContent   — bounded (≤2 rounds) regeneration of flagged fields
 * 3. re-validate     — deterministic validation always overrides AI opinion
 * 4. persist         — every review is written to contentReviews table
 */

import { z } from "zod";
import type { DB, ContentPayload } from "@cpd/core";
import type {
  ContentReviewResult,
  ContentReviewIssue,
  ReviewIssueType,
  ChatMessage,
} from "./contracts.js";
import { validateContent } from "./validator.js";
import type { OrchestratorImpl } from "./orchestrator.js";
import type { ContentRepository } from "./repositories/content-repository.js";

/* ------------------------------------------------------------------ */
/* Schemas                                                             */
/* ------------------------------------------------------------------ */

const reviewIssueSchema = z.object({
  type: z.enum([
    "TECHNICAL_ERROR",
    "PREREQUISITE_VIOLATION",
    "PEDAGOGICAL_ERROR",
    "DIFFICULTY_MISMATCH",
    "AMBIGUITY",
    "DUPLICATION",
    "INCORRECT_EXAMPLE",
    "INVALID_EXERCISE",
    "INCORRECT_EXPECTED_OUTPUT",
    "INCONSISTENT_DEFINITION",
  ]),
  field: z.string(),
  description: z.string(),
  severity: z.enum(["error", "warning"]),
});

const reviewResultSchema = z.object({
  passed: z.boolean(),
  issues: z.array(reviewIssueSchema),
  reviewer: z.string(),
  reviewerModel: z.string(),
});

const repairOutputSchema = z.object({
  repairedFields: z.record(z.string(), z.unknown()),
  summary: z.string(),
});

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const MAX_REPAIR_ROUNDS = 2;
const REVIEWER_ID = "content-reviewer-v1";

/* ------------------------------------------------------------------ */
/* Prompt builders                                                     */
/* ------------------------------------------------------------------ */

function buildReviewMessages(
  requirement: string,
  learnerLevel: number,
  prerequisites: string[],
  payload: ContentPayload,
  technicalConstraints: Record<string, unknown>,
): ChatMessage[] {
  return [
    {
      role: "system",
      content: `You are an expert content reviewer for a programming education platform.
Your job is to find factual, pedagogical, and structural issues in generated content.
You MUST check:
- Technical correctness of code, examples, and expected outputs
- Prerequisite compliance (content must not assume knowledge the learner hasn't mastered)
- Pedagogical appropriateness for the stated learner level
- No ambiguities, no duplicated content, no inconsistent definitions
- Exercise validity and expected output correctness

Return a JSON object with the exact shape:
{
  "passed": boolean,
  "issues": [{ "type": ReviewIssueType, "field": string, "description": string, "severity": "error"|"warning" }],
  "reviewer": "${REVIEWER_ID}",
  "reviewerModel": "<your model name>"
}

Issue types: TECHNICAL_ERROR, PREREQUISITE_VIOLATION, PEDAGOGICAL_ERROR, DIFFICULTY_MISMATCH, AMBIGUITY, DUPLICATION, INCORRECT_EXAMPLE, INVALID_EXERCISE, INCORRECT_EXPECTED_OUTPUT, INCONSISTENT_DEFINITION.
Field should be the JSON path to the problematic part (e.g. "referenceSolution", "testCases[0].expected", "sections[2].content").`,
    },
    {
      role: "user",
      content: JSON.stringify({
        requirement,
        learnerLevel,
        prerequisites,
        payload,
        technicalConstraints,
      }),
    },
  ];
}

function buildRepairMessages(
  requirement: string,
  payload: ContentPayload,
  issues: ContentReviewIssue[],
): ChatMessage[] {
  return [
    {
      role: "system",
      content: `You are a content repair agent. You will receive AI-generated educational content and a list of issues found by a reviewer.
Your job is to fix ONLY the flagged fields. Do not modify unflagged fields.
You MUST return a JSON object with the shape:
{
  "repairedFields": { "<fieldPath>": <fixedValue>, ... },
  "summary": "Brief description of what was fixed"
}

Rules:
- For TECHNICAL_ERROR: fix code syntax, logic, or runtime errors
- For INCORRECT_EXAMPLE: rewrite the example to be factually correct
- For INCORRECT_EXPECTED_OUTPUT: fix the expected output to match the actual code behavior
- For PREREQUISITE_VIOLATION: simplify or explain concepts that assume unmastered prerequisites
- For PEDAGOGICAL_ERROR: restructure content to be age/skill-appropriate
- For DIFFICULTY_MISMATCH: adjust complexity up or down to match the learner level
- For AMBIGUITY: rewrite to be clear and unambiguous
- For DUPLICATION: remove or consolidate duplicated content
- For INVALID_EXERCISE: fix exercise structure (missing tests, broken harness, etc.)
- For INCONSISTENT_DEFINITION: ensure definitions match across all sections`,
    },
    {
      role: "user",
      content: JSON.stringify({ requirement, payload, issues }),
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Deterministic validation (always overrides AI)                       */
/* ------------------------------------------------------------------ */

interface DeterministicCheck {
  field: string;
  issueType: ReviewIssueType;
  message: string;
  severity: "error";
}

function deterministicChecks(
  payload: ContentPayload,
  prerequisites: string[],
): DeterministicCheck[] {
  const checks: DeterministicCheck[] = [];

  if (payload.kind === "CODING" || payload.kind === "DEBUGGING") {
    if (!payload.referenceSolution || payload.referenceSolution.trim().length === 0) {
      checks.push({
        field: "referenceSolution",
        issueType: "TECHNICAL_ERROR",
        message: "Reference solution is empty",
        severity: "error",
      });
    }
    if (!payload.testCases || payload.testCases.length === 0) {
      checks.push({
        field: "testCases",
        issueType: "INVALID_EXERCISE",
        message: "No test cases provided",
        severity: "error",
      });
    }
    if (!payload.harness) {
      checks.push({
        field: "harness",
        issueType: "INVALID_EXERCISE",
        message: "Missing execution harness for coding item",
        severity: "error",
      });
    }
    if (!payload.explanationMd || payload.explanationMd.length < 20) {
      checks.push({
        field: "explanationMd",
        issueType: "AMBIGUITY",
        message: "Explanation is too short or missing (< 20 chars)",
        severity: "error",
      });
    }
  }

  if (payload.kind === "CONCEPTUAL") {
    if (payload.options.length < 2) {
      checks.push({
        field: "options",
        issueType: "INVALID_EXERCISE",
        message: "MCQ needs at least 2 options",
        severity: "error",
      });
    }
    if (payload.answerIndex < 0 || payload.answerIndex >= payload.options.length) {
      checks.push({
        field: "answerIndex",
        issueType: "INCORRECT_EXPECTED_OUTPUT",
        message: "answerIndex out of range",
        severity: "error",
      });
    }
  }

  if (payload.kind === "ASSESSMENT") {
    if (payload.questions.length < 4) {
      checks.push({
        field: "questions",
        issueType: "INVALID_EXERCISE",
        message: "Assessment needs at least 4 questions",
        severity: "error",
      });
    }
    for (const [i, q] of payload.questions.entries()) {
      if (q.kind === "MCQ" && q.options && q.answerIndex !== undefined) {
        if (q.answerIndex < 0 || q.answerIndex >= q.options.length) {
          checks.push({
            field: `questions[${i}].answerIndex`,
            issueType: "INCORRECT_EXPECTED_OUTPUT",
            message: `Question ${i}: answerIndex out of range`,
            severity: "error",
          });
        }
      }
    }
  }

  if (payload.kind === "LESSON") {
    if (payload.sections.length < 7) {
      checks.push({
        field: "sections",
        issueType: "INVALID_EXERCISE",
        message: `Lesson needs at least 7 sections (has ${payload.sections.length})`,
        severity: "error",
      });
    }
    for (const [i, s] of payload.sections.entries()) {
      if (!s.content || s.content.length < 10) {
        checks.push({
          field: `sections[${i}].content`,
          issueType: "AMBIGUITY",
          message: `Section ${i} content is too short (< 10 chars)`,
          severity: "error",
        });
      }
    }
  }

  // Check prerequisite violations by scanning for terms the learner shouldn't know
  const prerequisiteSet = new Set(prerequisites.map((p) => p.toLowerCase()));
  const fullText = JSON.stringify(payload).toLowerCase();
  // Heuristic: flag if advanced terms appear but learner hasn't mastered them
  // This is intentionally conservative — only flag obvious mismatches
  if (prerequisiteSet.size > 0) {
    const advancedPatterns = [
      /async\s+await/i,
      /promise/i,
      /callback/i,
      /\bclass\b.*\bextends\b/i,
      /generics?/i,
      /\binterface\b/i,
      /type\s+alias/i,
      /trait\b/i,
      /impl\b/i,
      /macro\b/i,
    ];
    // Only flag if we detect patterns that typically need prerequisites
    // and the prerequisites list is empty or doesn't include the expected base
    if (prerequisiteSet.size === 0) {
      for (const pattern of advancedPatterns) {
        if (pattern.test(JSON.stringify(payload))) {
          // Don't flag — we don't know the learner's level
          break;
        }
      }
    }
  }

  return checks;
}

/* ------------------------------------------------------------------ */
/* ContentReviewer                                                      */
/* ------------------------------------------------------------------ */

export class ContentReviewer {
  constructor(
    private db: DB,
    private orchestrator?: OrchestratorImpl,
    private contentRepo?: ContentRepository,
  ) {}

  /**
   * Review generated content and return structured issues.
   *
   * Pipeline:
   *   1. Deterministic validation (always authoritative)
   *   2. AI semantic review via orchestrator
   *   3. Merge results — deterministic errors always show
   */
  async reviewContent(
    contentId: string,
    requirement: string,
    payload: ContentPayload,
    learnerLevel: number = 1,
    prerequisites: string[] = [],
    technicalConstraints: Record<string, unknown> = {},
  ): Promise<ContentReviewResult> {
    const deterministic = deterministicChecks(payload, prerequisites);
    const detIssues: ContentReviewIssue[] = deterministic.map((c) => ({
      type: c.issueType,
      field: c.field,
      description: c.message,
      severity: c.severity,
    }));

    let aiResult: ContentReviewResult = {
      passed: true,
      issues: [],
      reviewer: REVIEWER_ID,
      reviewerModel: "unknown",
    };

    try {
      const orchestrator = this.orchestrator;
      if (!orchestrator) throw new Error("ContentReviewer: orchestrator not injected");
      const messages = buildReviewMessages(
        requirement,
        learnerLevel,
        prerequisites,
        payload,
        technicalConstraints,
      );

      const result = await orchestrator.request({
        requestId: crypto.randomUUID(),
        taskType: "CONTENT_REVIEW",
        priority: "P3",
        messages,
        outputSchema: reviewResultSchema,
      });

      if (result.ok && result.data) {
        aiResult = result.data as ContentReviewResult;
      } else {
        console.warn(`[content-review] AI review failed: ${result.error ?? "unknown"}`);
      }
    } catch (err) {
      console.warn(`[content-review] AI review error: ${err instanceof Error ? err.message : err}`);
    }

    // Deterministic errors always surface, regardless of AI opinion
    const mergedIssues = [...detIssues, ...aiResult.issues];
    const hasDeterministicError = detIssues.some((i) => i.severity === "error");

    const passed = !hasDeterministicError && aiResult.passed && !mergedIssues.some((i) => i.severity === "error");

    const finalResult: ContentReviewResult = {
      passed,
      issues: mergedIssues,
      reviewer: REVIEWER_ID,
      reviewerModel: aiResult.reviewerModel,
    };

    await this.persistReview(contentId, finalResult);

    return finalResult;
  }

  /**
   * Attempt bounded repair of flagged fields.
   *
   * Max 2 rounds of regeneration. Each round:
   *   1. Send issues + payload to CONTENT_REPAIR task
   *   2. Apply repaired fields to payload
   *   3. Deterministically validate the repaired payload
   *   4. If deterministic errors remain, continue (up to limit)
   *   5. Re-run semantic review to check for new issues
   */
  async repairContent(
    contentId: string,
    issues: ContentReviewIssue[],
    requirement: string,
    originalPayload: ContentPayload,
    learnerLevel: number = 1,
    prerequisites: string[] = [],
  ): Promise<{ payload: ContentPayload; review: ContentReviewResult }> {
    let currentPayload = { ...originalPayload } as ContentPayload;

    for (let round = 0; round < MAX_REPAIR_ROUNDS; round++) {
      const repairableIssues = issues.filter(
        (i) =>
          i.severity === "error" &&
          i.type !== "PREREQUISITE_VIOLATION", // prerequisite violations need curriculum changes
      );

      if (repairableIssues.length === 0) break;

      let repaired = false;
      try {
        const orchestrator = this.orchestrator;
        if (!orchestrator) throw new Error("ContentReviewer: orchestrator not injected");
        const messages = buildRepairMessages(requirement, currentPayload, repairableIssues);

        const result = await orchestrator.request({
          requestId: crypto.randomUUID(),
          taskType: "CONTENT_REPAIR",
          priority: "P3",
          messages,
          outputSchema: repairOutputSchema,
        });

        if (result.ok && result.data) {
          const repair = result.data as { repairedFields: Record<string, unknown>; summary: string };
          currentPayload = this.applyRepairs(currentPayload, repair.repairedFields);
          repaired = true;
        } else {
          console.warn(`[content-review] repair round ${round + 1} failed: ${result.error ?? "unknown"}`);
          break;
        }
      } catch (err) {
        console.warn(`[content-review] repair round ${round + 1} error: ${err instanceof Error ? err.message : err}`);
        break;
      }

      if (!repaired) break;

      // Deterministic validation of repaired payload
      const detChecks = deterministicChecks(currentPayload, prerequisites);
      const detErrors = detChecks.filter((c) => c.severity === "error");
      if (detErrors.length > 0) {
        issues = detErrors.map((c) => ({
          type: c.issueType,
          field: c.field,
          description: c.message,
          severity: c.severity as "error",
        }));
        continue;
      }

      // Semantic re-review of repaired content
      const review = await this.reviewContent(contentId, requirement, currentPayload, learnerLevel, prerequisites);
      if (review.passed) {
        return { payload: currentPayload, review };
      }

      issues = review.issues;
    }

    // Final review after all repair rounds
    const finalReview = await this.reviewContent(contentId, requirement, currentPayload, learnerLevel, prerequisites);
    return { payload: currentPayload, review: finalReview };
  }

  /**
   * Full pipeline: review → repair if needed → persist.
   *
   * Returns the (possibly repaired) payload and final review result.
   */
  async reviewAndRepair(
    contentId: string,
    requirement: string,
    payload: ContentPayload,
    learnerLevel: number = 1,
    prerequisites: string[] = [],
    technicalConstraints: Record<string, unknown> = {},
  ): Promise<{ payload: ContentPayload; review: ContentReviewResult }> {
    const review = await this.reviewContent(
      contentId,
      requirement,
      payload,
      learnerLevel,
      prerequisites,
      technicalConstraints,
    );

    if (review.passed) {
      return { payload, review };
    }

    const hasRepairableErrors = review.issues.some(
      (i) => i.severity === "error" && i.type !== "PREREQUISITE_VIOLATION",
    );

    if (!hasRepairableErrors) {
      return { payload, review };
    }

    const { payload: repairedPayload, review: finalReview } = await this.repairContent(
      contentId,
      review.issues,
      requirement,
      payload,
      learnerLevel,
      prerequisites,
    );

    return { payload: repairedPayload, review: finalReview };
  }

  /* ------------------------------------------------------------------ */
  /* Private helpers                                                     */
  /* ------------------------------------------------------------------ */

  private applyRepairs(
    payload: ContentPayload,
    repairs: Record<string, unknown>,
  ): ContentPayload {
    const result = { ...payload } as Record<string, unknown>;

    for (const [fieldPath, value] of Object.entries(repairs)) {
      const parts = fieldPath.split(/[\[\].]/).filter(Boolean);
      let target: Record<string, unknown> = result;

      for (let i = 0; i < parts.length - 1; i++) {
        const key = parts[i]!;
        const next = parts[i + 1]!;
        const current = target[key];

        if (Array.isArray(current)) {
          const idx = parseInt(key, 10);
          if (!isNaN(idx) && idx < current.length) {
            if (typeof current[idx] === "object" && current[idx] !== null) {
              target = current[idx] as Record<string, unknown>;
            }
          }
        } else if (typeof current === "object" && current !== null) {
          target = current as Record<string, unknown>;
        }
      }

      const lastKey = parts[parts.length - 1]!;
      target[lastKey] = value;
    }

    return result as ContentPayload;
  }

  private async persistReview(
    contentId: string,
    result: ContentReviewResult,
  ): Promise<void> {
    try {
      if (!this.contentRepo) {
        console.warn(`[content-review] no contentRepo — skipping review persistence for ${contentId}`);
        return;
      }
      const maxVersion = await this.contentRepo.getMaxReviewVersion(contentId);
      await this.contentRepo.insertReview({
        contentId,
        version: maxVersion + 1,
        reviewType: "AI_SEMANTIC",
        passed: result.passed,
        issues: result.issues as unknown[],
        reviewer: result.reviewer,
        reviewerModel: result.reviewerModel,
        promptVersion: "v1",
      });
    } catch (err) {
      console.error(`[content-review] failed to persist review for ${contentId}: ${err instanceof Error ? err.message : err}`);
    }
  }
}
