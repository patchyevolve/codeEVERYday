/**
 * AI Orchestrator — the only entry point for AI work from higher layers.
 *
 * Classifies tasks, checks cache, reserves quota by priority, routes,
 * executes, validates, retries/falls back, records usage, returns result.
 *
 * P0/P1 are synchronous. P2–P4 are enqueued via pg-boss (stubbed for now).
 */

import type { DB } from "@cpd/core";
import type {
  AIRequest,
  AIResult,
  ChatMessage,
  Orchestrator,
  OrchestratorRequest,
  JobRef,
  Priority,
  AITaskType,
} from "./contracts.js";
import type { AIGatewayImpl } from "./gateway/gateway.js";
import type { z } from "zod";

const SYNCHRONOUS_PRIORITIES = new Set<Priority>(["P0", "P1"]);

/** Capability requirements per task type. */
const TASK_CAPABILITIES: Record<AITaskType, string[]> = {
  CURRICULUM_PLANNING: ["code"],
  DAILY_SESSION_PLANNING: ["code"],
  SESSION_REVIEW: ["code"],
  LEARNER_DIAGNOSIS: ["code"],
  HYPOTHESIS_GENERATION: ["code"],
  HYPOTHESIS_EVALUATION: ["code"],
  TUTOR_EXPLANATION: ["code"],
  TUTOR_CLARIFICATION: ["code"],
  TUTOR_HINT: ["code"],
  TUTOR_EXAMPLE: ["code"],
  TUTOR_ANALOGY: ["code"],
  TUTOR_DEBUGGING: ["code"],
  TUTOR_CODE_REVIEW: ["code"],
  SESSION_SUMMARY: ["code"],
  LEARNER_STATE_ANALYSIS: ["code"],
  CONTENT_GENERATION: ["code"],
  CONTENT_REVIEW: ["code"],
  CONTENT_REPAIR: ["code"],
  CONTENT_CLASSIFICATION: ["code"],
  REMEDIATION_GENERATION: ["code"],
};

/** Default priority by task type. */
const DEFAULT_PRIORITY: Record<AITaskType, Priority> = {
  TUTOR_EXPLANATION: "P0",
  TUTOR_CLARIFICATION: "P0",
  TUTOR_HINT: "P0",
  TUTOR_DEBUGGING: "P0",
  TUTOR_CODE_REVIEW: "P0",
  TUTOR_ANALOGY: "P1",
  TUTOR_EXAMPLE: "P1",
  LEARNER_DIAGNOSIS: "P1",
  HYPOTHESIS_GENERATION: "P1",
  HYPOTHESIS_EVALUATION: "P1",
  SESSION_SUMMARY: "P1",
  LEARNER_STATE_ANALYSIS: "P1",
  CURRICULUM_PLANNING: "P2",
  DAILY_SESSION_PLANNING: "P2",
  SESSION_REVIEW: "P2",
  CONTENT_GENERATION: "P3",
  CONTENT_REVIEW: "P3",
  CONTENT_REPAIR: "P3",
  CONTENT_CLASSIFICATION: "P4",
  REMEDIATION_GENERATION: "P3",
};

export class OrchestratorImpl implements Orchestrator {
  private readonly db: DB;
  private readonly gateway: AIGatewayImpl;

  constructor(db: DB, gateway: AIGatewayImpl) {
    this.db = db;
    this.gateway = gateway;
  }

  async request(req: OrchestratorRequest): Promise<AIResult> {
    const effectivePriority = req.priority ?? DEFAULT_PRIORITY[req.taskType] ?? "P1";

    const effectiveCapabilities = [
      ...(req.requiredCapabilities ?? []),
      ...(TASK_CAPABILITIES[req.taskType] ?? []),
    ];

    const aiRequest: AIRequest = {
      requestId: req.requestId || crypto.randomUUID(),
      taskType: req.taskType,
      priority: effectivePriority,
      userId: req.userId,
      sessionId: req.sessionId,
      jobId: req.jobId,
      messages: req.messages,
      outputSchema: req.outputSchema,
      contextBudgetTokens: req.contextBudgetTokens,
      cacheKey: req.cacheKey,
      requiredCapabilities: effectiveCapabilities,
      timeoutMs: req.timeoutMs,
    };

    if (SYNCHRONOUS_PRIORITIES.has(effectivePriority)) {
      return this.gateway.request(aiRequest);
    }

    return this.gateway.enqueue(aiRequest).then((jobRef) => ({
      ok: true,
      requestId: aiRequest.requestId,
      provider: "",
      model: "",
      latencyMs: 0,
      tokens: { in: 0, out: 0 },
      costUsd: 0,
      fromCache: false,
      fallbackUsed: false,
      retryCount: 0,
      data: { jobId: jobRef.jobId, status: jobRef.status },
    }));
  }

  async enqueue(req: OrchestratorRequest): Promise<JobRef> {
    const effectivePriority = req.priority ?? DEFAULT_PRIORITY[req.taskType] ?? "P3";

    const aiRequest: AIRequest = {
      requestId: req.requestId || crypto.randomUUID(),
      taskType: req.taskType,
      priority: effectivePriority,
      userId: req.userId,
      sessionId: req.sessionId,
      jobId: req.jobId,
      messages: req.messages,
      outputSchema: req.outputSchema,
      contextBudgetTokens: req.contextBudgetTokens,
      cacheKey: req.cacheKey,
      requiredCapabilities: req.requiredCapabilities,
      timeoutMs: req.timeoutMs,
    };

    return this.gateway.enqueue(aiRequest);
  }

  /**
   * Request structured JSON from the AI provider, validated against a zod schema.
   * Routes through the gateway for quota/rate-limit/circuit-breaker handling.
   * Returns null when the provider is not configured or output is invalid.
   */
  async generateStructured<T>(
    schema: z.ZodType<T>,
    messages: ChatMessage[],
    opts: { taskType?: AITaskType; userId?: string; sessionId?: string; timeoutMs?: number } = {}
  ): Promise<T | null> {
    const result = await this.request({
      requestId: crypto.randomUUID(),
      taskType: opts.taskType ?? "CONTENT_GENERATION",
      priority: "P3",
      userId: opts.userId,
      sessionId: opts.sessionId,
      messages,
      outputSchema: schema,
      timeoutMs: opts.timeoutMs,
    });

    if (!result.ok || !result.content) return null;

    try {
      const parsed = JSON.parse(result.content);
      const validated = schema.safeParse(parsed);
      if (!validated.success) {
        console.warn(`[orchestrator] structured output failed validation: ${validated.error.message.slice(0, 500)}`);
        return null;
      }
      return validated.data;
    } catch {
      return null;
    }
  }
}
