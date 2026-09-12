import type { AIErrorKind, AIRequest, RoutingDecision } from "../contracts.js";
import type { ProviderRegistry } from "./provider-registry.js";
import type { CircuitBreaker } from "./circuit-breaker.js";
import type { QuotaManager } from "./quota.js";

const NON_RETRYABLE_ERRORS: Set<AIErrorKind> = new Set([
  "DAILY_QUOTA_EXHAUSTED",
  "TOKEN_QUOTA_EXHAUSTED",
  "INVALID_CREDENTIALS",
  "INVALID_REQUEST",
  "MODEL_UNAVAILABLE",
  "UNEXPECTED_CONTENT",
  "CACHE_MISS",
  "UNKNOWN",
]);

export class FallbackRouter {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly breaker: CircuitBreaker,
    private readonly quota: QuotaManager,
  ) {}

  findFallback(
    originalRequest: AIRequest,
    failedProvider: string,
    failedModel: string,
    errorKind: AIErrorKind,
  ): RoutingDecision | null {
    if (NON_RETRYABLE_ERRORS.has(errorKind)) return null;

    const requiredCapabilities = originalRequest.requiredCapabilities ?? [];
    const priority = originalRequest.priority;

    const candidates = this.registry.listModels().filter((m) => {
      if (m.providerId === failedProvider && m.modelId === failedModel) {
        return false;
      }

      if (requiredCapabilities.length > 0) {
        const hasAll = requiredCapabilities.every((cap) => {
          const key = cap as keyof typeof m.capabilities;
          return m.capabilities[key] === true;
        });
        if (!hasAll) return false;
      }

      if (!this.breaker.canExecute(m.providerId)) return false;

      if (!this.quota.canReserve(m.providerId, priority)) return false;

      return true;
    });

    if (candidates.length === 0) {
      const sameProviderDifferentModel = this.registry
        .listModels()
        .filter(
          (m) =>
            m.providerId === failedProvider &&
            m.modelId !== failedModel &&
            this.breaker.canExecute(m.providerId) &&
            this.quota.canReserve(m.providerId, priority),
        );

      if (sameProviderDifferentModel.length === 0) return null;

      const best = sameProviderDifferentModel[0]!;
      return {
        providerId: best.providerId,
        modelId: best.modelId,
        reason: `Fallback: same provider ${failedProvider}, different model (no cross-provider alternatives)`,
      };
    }

    candidates.sort(
      (a, b) =>
        (a.costPer1kIn + a.costPer1kOut) * 0.5 + (a.avgLatencyMs / 1000) * 0.5 -
        ((b.costPer1kIn + b.costPer1kOut) * 0.5 + (b.avgLatencyMs / 1000) * 0.5),
    );

    const best = candidates[0]!;
    return {
      providerId: best.providerId,
      modelId: best.modelId,
      reason: `Fallback from ${failedProvider}/${failedModel} after ${errorKind}`,
    };
  }
}
