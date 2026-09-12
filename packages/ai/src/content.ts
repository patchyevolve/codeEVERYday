import type { ExecutorLanguage } from "@cpd/core";
/**
 * Structured contracts for AI-generated teaching content.
 * Everything the AI produces must satisfy these schemas; invalid output is
 * rejected and falls back to deterministic TEMPLATE generation.
 */

import { z } from "zod";
import type { ContentPayload } from "@cpd/core";

export const lessonSectionSchema = z.object({
  type: z.enum(["markdown", "code", "callout"]),
  title: z.string().min(1),
  content: z.string().min(10),
  language: z.string().optional(),
  calloutKind: z.enum(["info", "warning", "common-mistake", "real-world", "why"]).optional()
});

export const hintSchema = z.object({ threshold: z.number().int().min(1), text: z.string().min(1) });

export const testCaseSchema = z.object({
  input: z.unknown(),
  expected: z.unknown(),
  description: z.string().optional()
});

export const harnessSchema = z.object({
  language: z.enum(["cpp", "python", "rust", "c", "bash", "js", "asm", "sql"]),
  entryFn: z.string().regex(/^$|^[a-zA-Z_][a-zA-Z0-9_]*$/),
  args: z.union([z.array(z.unknown()), z.literal("auto")]),
  comparator: z.enum(["exact", "float", "array", "array_float", "map"]),
  argTypes: z.array(z.string()).optional(),
  returnType: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
  memoryMb: z.number().int().positive().optional(),
  schema: z.string().optional(),
  verificationQuery: z.string().optional()
});

const lessonPayloadSchema = z.object({
  kind: z.literal("LESSON"),
  sections: z.array(lessonSectionSchema).min(7).max(16)
});

const codingPayloadSchema = z.object({
  kind: z.enum(["CODING", "DEBUGGING"]),
  hints: z.array(hintSchema).min(2).max(5),
  harness: harnessSchema,
  testCases: z.array(testCaseSchema).min(1).max(20),
  scaffold: z.string().min(1),
  referenceSolution: z.string().min(1),
  explanationMd: z.string().min(20),
  mistakePattern: z.string().optional(),
  tags: z.array(z.string()).optional()
});

const conceptualPayloadSchema = z.object({
  kind: z.literal("CONCEPTUAL"),
  options: z.array(z.string()).min(2).max(6),
  answerIndex: z.number().int().min(0),
  hints: z.array(hintSchema).max(3),
  explanationMd: z.string().min(20)
});

const tracingPayloadSchema = z.object({
  kind: z.enum(["TRACING", "PREDICTION"]),
  codeSnippet: z.string().min(1),
  acceptedAnswers: z.array(z.string()).min(1),
  explanationMd: z.string().min(20),
  hints: z.array(hintSchema).max(3)
});

const assessmentQuestionSchema = z.object({
  kind: z.enum(["MCQ", "EXPLAIN"]),
  prompt: z.string().min(5),
  options: z.array(z.string()).min(2).optional(),
  answerIndex: z.number().int().min(0).optional(),
  explanation: z.string().min(10),
  conceptSlug: z.string().optional(),
  points: z.number().int().positive()
});

const assessmentPayloadSchema = z.object({
  kind: z.literal("ASSESSMENT"),
  questions: z.array(assessmentQuestionSchema).min(4).max(6),
  passThreshold: z.number().min(0).max(1).default(0.7),
  promptMd: z.string().optional()
});

const realWorldPayloadSchema = z.object({
  kind: z.literal("REAL_WORLD"),
  contextMd: z.string().min(30),
  reflectionQuestions: z.array(z.string().min(5)).min(2).max(4),
  explanationMd: z.string().min(20)
});

const projectPayloadSchema = z.object({
  kind: z.literal("PROJECT"),
  briefMd: z.string().min(50),
  requirements: z.array(z.string().min(5)).min(3).max(8),
  checklist: z.array(z.string().min(5)).min(3).max(10),
  rubric: z.array(z.object({ criterion: z.string().min(3), maxPoints: z.number().int().positive() })).min(2).max(6),
  estMinutesTotal: z.number().int().positive().optional()
});

export const contentPayloadSchema = z.discriminatedUnion("kind", [
  lessonPayloadSchema,
  codingPayloadSchema,
  conceptualPayloadSchema,
  tracingPayloadSchema,
  assessmentPayloadSchema,
  realWorldPayloadSchema,
  projectPayloadSchema
]) as z.ZodType<ContentPayload>;

/** Context handed to every generator. */
export interface GenContext {
  languageKey: ExecutorLanguage;
  nodeKey: string;
  label: string;
  definition: string;
  difficulty: number;
  estMinutes: number;
  applications: string[];
  misconceptions: string[];
  learner: {
    level: number;
    prerequisitesMastered: string[];
    recentMistakes: string[];
  };
  existingContentCount: number;
  /** deterministic seed for template generation */
  seed: number;
}

export interface GeneratedLesson {
  title: string;
  payload: Extract<ContentPayload, { kind: "LESSON" }>;
  source: "AI_GENERATED" | "TEMPLATE";
}

export interface GeneratedExercise {
  title: string;
  payload: Exclude<ContentPayload, { kind: "LESSON" } | { kind: "ASSESSMENT" } | { kind: "PROJECT" } | { kind: "REAL_WORLD" }>;
  source: "AI_GENERATED" | "TEMPLATE";
}

export interface GeneratedAssessment {
  title: string;
  payload: Extract<ContentPayload, { kind: "ASSESSMENT" }>;
  source: "AI_GENERATED" | "TEMPLATE";
}

export interface GeneratedRealWorld {
  title: string;
  payload: Extract<ContentPayload, { kind: "REAL_WORLD" }>;
  source: "AI_GENERATED" | "TEMPLATE";
}

export interface GeneratedProject {
  title: string;
  payload: Extract<ContentPayload, { kind: "PROJECT" }>;
  source: "AI_GENERATED" | "TEMPLATE";
}