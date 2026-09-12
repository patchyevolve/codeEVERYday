/**
 * Content validation — AI output is never trusted.
 *
 * - schema validation against the structured contract
 * - for CODING/DEBUGGING items: the reference solution is executed in the
 *   sandbox against the item's own test cases; only a full PASS publishes it.
 * - for ASSESSMENT/CONCEPTUAL items: answer indices and option uniqueness.
 */

import type { ContentPayload, ContentValidation } from "@cpd/core";
import { contentPayloadSchema } from "./content.js";
import { executeCode, executorHealthy } from "./executor-client.js";

export interface ValidateOptions {
  /** Minimum test cases a CODING/DEBUGGING item must carry to be validatable.
   *  Generated content requires 2+; hand-authored PROVIDER_SEED may have 1. */
  minTestCases?: number;
}

export async function validateContent(payload: ContentPayload, opts: ValidateOptions = {}): Promise<ContentValidation> {
  const minTestCases = opts.minTestCases ?? 2;
  const notes: string[] = [];
  const schemaRes = contentPayloadSchema.safeParse(payload);
  if (!schemaRes.success) {
    return {
      schemaOk: false,
      compiled: false,
      testsPassed: false,
      testCount: 0,
      executedAt: null,
      notes: [`schema: ${schemaRes.error.message.slice(0, 500)}`]
    };
  }

  if (payload.kind === "CODING" || payload.kind === "DEBUGGING") {
    if (!payload.harness) {
      return { schemaOk: true, compiled: false, testsPassed: false, testCount: 0, executedAt: null, notes: ["coding item missing harness"] };
    }
    const requiredTests = payload.harness?.language === "sql" ? 1 : minTestCases;
    if (payload.testCases.length < requiredTests) {
      return { schemaOk: true, compiled: false, testsPassed: false, testCount: 0, executedAt: null, notes: [`testCases: needs >= ${requiredTests} (has ${payload.testCases.length})`] };
    }
    const language = payload.harness.language;
    if (!["cpp", "python", "rust", "c", "bash", "js", "asm", "sql"].includes(language)) {
      return { schemaOk: true, compiled: false, testsPassed: false, testCount: 0, executedAt: null, notes: [`unsupported language ${language}`] };
    }

    if (!(await executorHealthy())) {
      return { schemaOk: true, compiled: false, testsPassed: false, testCount: 0, executedAt: null, notes: ["executor unreachable — content left unvalidated"] };
    }

    const result = await executeCode(
      language,
      payload.referenceSolution,
      payload.harness,
      payload.testCases,
      payload.harness.timeoutMs ?? 10000,
      payload.harness.memoryMb ?? 512
    );

    const testCount = result.results.length;
    const compiled = result.status !== "COMPILE_ERROR";
    const testsPassed = result.status === "PASS";
    if (result.compileError) notes.push(`compile: ${result.compileError.slice(0, 400)}`);
    for (const r of result.results) {
      if (!r.passed) {
        notes.push(`test ${r.index} "${r.description ?? ""}" failed: expected=${JSON.stringify(r.expected)} actual=${JSON.stringify(r.actual)}`);
      }
    }
    if (result.status === "EXECUTOR_ERROR") notes.push(`executor: ${result.error ?? "unknown"}`);

    return { schemaOk: true, compiled, testsPassed, testCount, executedAt: new Date().toISOString(), notes };
  }

  if (payload.kind === "ASSESSMENT") {
    const problems: string[] = [];
    payload.questions.forEach((q, i) => {
      if (q.kind === "MCQ" && (!q.options || q.options.length < 2)) problems.push(`question ${i}: MCQ needs >= 2 options`);
      if (q.kind === "MCQ" && (q.answerIndex === undefined || q.answerIndex < 0 || q.answerIndex >= (q.options?.length ?? 0))) {
        problems.push(`question ${i}: answerIndex out of range`);
      }
      if (q.kind === "MCQ" && q.options && new Set(q.options.map((o, j) => (j === q.answerIndex ? `[${o}]` : o))).size !== q.options.length) {
        problems.push(`question ${i}: duplicate options`);
      }
    });
    if (problems.length > 0) {
      return { schemaOk: true, compiled: false, testsPassed: false, testCount: 0, executedAt: new Date().toISOString(), notes: problems };
    }
    return { schemaOk: true, compiled: true, testsPassed: true, testCount: payload.questions.length, executedAt: new Date().toISOString(), notes: [] };
  }

  if (payload.kind === "CONCEPTUAL") {
    if (payload.answerIndex < 0 || payload.answerIndex >= payload.options.length) {
      return { schemaOk: true, compiled: false, testsPassed: false, testCount: 0, executedAt: new Date().toISOString(), notes: ["answerIndex out of range"] };
    }
    if (new Set(payload.options).size !== payload.options.length) {
      return { schemaOk: true, compiled: false, testsPassed: false, testCount: 0, executedAt: new Date().toISOString(), notes: ["duplicate options"] };
    }
  }

  return { schemaOk: true, compiled: true, testsPassed: true, testCount: 1, executedAt: new Date().toISOString(), notes };
}