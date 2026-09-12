/**
 * Task content sanitization — the learner gets the problem, never the answers.
 * Strips reference solutions, test cases, answer keys, and acceptance lists.
 */

import type { ContentPayload } from "@cpd/core";

export function sanitizePayload(p: ContentPayload): Record<string, unknown> {
  const out: Record<string, unknown> = { kind: p.kind };

  if (p.kind === "LESSON") {
    out.sections = p.sections;
  } else if (p.kind === "CODING" || p.kind === "DEBUGGING") {
    out.hints = p.hints;
    out.scaffold = p.scaffold;
    out.explanationMd = p.explanationMd;
    out.harness = p.harness
      ? {
          language: p.harness.language,
          entryFn: p.harness.entryFn,
          argTypes: p.harness.argTypes,
          returnType: p.harness.returnType
        }
      : null;
  } else if (p.kind === "CONCEPTUAL") {
    out.options = p.options;
    out.explanationMd = p.explanationMd;
    out.hints = p.hints;
  } else if (p.kind === "TRACING" || p.kind === "PREDICTION") {
    out.codeSnippet = p.codeSnippet;
    out.explanationMd = p.explanationMd;
    out.hints = p.hints;
  } else if (p.kind === "ASSESSMENT") {
    out.promptMd = p.promptMd;
    out.questions = p.questions.map((q) => {
      const qq: Record<string, unknown> = { kind: q.kind, prompt: q.prompt, explanation: q.explanation };
      if (q.kind === "MCQ" && q.options) qq.options = q.options;
      return qq;
    });
  } else if (p.kind === "REAL_WORLD") {
    out.contextMd = p.contextMd;
    out.reflectionQuestions = p.reflectionQuestions;
    out.explanationMd = p.explanationMd;
  } else if (p.kind === "PROJECT") {
    out.briefMd = p.briefMd;
    out.requirements = p.requirements;
    out.checklist = p.checklist;
    out.rubric = p.rubric;
  }

  return out;
}