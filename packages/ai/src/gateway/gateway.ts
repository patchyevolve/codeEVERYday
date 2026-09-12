import type { DB } from "@cpd/core";
import type {
  AIRequest,
  AIResult,
  AIGateway,
  RawProvider,
  JobRef,
  ChatMessage,
  AIErrorKind,
} from "../contracts.js";
import type { AIProvider } from "../provider.js";
import type { ProviderRegistry } from "./provider-registry.js";
import type { CircuitBreaker } from "./circuit-breaker.js";
import type { QuotaManager } from "./quota.js";
import type { RateLimiter } from "./rate-limiter.js";
import type { RetryPolicy } from "./retry.js";
import type { UsageTracker as UsageTrackerType } from "./usage-tracker.js";
import { Router } from "./router.js";
import type { JobQueue } from "../job-queue.js";
import { ResponseCache } from "./response-cache.js";

export interface AIGatewayDeps {
  registry: ProviderRegistry;
  breaker: CircuitBreaker;
  quota: QuotaManager;
  rateLimiter: RateLimiter;
  retryPolicy: RetryPolicy;
  tracker: UsageTrackerType;
  provider: AIProvider;
  jobQueue?: JobQueue;
  cache?: ResponseCache;
}

function classifyError(err: unknown): AIErrorKind {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes("rate limit")) return "RATE_LIMIT";
    if (msg.includes("timeout") || msg.includes("abort")) return "TIMEOUT";
    if (msg.includes("network") || msg.includes("fetch")) return "NETWORK_FAILURE";
    if (msg.includes("401") || msg.includes("unauthorized")) return "INVALID_CREDENTIALS";
    if (msg.includes("400") || msg.includes("bad request")) return "INVALID_REQUEST";
  }
  return "PROVIDER_FAILURE";
}

export class AIGatewayImpl implements AIGateway {
  private readonly registry: ProviderRegistry;
  private readonly breaker: CircuitBreaker;
  private readonly quota: QuotaManager;
  private readonly rateLimiter: RateLimiter;
  private readonly retryPolicy: RetryPolicy;
  private readonly tracker: UsageTrackerType;
  private readonly provider: AIProvider;
  private readonly router: Router;
  private readonly jobQueue?: JobQueue;
  private readonly cache: ResponseCache;

  constructor(
    private readonly db: DB,
    deps: AIGatewayDeps,
  ) {
    this.registry = deps.registry;
    this.breaker = deps.breaker;
    this.quota = deps.quota;
    this.rateLimiter = deps.rateLimiter;
    this.retryPolicy = deps.retryPolicy;
    this.tracker = deps.tracker;
    this.provider = deps.provider;
    this.router = new Router(this.registry, this.breaker, this.quota, this.rateLimiter);
    this.jobQueue = deps.jobQueue;
    this.cache = deps.cache ?? new ResponseCache();
  }

