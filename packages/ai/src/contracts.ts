/**
 * AI Subsystem Contracts — single source of truth for all cross-component
 * interfaces. Every component depends on these interfaces, never on concrete
 * implementations.
 *
 * Spec reference: usethisforAIsubsystem.txt §3–§9, §61
 * Design doc: docs/ai-subsystem-design.md §2–§7
 */

import type { z } from "zod";

/* ------------------------------------------------------------------ */
/* Task types                                                          */
/* ------------------------------------------------------------------ */

export type AITaskType =
  | "CURRICULUM_PLANNING"
  | "DAILY_SESSION_PLANNING"
  | "SESSION_REVIEW"
  | "LEARNER_DIAGNOSIS"
  | "HYPOTHESIS_GENERATION"
  | "HYPOTHESIS_EVALUATION"
  | "TUTOR_EXPLANATION"
  | "TUTOR_CLARIFICATION"
  | "TUTOR_HINT"
  | "TUTOR_EXAMPLE"
  | "TUTOR_ANALOGY"
  | "TUTOR_DEBUGGING"
  | "TUTOR_CODE_REVIEW"
  | "SESSION_SUMMARY"
  | "LEARNER_STATE_ANALYSIS"
  | "CONTENT_GENERATION"
  | "CONTENT_REVIEW"
  | "CONTENT_REPAIR"
  | "CONTENT_CLASSIFICATION"
  | "REMEDIATION_GENERATION";

/* ------------------------------------------------------------------ */
/* Priority                                                             */
/* ------------------------------------------------------------------ */

/**
 * P0 = learner currently waiting for tutor response (NEVER queue)
 * P1 = active session critical work
 * P2 = preparation for upcoming session
 * P3 = background content generation
 * P4 = optimization / regeneration / experiments
 */
export type Priority = "P0" | "P1" | "P2" | "P3" | "P4";

const PRIORITY_ORDER: Record<Priority, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
  P4: 4,
};

export function priorityRank(p: Priority): number {
  return PRIORITY_ORDER[p];
}

/* ------------------------------------------------------------------ */
/* Error taxonomy                                                       */
/* ------------------------------------------------------------------ */

export type AIErrorKind =
  | "RATE_LIMIT"
  | "DAILY_QUOTA_EXHAUSTED"
  | "TOKEN_QUOTA_EXHAUSTED"
  | "PROVIDER_FAILURE"
  | "MODEL_UNAVAILABLE"
  | "INVALID_REQUEST"
  | "INVALID_CREDENTIALS"
  | "MALFORMED_RESPONSE"
  | "TIMEOUT"
  | "NETWORK_FAILURE"
  | "UNEXPECTED_CONTENT"
  | "CACHE_MISS"
  | "UNKNOWN";

/* ------------------------------------------------------------------ */
/* Chat messages                                                        */
/* ------------------------------------------------------------------ */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/* ------------------------------------------------------------------ */
/* AI Request / Response                                                */
/* ------------------------------------------------------------------ */

export interface AIRequest {
  requestId: string;
  taskType: AITaskType;
  priority: Priority;
  userId?: string;
  sessionId?: string;
  jobId?: string;
  messages: ChatMessage[];
  outputSchema?: z.ZodType;
  contextBudgetTokens?: number;
  cacheKey?: string;
  /** If true, bypass cache — used for non-deterministic or user-specific requests. */
  unique?: boolean;
  /** Required capabilities the model must satisfy. */
  requiredCapabilities?: string[];
  /** Maximum time to wait for this request. */
  timeoutMs?: number;
  /** Fallback chain: identical semantic tasks routed on failure. */
  fallbackChain?: number;
}

export interface AIResult {
  ok: boolean;
  requestId: string;
  content?: string;
  data?: unknown;
  provider: string;
  model: string;
  latencyMs: number;
  tokens: { in: number; out: number };
  costUsd: number;
  fromCache: boolean;
  error?: AIErrorKind;
  fallbackUsed: boolean;
  retryCount: number;
}

