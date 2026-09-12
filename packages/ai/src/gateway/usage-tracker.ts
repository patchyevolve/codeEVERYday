import { eq } from "drizzle-orm";
import type { DB } from "@cpd/core";
import { aiRequests } from "@cpd/core";
import type { ProviderRegistry } from "./provider-registry.js";

interface RecordRequestParams {
  requestId: string;
  taskType: string;
  priority: string;
  userId?: string;
  sessionId?: string;
  jobId?: string;
  provider?: string;
  model?: string;
  promptVersion?: string;
}

interface RecordCompletionParams {
  requestId: string;
  status: string;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
  estCostUsd: number;
  retryCount: number;
  fallbackChain: string[];
  fromCache: boolean;
  error?: string;
}

export class UsageTracker {
  constructor(
    private readonly db: DB,
    private readonly registry: ProviderRegistry,
  ) {}

  async recordRequest(params: RecordRequestParams): Promise<void> {
    await this.db.insert(aiRequests).values({
      requestId: params.requestId,
      taskType: params.taskType,
      priority: params.priority,
      userId: params.userId ?? null,
      sessionId: params.sessionId ?? null,
      jobId: params.jobId ?? null,
      provider: params.provider ?? null,
      model: params.model ?? null,
      promptVersion: params.promptVersion ?? null,
      status: "PENDING",
    });
  }

  async recordCompletion(params: RecordCompletionParams): Promise<void> {
    await this.db
      .update(aiRequests)
      .set({
        status: params.status,
        latencyMs: params.latencyMs,
        tokensIn: params.tokensIn,
        tokensOut: params.tokensOut,
        estCostUsd: params.estCostUsd,
        retryCount: params.retryCount,
        fallbackChain: params.fallbackChain,
        fromCache: params.fromCache,
        error: params.error ?? null,
        completedAt: new Date(),
      })
      .where(eq(aiRequests.requestId, params.requestId));
  }

  estimateCost(
    providerId: string,
    modelId: string,
    tokensIn: number,
    tokensOut: number,
  ): number {
    const model = this.registry.getModel(providerId, modelId);
    if (!model) return 0;
    return (
      (tokensIn / 1000) * model.costPer1kIn +
      (tokensOut / 1000) * model.costPer1kOut
    );
  }
}