  async request(req: AIRequest): Promise<AIResult> {
    const requestId = req.requestId || crypto.randomUUID();
    const startTime = Date.now();
    const fallbackChain: string[] = [];

    // Check cache first for non-unique requests
    if (req.messages && !req.unique) {
      const cacheKey = ResponseCache.buildKey(req.taskType, "any", req.messages);
      const cached = this.cache.get<AIResult>(cacheKey);
      if (cached) {
        return { ...cached, requestId, fromCache: true };
      }
    }

    await this.tracker.recordRequest({
      requestId,
      taskType: req.taskType,
      priority: req.priority,
      userId: req.userId,
      sessionId: req.sessionId,
      jobId: req.jobId,
    });

    const models = this.registry.listModels();
    if (models.length === 0) {
      const result: AIResult = {
        ok: false,
        requestId,
        provider: "",
        model: "",
        latencyMs: 0,
        tokens: { in: 0, out: 0 },
        costUsd: 0,
        fromCache: false,
        error: "MODEL_UNAVAILABLE",
        fallbackUsed: false,
        retryCount: 0,
      };
      await this.tracker.recordCompletion({
        requestId,
        status: "FAILED",
        latencyMs: 0,
        tokensIn: 0,
        tokensOut: 0,
        estCostUsd: 0,
        retryCount: 0,
        fallbackChain,
        fromCache: false,
        error: "MODEL_UNAVAILABLE",
      });
      return result;
    }

    const routingDecision = this.router.route(
      req.taskType,
      req.requiredCapabilities ?? [],
      req.priority,
    );

    if (!routingDecision) {
      const result: AIResult = {
        ok: false,
        requestId,
        provider: "",
        model: "",
        latencyMs: 0,
        tokens: { in: 0, out: 0 },
        costUsd: 0,
        fromCache: false,
        error: "MODEL_UNAVAILABLE",
        fallbackUsed: false,
        retryCount: 0,
      };
      await this.tracker.recordCompletion({
        requestId,
        status: "FAILED",
        latencyMs: 0,
        tokensIn: 0,
        tokensOut: 0,
        estCostUsd: 0,
        retryCount: 0,
        fallbackChain,
        fromCache: false,
        error: "MODEL_UNAVAILABLE",
      });
      return result;
    }

    const model = { providerId: routingDecision.providerId, modelId: routingDecision.modelId };
    let lastError: AIErrorKind = "UNKNOWN";
    let retryCount = 0;

    for (let attempt = 0; attempt <= this.retryPolicy.getMaxAttempts("PROVIDER_FAILURE"); attempt++) {
      if (!this.breaker.canExecute(model.providerId)) {
        lastError = "PROVIDER_FAILURE";
        const fallback = this.findFallback(model.providerId, fallbackChain);
        if (fallback) {
          fallbackChain.push(model.providerId);
          return this.executeWithModel(fallback, req, requestId, startTime, fallbackChain, true);
        }
        break;
      }

      if (!this.quota.canReserve(model.providerId, req.priority)) {
        lastError = "DAILY_QUOTA_EXHAUSTED";
        const fallback = this.findFallback(model.providerId, fallbackChain);
        if (fallback) {
          fallbackChain.push(model.providerId);
          return this.executeWithModel(fallback, req, requestId, startTime, fallbackChain, true);
        }
        break;
      }

      const providerConfig = this.registry.getProvider(model.providerId);
      const fullModel = providerConfig?.models.find((m) => m.modelId === model.modelId);
      const rateCheck = this.rateLimiter.checkRateLimit(
        model.providerId,
        fullModel?.rateLimits.rpm ?? 60,
        fullModel?.rateLimits.tpm ?? 100000,
      );
      if (!rateCheck.allowed) {
        lastError = "RATE_LIMIT";
        if (this.retryPolicy.shouldRetry(lastError, attempt)) {
          await this.sleep(this.retryPolicy.getDelay(lastError, attempt));
          retryCount++;
          continue;
        }
        const fallback = this.findFallback(model.providerId, fallbackChain);
        if (fallback) {
          fallbackChain.push(model.providerId);
          return this.executeWithModel(fallback, req, requestId, startTime, fallbackChain, true);
        }
        break;
      }

      this.quota.reserve(model.providerId, req.priority, 0);

      try {
        const result = await this.executeProviderCall(model.providerId, model.modelId, req);
        const latencyMs = Date.now() - startTime;
        const tokensIn = result.tokens.in;
        const tokensOut = result.tokens.out;
        const costUsd = this.tracker.estimateCost(model.providerId, model.modelId, tokensIn, tokensOut);

        this.breaker.recordSuccess(model.providerId);
        this.rateLimiter.recordRequest(model.providerId, tokensIn + tokensOut);
        this.quota.recordUsage(model.providerId, tokensIn, tokensOut);

        let content = result.content;
        let data: unknown = undefined;
        if (req.outputSchema && content) {
          try {
            const parsed = JSON.parse(content);
            const validation = req.outputSchema.safeParse(parsed);
            if (validation.success) {
              data = validation.data;
            }
          } catch {
            // JSON parse failure
          }
        }

        const finalResult: AIResult = {
          ok: true,
          requestId,
          content,
          data,
          provider: model.providerId,
          model: model.modelId,
          latencyMs,
          tokens: { in: tokensIn, out: tokensOut },
          costUsd,
          fromCache: false,
          fallbackUsed: fallbackChain.length > 0,
          retryCount,
        };

        // Cache successful result
        if (req.messages && !req.unique) {
          const cacheKey = ResponseCache.buildKey(req.taskType, "any", req.messages);
          this.cache.set(cacheKey, finalResult);
        }

        await this.tracker.recordCompletion({
          requestId,
          status: "COMPLETED",
          latencyMs,
          tokensIn,
          tokensOut,
          estCostUsd: costUsd,
          retryCount,
          fallbackChain,
          fromCache: false,
        });

        return finalResult;
      } catch (err) {
        this.breaker.recordFailure(model.providerId);
        this.quota.release(model.providerId, req.priority, 0);
        lastError = classifyError(err);

        if (this.retryPolicy.shouldRetry(lastError, attempt)) {
          await this.sleep(this.retryPolicy.getDelay(lastError, attempt));
          retryCount++;
          continue;
        }

        const fallback = this.findFallback(model.providerId, fallbackChain);
        if (fallback) {
          fallbackChain.push(model.providerId);
          return this.executeWithModel(fallback, req, requestId, startTime, fallbackChain, true);
        }
        break;
      }
    }

    const latencyMs = Date.now() - startTime;
    const result: AIResult = {
      ok: false,
      requestId,
      provider: model.providerId,
      model: model.modelId,
      latencyMs,
      tokens: { in: 0, out: 0 },
      costUsd: 0,
      fromCache: false,
      error: lastError,
      fallbackUsed: fallbackChain.length > 0,
      retryCount,
    };

    await this.tracker.recordCompletion({
      requestId,
      status: "FAILED",
      latencyMs,
      tokensIn: 0,
      tokensOut: 0,
      estCostUsd: 0,
      retryCount,
      fallbackChain,
      fromCache: false,
      error: lastError,
    });

    return result;
  }