/* ------------------------------------------------------------------ */
/* Provider metadata                                                    */
/* ------------------------------------------------------------------ */

export interface ModelCapabilities {
  structuredOutput: boolean;
  streaming: boolean;
  toolCalling: boolean;
  code: boolean;
  fastLatency: boolean;
  vision: boolean;
}

export interface ProviderModel {
  providerId: string;
  modelId: string;
  displayName: string;
  capabilities: ModelCapabilities;
  contextWindow: number;
  outputLimit: number;
  /** Cost per 1K input tokens in USD. */
  costPer1kIn: number;
  /** Cost per 1K output tokens in USD. */
  costPer1kOut: number;
  /** Average latency in ms (for routing decisions). */
  avgLatencyMs: number;
  /** Rate limits per window. */
  rateLimits: {
    rpm: number; // requests per minute
    tpm: number; // tokens per minute
    rpd: number; // requests per day
    tpd: number; // tokens per day
  };
  enabled: boolean;
}

export interface ProviderConfig {
  providerId: string;
  displayName: string;
  baseUrl: string;
  apiKey: string;
  models: ProviderModel[];
  enabled: boolean;
}

/* ------------------------------------------------------------------ */
/* Provider state (persisted — circuit breaker, quota windows)          */
/* ------------------------------------------------------------------ */

export interface ProviderState {
  providerId: string;
  /** Circuit breaker state. */
  breakerState: "CLOSED" | "OPEN" | "HALF_OPEN";
  breakerOpenedAt: Date | null;
  consecutiveFailures: number;
  lastFailureAt: Date | null;
  lastSuccessAt: Date | null;
  /** Current quota window usage. */
  quotaWindow: {
    requestsToday: number;
    tokensToday: number;
    lastResetAt: Date;
  };
}

/* ------------------------------------------------------------------ */
/* Routing decision                                                     */
/* ------------------------------------------------------------------ */

export interface RoutingDecision {
  providerId: string;
  modelId: string;
  reason: string;
}

/* ------------------------------------------------------------------ */
/* Orchestrator                                                         */
/* ------------------------------------------------------------------ */

export interface OrchestratorRequest {
  requestId: string;
  taskType: AITaskType;
  priority: Priority;
  userId?: string;
  sessionId?: string;
  jobId?: string;
  messages: ChatMessage[];
  outputSchema?: z.ZodType;
  contextBudgetTokens?: number;
  cacheKey?: string;
  requiredCapabilities?: string[];
  timeoutMs?: number;
}

export interface JobRef {
  jobId: string;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
}

/* ------------------------------------------------------------------ */
/* AI Gateway (main entry point)                                        */
/* ------------------------------------------------------------------ */

export interface AIGateway {
  /** Synchronous request — P0/P1. Blocks until result or fallback. */
  request(req: AIRequest): Promise<AIResult>;
  /** Enqueue for background processing — P2–P4 via pg-boss. */
  enqueue(req: AIRequest): Promise<JobRef>;
  /** Get a raw provider for callers that need direct access (provider.ts compat). */
  getRawProvider(): RawProvider;
}

export interface RawProvider {
  readonly name: string;
  readonly configured: boolean;
  chat(messages: ChatMessage[], opts?: { temperature?: number; maxTokens?: number; timeoutMs?: number; jsonMode?: boolean }): Promise<string>;
}

/* ------------------------------------------------------------------ */
/* Orchestrator interface                                               */
/* ------------------------------------------------------------------ */

export interface Orchestrator {
  /** Synchronous request — P0/P1 work. */
  request(req: OrchestratorRequest): Promise<AIResult>;
  /** Enqueue background work — P2–P4. */
  enqueue(req: OrchestratorRequest): Promise<JobRef>;
}

/* ------------------------------------------------------------------ */
/* Tutor Engine (extended — additive to existing API)                   */
/* ------------------------------------------------------------------ */

export interface TutorMessage {
  type: "LEARNER_MESSAGE" | "LEARNER_CLAIM" | "LEARNER_CORRECTION" | "SYSTEM_EVENT";
  content: string;
  metadata?: Record<string, unknown>;
}

