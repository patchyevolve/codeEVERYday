import type {
  AITaskType,
  Priority,
  ProviderModel,
  RoutingDecision,
} from "../contracts.js";
import type { ProviderRegistry } from "./provider-registry.js";
import type { CircuitBreaker } from "./circuit-breaker.js";
import type { QuotaManager } from "./quota.js";
import type { RateLimiter } from "./rate-limiter.js";

function costLatencyScore(m: ProviderModel): number {
  return (m.costPer1kIn + m.costPer1kOut) * 0.5 + (m.avgLatencyMs / 1000) * 0.5;
}

export class Router {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly breaker: CircuitBreaker,
    private readonly quota: QuotaManager,
    private readonly rateLimiter: RateLimiter,
  ) {}

  route(
    _taskType: AITaskType,
    requiredCapabilities: string[],
    priority: Priority,
  ): RoutingDecision | null {
    let models = this.registry.listModels();

    if (requiredCapabilities.length > 0) {
      models = models.filter((m) =>
        requiredCapabilities.every((cap) => {
          const key = cap as keyof ProviderModel["capabilities"];
          return m.capabilities[key] === true;
        }),
      );
    }

    models = models.filter((m) => this.breaker.canExecute(m.providerId));

    models = models.filter((m) =>
      this.quota.canReserve(m.providerId, priority),
    );

    models = models.filter((m) => {
      const { allowed } = this.rateLimiter.checkRateLimit(
        m.providerId,
        m.rateLimits.rpm,
        m.rateLimits.tpm,
      );
      return allowed;
    });

    if (models.length === 0) return null;

    models.sort((a, b) => costLatencyScore(a) - costLatencyScore(b));

    const best = models[0]!;
    return {
      providerId: best.providerId,
      modelId: best.modelId,
      reason: `Best cost/latency score: ${costLatencyScore(best).toFixed(4)}`,
    };
  }
}
