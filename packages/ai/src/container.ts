/**
 * Dependency Injection Container.
 *
 * Replaces 13 module-level singletons with a single, testable composition root.
 * One container per process. Create via `createContainer(db)` at startup;
 * pass it to anything that needs infrastructure.
 *
 * The container is intentionally simple: no reflection, no decorators,
 * just explicit construction with lazy getters.
 */

import type { DB } from "@cpd/core";
import { ProviderRegistry } from "./gateway/provider-registry.js";
import { CircuitBreaker } from "./gateway/circuit-breaker.js";
import { QuotaManager } from "./gateway/quota.js";
import { RateLimiter } from "./gateway/rate-limiter.js";
import { RetryPolicy } from "./gateway/retry.js";
import { UsageTracker } from "./gateway/usage-tracker.js";
import { AIGatewayImpl } from "./gateway/gateway.js";
import { OrchestratorImpl } from "./orchestrator.js";
import { ContentService } from "./content-service.js";
import { TutorEngine } from "./tutor.js";
import { ContextCompiler } from "./context-compiler.js";
import { MemoryRepository } from "./repositories/memory-repository.js";
import { MemorySystemImpl } from "./memory.js";
import { SessionController } from "./session-controller.js";
import { ContentReviewer } from "./content-review.js";
import { NodeRepository } from "./repositories/node-repository.js";
import { SessionRepository } from "./repositories/session-repository.js";
import { UserRepository } from "./repositories/user-repository.js";
import { ReasoningRepository, EvidenceRepository } from "./repositories/index.js";
import { getProvider, type AIProvider } from "./provider.js";
import { SubmissionRepository } from "./repositories/submission-repository.js";
import { StreakRepository } from "./repositories/streak-repository.js";
import { ProviderStateRepository } from "./repositories/provider-state-repository.js";
import { ContentRepository } from "./repositories/content-repository.js";
import { LearnerDimensionRepository } from "./repositories/learner-dimension-repository.js";
import type { LearnerDeps } from "./learner.js";
import { JobQueue } from "./job-queue.js";

export interface Container {
  readonly db: DB;
  readonly provider: AIProvider;
  readonly registry: ProviderRegistry;
  readonly breaker: CircuitBreaker;
  readonly quota: QuotaManager;
  readonly rateLimiter: RateLimiter;
  readonly retryPolicy: RetryPolicy;
  readonly usageTracker: UsageTracker;
  readonly gateway: AIGatewayImpl;
  readonly orchestrator: OrchestratorImpl;
  readonly contentService: ContentService;
  readonly tutorEngine: TutorEngine;
  readonly contextCompiler: ContextCompiler;
  readonly memoryRepository: MemoryRepository;
  readonly memorySystem: MemorySystemImpl;
  readonly sessionController: SessionController;
  readonly contentReviewer: ContentReviewer;
  readonly submissionRepo: SubmissionRepository;
  readonly streakRepo: StreakRepository;
  readonly nodeRepository: NodeRepository;
  readonly sessionRepository: SessionRepository;
  readonly userRepository: UserRepository;
  readonly reasoningRepository: ReasoningRepository;
  readonly evidenceRepository: EvidenceRepository;
  readonly learnerDeps: LearnerDeps;
  readonly jobQueue: JobQueue;
  readonly providerStateRepo: ProviderStateRepository;
  readonly contentRepository: ContentRepository;
  readonly learnerDimensionRepo: LearnerDimensionRepository;
  loadProviderState(): Promise<void>;
  saveProviderState(): Promise<void>;
}