export interface TutorResponse {
  action: TutorAction;
  content?: string;
  hypothesis?: Hypothesis;
  evidence?: EvidenceEvent[];
  stateChanges?: Record<string, unknown>;
}

export type TutorAction =
  | "CONTINUE"
  | "EXPLAIN"
  | "REEXPLAIN"
  | "ASK"
  | "DIAGNOSE"
  | "GIVE_HINT"
  | "GUIDED_SOLUTION"
  | "REVIEW_PREREQUISITE"
  | "CHANGE_TEACHING_METHOD"
  | "REPEAT"
  | "ADVANCE"
  | "REMEDIATE"
  | "PAUSE"
  | "END_SESSION";

/* ------------------------------------------------------------------ */
/* Evidence event                                                       */
/* ------------------------------------------------------------------ */

export type EvidenceType =
  | "ANSWER"
  | "QUESTION"
  | "CODE_SUBMISSION"
  | "CODE_EXECUTION"
  | "ERROR"
  | "EXERCISE_RESULT"
  | "EXPLANATION"
  | "HINT_REQUEST"
  | "SELF_CORRECTION"
  | "CONFIDENCE_STATEMENT"
  | "LEARNER_CLAIM"
  | "SESSION_BEHAVIOR";

export type EvidenceSource = "learner" | "compiler" | "assessment" | "tutor" | "system";
export type EvidenceResult = "correct" | "incorrect" | "partial" | "timeout" | "error";

export interface EvidenceEvent {
  id: string;
  userId: string;
  sessionId?: string;
  type: EvidenceType;
  concept?: string;
  result?: EvidenceResult;
  source: EvidenceSource;
  payload: Record<string, unknown>;
  observedAt: Date;
}

/* ------------------------------------------------------------------ */
/* Hypothesis                                                           */
/* ------------------------------------------------------------------ */

export type HypothesisStatus =
  | "ACTIVE"
  | "UNCERTAIN"
  | "CONFIRMED"
  | "WEAKENED"
  | "DISPROVEN"
  | "SUPERSEDED";

export interface Hypothesis {
  id: string;
  userId: string;
  subject: string;
  statement: string;
  confidence: number;
  supportingEvidence: string[];
  contradictingEvidence: string[];
  alternatives: string[];
  status: HypothesisStatus;
  createdAt: Date;
  lastEvaluatedAt: Date;
}

/* ------------------------------------------------------------------ */
/* Tutor Decision (audit)                                               */
/* ------------------------------------------------------------------ */

export type DecisionVerdict = "unknown" | "correct" | "incorrect";

export interface TutorDecisionRecord {
  id: string;
  sessionId: string;
  userId: string;
  observations: string[];
  hypotheses: string[];
  selectedHypothesis?: string;
  confidence: number;
  action: TutorAction;
  expectedOutcome: string;
  actualOutcome?: string;
  verdict: DecisionVerdict;
  correction?: string;
}

/* ------------------------------------------------------------------ */
/* Tutor Experience Memory                                              */
/* ------------------------------------------------------------------ */

export type StrategyOutcome = "effective" | "ineffective" | "mixed";

export interface TutorExperienceRecord {
  id: string;
  concept: string;
  learnerProblem: string;
  strategy: string;
  outcome: StrategyOutcome;
  context: {
    learnerState?: string;
    difficulty?: number;
  };
  evidenceRefs: string[];
  createdAt: Date;
}

/* ------------------------------------------------------------------ */
/* Session Report / Handoff                                             */
/* ------------------------------------------------------------------ */

export interface SessionReport {
  sessionId: string;
  userId: string;
  objective: string;
  planned: string[];
  completed: string[];
  incomplete: string[];
  evidenceSummary: string;
  strengths: string[];
  weaknesses: string[];
  misconceptions: string[];
  unresolvedHypotheses: string[];
  strategies: { strategy: string; outcome: StrategyOutcome }[];
  learnerQuestions: string[];
  learnerContext: string[];
  environmentalIssues: string[];
  hintDependency: number;
  independentPerformance: number;
  retention: number;
  decisionsRequiringReview: string[];
  recommendedNext: string[];
}

