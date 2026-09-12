import { z } from "zod";

/**
 * Content contract for curriculum seed data.
 * Content lives as data files; validating against this schema keeps the
 * curriculum editable without touching application code.
 */

export const lessonSectionSchema = z.object({
  type: z.enum(["markdown", "code", "callout"]),
  title: z.string().optional(),
  content: z.string().min(1),
  language: z.string().optional(),
  calloutKind: z.enum(["info", "warning", "common-mistake", "real-world", "why"]).optional()
});

export const hintSchema = z.object({
  threshold: z.number().int().min(1),
  text: z.string().min(1)
});

export const testCaseSchema = z.object({
  input: z.unknown(),
  expected: z.unknown(),
  description: z.string().optional()
});

export const harnessSchema = z.object({
  language: z.enum(["cpp", "python"]),
  entryFn: z.string().min(1),
  args: z.union([z.array(z.unknown()), z.literal("auto")]),
  comparator: z.enum(["exact", "float", "array", "array_float", "map"]),
  argTypes: z.array(z.string()).optional(),
  returnType: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
  memoryMb: z.number().int().positive().optional(),
  testCases: z
    .array(
      z.object({
        input: z.unknown(),
        expected: z.unknown(),
        description: z.string().optional()
      })
    )
    .optional()
});

export const lessonSchema = z.object({
  title: z.string().min(1),
  estMinutes: z.number().int().positive(),
  content: z.array(lessonSectionSchema).min(1)
});

export const exerciseSchema = z.object({
  kind: z.enum(["CODING", "CONCEPTUAL", "DEBUGGING", "TRACING", "PREDICTION"]),
  title: z.string().min(1),
  promptMd: z.string().min(20),
  difficulty: z.number().int().min(1).max(5),
  estMinutes: z.number().int().positive(),
  hints: z.array(hintSchema).default([]),
  harness: harnessSchema.optional(),
  scaffold: z.string().optional(),
  referenceSolution: z.string().min(1).optional(),
  explanationMd: z.string().min(1).optional(),
  answer: z
    .object({
      kind: z.enum(["mcq", "text", "checklist"]),
      options: z.array(z.string()).optional(),
      answerIndex: z.number().int().min(0).optional(),
      accepted: z.array(z.string()).optional(),
      items: z.array(z.string()).optional(),
      normalize: z.enum(["lower", "trim", "strip_code"]).optional()
    })
    .optional(),
  mistakePattern: z.string().optional(),
  tags: z.array(z.string()).default([])
});

export const assessmentQuestionSchema = z.object({
  kind: z.enum(["MCQ", "EXPLAIN"]),
  prompt: z.string().min(1),
  options: z.array(z.string()).optional(),
  answerIndex: z.number().int().min(0).optional(),
  explanation: z.string().min(1),
  conceptSlug: z.string().optional(),
  points: z.number().int().positive()
});

export const assessmentSchema = z.object({
  title: z.string().min(1),
  estMinutes: z.number().int().positive(),
  passThreshold: z.number().min(0).max(1).default(0.7),
  questions: z.array(assessmentQuestionSchema).min(2)
});

export const conceptSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
  description: z.string().min(10),
  estMinutes: z.number().int().positive(),
  difficulty: z.number().int().min(1).max(5),
  prerequisites: z.array(z.string()).default([]),
  masteryTarget: z.number().min(0).max(1).default(0.85),
  lesson: lessonSchema,
  exercises: z.array(exerciseSchema).min(1),
  assessment: assessmentSchema
});

export const topicSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
  concepts: z.array(conceptSchema).min(1)
});

export const moduleSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
  description: z.string().min(10),
  position: z.number().int().min(0),
  levelGate: z.number().int().min(0).default(0),
  topics: z.array(topicSchema).min(1)
});

export const trackSchema = z.object({
  languageKey: z.enum(["cpp", "python", "java", "javascript", "typescript", "go", "rust", "c"]),
  languageName: z.string().min(1),
  modules: z.array(moduleSchema).min(1)
});

export const seedBundleSchema = z.object({
  version: z.number().int().positive().default(1),
  notes: z.string().optional(),
  tracks: z.array(trackSchema).min(1)
});

export type LessonSectionSeed = z.infer<typeof lessonSectionSchema>;
export type ExerciseSeed = z.infer<typeof exerciseSchema>;
export type ConceptSeed = z.infer<typeof conceptSchema>;
export type TrackSeed = z.infer<typeof trackSchema>;
export type SeedBundle = z.infer<typeof seedBundleSchema>;