export function createContainer(db: DB): Container {
  let _provider: AIProvider | undefined;
  let _registry: ProviderRegistry | undefined;
  let _breaker: CircuitBreaker | undefined;
  let _quota: QuotaManager | undefined;
  let _rateLimiter: RateLimiter | undefined;
  let _retryPolicy: RetryPolicy | undefined;
  let _usageTracker: UsageTracker | undefined;
  let _gateway: AIGatewayImpl | undefined;
  let _orchestrator: OrchestratorImpl | undefined;
  let _contentService: ContentService | undefined;
  let _tutorEngine: TutorEngine | undefined;
  let _contextCompiler: ContextCompiler | undefined;
  let _memoryRepository: MemoryRepository | undefined;
  let _evidenceRepository: EvidenceRepository | undefined;
  let _memorySystem: MemorySystemImpl | undefined;
  let _sessionController: SessionController | undefined;
  let _contentReviewer: ContentReviewer | undefined;
  let _submissionRepo: SubmissionRepository | undefined;
  let _streakRepo: StreakRepository | undefined;
  let _nodeRepo: NodeRepository | undefined;
  let _sessionRepo: SessionRepository | undefined;
  let _userRepo: UserRepository | undefined;
  let _reasoningRepo: ReasoningRepository | undefined;
  let _learnerDeps: LearnerDeps | undefined;
  let _jobQueue: JobQueue | undefined;
  let _providerStateRepo: ProviderStateRepository | undefined;
  let _contentRepo: ContentRepository | undefined;
  let _learnerDimRepo: LearnerDimensionRepository | undefined;

  const c: Container = {
    get db() { return db; },

    get provider() {
      return (_provider ??= getProvider());
    },

    get registry() {
      return (_registry ??= new ProviderRegistry());
    },

    get breaker() {
      return (_breaker ??= new CircuitBreaker());
    },

    get quota() {
      return (_quota ??= new QuotaManager());
    },

    get rateLimiter() {
      return (_rateLimiter ??= new RateLimiter());
    },

    get retryPolicy() {
      return (_retryPolicy ??= new RetryPolicy());
    },

    get usageTracker() {
      return (_usageTracker ??= new UsageTracker(db, c.registry));
    },

    get gateway() {
      return (_gateway ??= new AIGatewayImpl(db, {
        registry: c.registry,
        breaker: c.breaker,
        quota: c.quota,
        rateLimiter: c.rateLimiter,
        retryPolicy: c.retryPolicy,
        tracker: c.usageTracker,
        provider: c.provider,
        jobQueue: c.jobQueue,
      }));
    },

    get orchestrator() {
      return (_orchestrator ??= new OrchestratorImpl(db, c.gateway));
    },

    get contentService() {
      return (_contentService ??= new ContentService(db, c.provider, c.contentReviewer, c.contentRepository));
    },

    get tutorEngine() {
      return (_tutorEngine ??= new TutorEngine(c.contentService, c.nodeRepository, c.sessionRepository, c.userRepository, c.streakRepo));
    },

    get contextCompiler() {
      return (_contextCompiler ??= new ContextCompiler(db, c.memorySystem));
    },

    get memoryRepository() {
      return (_memoryRepository ??= new MemoryRepository(db));
    },

    get evidenceRepository() {
      return (_evidenceRepository ??= new EvidenceRepository(db));
    },

    get memorySystem() {
      return (_memorySystem ??= new MemorySystemImpl(c.memoryRepository));
    },

    get sessionController() {
      return (_sessionController ??= new SessionController(
        c.sessionRepository,
        c.memoryRepository,
        c.reasoningRepository,
        c.nodeRepository,
      ));
    },

    get contentReviewer() {
      return (_contentReviewer ??= new ContentReviewer(db, c.orchestrator, c.contentRepository));
    },

    get nodeRepository() {
      return (_nodeRepo ??= new NodeRepository(db));
    },

    get sessionRepository() {
      return (_sessionRepo ??= new SessionRepository(db));
    },

    get userRepository() {
      return (_userRepo ??= new UserRepository(db));
    },

    get submissionRepo() {
      return (_submissionRepo ??= new SubmissionRepository(db));
    },

    get streakRepo() {
      return (_streakRepo ??= new StreakRepository(db));
    },

    get reasoningRepository() {
      return (_reasoningRepo ??= new ReasoningRepository(db));
    },

    get learnerDeps() {
      return (_learnerDeps ??= {
        users: c.userRepository,
        streaks: c.streakRepo,
        sessions: c.sessionRepository,
        nodes: c.nodeRepository,
        submissions: c.submissionRepo,
      });
    },

    get jobQueue() {
      return (_jobQueue ??= new JobQueue(db));
    },

    get providerStateRepo() {
      return (_providerStateRepo ??= new ProviderStateRepository(db));
    },

    get contentRepository() {
      return (_contentRepo ??= new ContentRepository(db));
    },

    get learnerDimensionRepo() {
      return (_learnerDimRepo ??= new LearnerDimensionRepository(db));
    },

    async loadProviderState() {
      const repo = c.providerStateRepo;
      const breakerStates = await repo.loadBreakerStates();
      if (breakerStates.length > 0) {
        c.breaker.loadFromDB(breakerStates);
      }
      const quotaStates = await repo.loadQuotaStates();
      if (quotaStates.length > 0) {
        c.quota.loadFromDB(quotaStates);
      }
    },

    async saveProviderState() {
      const repo = c.providerStateRepo;
      const models = c.registry.listModels();
      const providerIds = [...new Set(models.map((m) => m.providerId))];

      for (const providerId of providerIds) {
        const breakerState = c.breaker.getState(providerId);
        const quotaStatus = c.quota.getQuotaStatus(providerId);
        await repo.upsert({
          providerId,
          breakerState: breakerState.state,
          breakerOpenedAt: breakerState.openedAt,
          consecutiveFailures: breakerState.consecutiveFailures,
          requestsToday: quotaStatus.rpd.used,
          tokensToday: quotaStatus.tpd.used,
        });
      }
    },
  };

  return c;
}