/* ------------------------------------------------------------------ */
/* Context Compiler                                                     */
/* ------------------------------------------------------------------ */

export interface CompiledContext {
  systemPrompt: string;
  messages: ChatMessage[];
  tokenEstimate: number;
}

export interface ContextCompilerInput {
  taskType: AITaskType;
  userId?: string;
  sessionId?: string;
  objective?: string;
  sessionState?: Record<string, unknown>;
  learnerDimensions?: { dimension: string; value: number; confidence: number }[];
  history?: { date: string; summary: string }[];
  tutorExperience?: TutorExperienceRecord[];
  approvedContent?: Record<string, unknown>[];
  currentMessage?: string;
  budgetTokens: number;
}

/* ------------------------------------------------------------------ */
/* Memory System                                                        */
/* ------------------------------------------------------------------ */

export interface SessionMemory {
  sessionId: string;
  userId: string;
  date: string;
  objective: string;
  planned: string[];
  actual: string[];
  conceptsDiscussed: string[];
  learnerQuestions: string[];
  mistakes: string[];
  exercises: string[];
  results: string[];
  interventions: string[];
  learnerClaims: string[];
  environmentalContext: string[];
  unfinishedWork: string[];
  tutorDecisions: string[];
  outcomes: string[];
}

export type MemoryQueryKind = "EXACT_DATE" | "CONCEPT_INDEX" | "SEMANTIC" | "CURRENT_STATE";

export interface MemoryQuery {
  kind: MemoryQueryKind;
  userId: string;
  date?: string;
  concept?: string;
  text?: string;
  limit?: number;
}

export interface MemoryHit {
  id: string;
  store: "session" | "learner" | "historical" | "tutor_experience" | "temporary";
  kind: string;
  data: Record<string, unknown>;
  score: number;
  date?: string;
}

export interface MemorySystem {
  recordSessionMemory(s: SessionMemory): Promise<void>;
  recordHistorical(e: EvidenceEvent): Promise<void>;
  recordTutorExperience(x: TutorExperienceRecord): Promise<void>;
  query(q: MemoryQuery): Promise<MemoryHit[]>;
}

/* ------------------------------------------------------------------ */
/* Learner Model                                                        */
/* ------------------------------------------------------------------ */

export type LearnerDimension =
  | "conceptual_understanding"
  | "procedural_skill"
  | "implementation_skill"
  | "problem_recognition"
  | "reasoning"
  | "explanation_ability"
  | "debugging_skill"
  | "transfer_ability"
  | "retention"
  | "independence"
  | "hint_dependency"
  | "confidence";

export interface DimensionValue {
  dimension: LearnerDimension;
  value: number;
  confidence: number;
  evidenceRefs: string[];
  lastUpdated: Date;
}

export interface LearnerSnapshot {
  userId: string;
  dimensions: DimensionValue[];
  overallMastery: number;
  lastUpdated: Date;
}

/* ------------------------------------------------------------------ */
/* Content Review                                                       */
/* ------------------------------------------------------------------ */

export type ReviewIssueType =
  | "TECHNICAL_ERROR"
  | "PREREQUISITE_VIOLATION"
  | "PEDAGOGICAL_ERROR"
  | "DIFFICULTY_MISMATCH"
  | "AMBIGUITY"
  | "DUPLICATION"
  | "INCORRECT_EXAMPLE"
  | "INVALID_EXERCISE"
  | "INCORRECT_EXPECTED_OUTPUT"
  | "INCONSISTENT_DEFINITION";

export interface ContentReviewIssue {
  type: ReviewIssueType;
  field: string;
  description: string;
  severity: "error" | "warning";
}

export interface ContentReviewResult {
  passed: boolean;
  issues: ContentReviewIssue[];
  reviewer: string;
  reviewerModel: string;
}