  private async executeWithModel(
    model: { providerId: string; modelId: string },
    req: AIRequest,
    requestId: string,
    startTime: number,
    fallbackChain: string[],
    fallbackUsed: boolean,
  ): Promise<AIResult> {
    try {
      const result = await this.executeProviderCall(model.providerId, model.modelId, req);
      const latencyMs = Date.now() - startTime;
      const tokensIn = result.tokens.in;
      const tokensOut = result.tokens.out;
      const costUsd = this.tracker.estimateCost(model.providerId, model.modelId, tokensIn, tokensOut);

      this.breaker.recordSuccess(model.providerId);
      this.rateLimiter.recordRequest(model.providerId, tokensIn + tokensOut);
      this.quota.recordUsage(model.providerId, tokensIn, tokensOut);

      let content = result.content;
      let data: unknown = undefined;
      if (req.outputSchema && content) {
        try {
          const parsed = JSON.parse(content);
          const validation = req.outputSchema.safeParse(parsed);
          if (validation.success) {
            data = validation.data;
          }
        } catch {
          // JSON parse failure
        }
      }

      const finalResult: AIResult = {
        ok: true,
        requestId,
        content,
        data,
        provider: model.providerId,
        model: model.modelId,
        latencyMs,
        tokens: { in: tokensIn, out: tokensOut },
        costUsd,
        fromCache: false,
        fallbackUsed,
        retryCount: 0,
      };

      // Cache successful result
      if (req.messages && !req.unique) {
        const cacheKey = ResponseCache.buildKey(req.taskType, model.modelId, req.messages);
        this.cache.set(cacheKey, finalResult);
      }

      await this.tracker.recordCompletion({
        requestId,
        status: "COMPLETED",
        latencyMs,
        tokensIn,
        tokensOut,
        estCostUsd: costUsd,
        retryCount: 0,
        fallbackChain,
        fromCache: false,
      });

      return finalResult;
    } catch (err) {
      this.breaker.recordFailure(model.providerId);
      const latencyMs = Date.now() - startTime;
      const errorKind = classifyError(err);

      const result: AIResult = {
        ok: false,
        requestId,
        provider: model.providerId,
        model: model.modelId,
        latencyMs,
        tokens: { in: 0, out: 0 },
        costUsd: 0,
        fromCache: false,
        error: errorKind,
        fallbackUsed,
        retryCount: 0,
      };

      await this.tracker.recordCompletion({
        requestId,
        status: "FAILED",
        latencyMs,
        tokensIn: 0,
        tokensOut: 0,
        estCostUsd: 0,
        retryCount: 0,
        fallbackChain,
        fromCache: false,
        error: errorKind,
      });

      return result;
    }
  }

  private async executeProviderCall(
    providerId: string,
    modelId: string,
    req: AIRequest,
  ): Promise<{ content: string; tokens: { in: number; out: number } }> {
    const providerConfig = this.registry.getProvider(providerId);
    if (!providerConfig) {
      throw new Error(`Provider ${providerId} not found`);
    }

    const url = `${providerConfig.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      req.timeoutMs ?? 90_000,
    );

    try {
      const body: Record<string, unknown> = {
        model: modelId,
        messages: req.messages,
      };

      if (req.outputSchema) {
        body.response_format = { type: "json_object" };
      }

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${providerConfig.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Provider HTTP ${res.status}: ${text.slice(0, 300)}`);
      }

      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };

      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error("Empty completion");

      return {
        content,
        tokens: {
          in: data.usage?.prompt_tokens ?? 0,
          out: data.usage?.completion_tokens ?? 0,
        },
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private findFallback(
    currentProviderId: string,
    alreadyTried: string[],
): { providerId: string; modelId: string } | null {
    const models = this.registry.listModels();
    for (const model of models) {
      if (
        model.providerId !== currentProviderId &&
        !alreadyTried.includes(model.providerId) &&
        this.breaker.canExecute(model.providerId)
      ) {
        return { providerId: model.providerId, modelId: model.modelId };
      }
    }
    return null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async enqueue(req: AIRequest): Promise<JobRef> {
    if (this.jobQueue) {
      const jobId = await this.jobQueue.enqueue(
        req.taskType,
        {
          requestId: req.requestId,
          taskType: req.taskType,
          priority: req.priority,
          userId: req.userId,
          sessionId: req.sessionId,
          messages: req.messages,
          outputSchema: req.outputSchema,
          contextBudgetTokens: req.contextBudgetTokens,
          requiredCapabilities: req.requiredCapabilities,
        },
        { priority: req.priority },
      );
      return { jobId, status: "QUEUED" };
    }

    return {
      jobId: req.jobId ?? crypto.randomUUID(),
      status: "QUEUED",
    };
  }

  getRawProvider(): RawProvider {
    return {
      name: this.provider.name,
      configured: this.provider.configured,
      chat: (messages: ChatMessage[], opts?) =>
        this.provider.chat(messages, opts),
    };
  }
}
