Code Practice Daily — AI Tutoring Subsystem Architecture Analysis
1. System Context and Purpose
What is this system?
Code Practice Daily (CPD) is a tutor-controlled daily programming apprenticeship system. It delivers structured daily coding sessions to individual learners, combining deterministic curriculum planning with AI-enhanced tutoring. The system teaches programming concepts across 8 languages (C++, Python, Rust, C, Bash, JavaScript, Assembly, SQL) plus 6 domain areas (Networking, Cybersecurity, Low-Level, AI Engineering, WebDev, Systems).
Actors
Actor	Role
Learner	Interacts via the web app; completes daily sessions, submits code, asks questions
Tutor Engine	Autonomous agent that decides what the learner does each day, composes sessions, evaluates submissions
AI Providers	External LLM APIs (OpenAI-compatible) used for content generation, tutoring responses, reviews
Executor	Deno-based sandbox (apps/executor) that compiles and runs learner code
Worker	Background job processor (pg-boss, currently stubbed)
What does it do?
1. Daily session composition: Plans what the learner should study today based on curriculum state, retention, mistakes, and goals
2. Content delivery: Serves lessons, exercises (coding, debugging, conceptual, tracing, assessment, real-world, projects)
3. Submission evaluation: Grades code against test cases, tracks mastery via SM-2 spaced repetition
4. AI-enhanced tutoring: Generates content on demand, reviews content quality, provides explanations/hints
5. Learner modeling: Tracks 12 dimensions of learner ability per concept
6. Memory and continuity: Persists session reports and handoffs for cross-session continuity
2. Current Architecture Structure
Package Layout
packages/core       DB schema, types, mastery math, review scheduling, passwords
packages/ai         AI subsystem (~8,600 LOC across 30 files)
packages/curriculum  Domain graphs (referenced but minimal content visible)
apps/api            Fastify v5 HTTP server (472 lines, all routes in one file)
apps/executor       Deno sandbox for code execution
apps/web            Empty (frontend not yet built)
apps/worker         Empty (pg-boss worker not yet built)
Dependency Direction (Intended from Design Doc)
application (api + web)
        │
   ┌────┴────┐
   ▼         ▼
Session UI  Session HTTP API  Background Worker
   │         │                  │
   └────┬────┘──────────────────┘
        ▼
   AI SUBSYSTEM
   gateway/  ← orchestrator/ ← tutor/ ← {memory, learner, curriculum, content}
                                ↑
                           evaluation/
        ▼
   AI PROVIDERS (via adapters)
Module Responsibilities and Interfaces
Component	Responsibility	Key Interface
Gateway	Provider-agnostic AI calls, routing, circuit breaking, quota, rate limiting, retry, fallback, usage tracking	AIGateway.request(), AIGateway.enqueue()
Orchestrator	Entry point for AI work; classifies tasks, checks cache, routes to gateway	Orchestrator.request(), Orchestrator.enqueue()
Tutor Engine	Decides daily objective, composes sessions, manages curriculum progression	TutorEngine.decideObjective(), TutorEngine.composeSession()
Tutor Reasoning	Hypothesis tracking, decision audit, strategy memory, clarification questions	generateHypothesis(), recordDecision(), needsClarification()
Session Controller	11-phase FSM, session lifecycle, report generation, handoff	SessionController.transitionPhase(), SessionController.generateReport()
Evaluator	Submission grading, mastery state machine (SM-2), XP, streaks	evaluateSubmission(), completeSession()
Content Review	AI semantic review + bounded repair (max 2 rounds)	ContentReviewer.reviewAndRepair()
Content Service	Retrieval-first content library, need-driven generation	ContentService.resolve()
Generators	AI + template fallback for all content types	generateLesson(), generateExercise(), etc.
Validator	Schema validation + sandbox execution of reference solutions	validateContent()
Learner Model	12-dimension belief state, EMA updates from evidence	applyEvidence(), getLearnerModel()
Memory System	5 stores (session, learner, historical, tutor-experience, temporary)	MemorySystem.query(), MemorySystem.recordSessionMemory()
Context Compiler	Budgeted prompt assembly with token limits	ContextCompiler.compile(), ContextCompiler.compileForTask()
Domain Builder	Knowledge graph expansion, 6 language frontiers + domain frontiers	expandDomainModel(), DOMAIN_FRONTIERS
Provider	Single OpenAI-compatible provider + null fallback	getProvider(), structured()
3. Architectural Patterns Identified
3.1 Patterns Present
Pattern	Location	Assessment
Gateway	gateway/gateway.ts	Well-implemented. Encapsulates provider interaction, circuit breaker, quota, rate limiting, retry, fallback. Correct pattern choice.
Circuit Breaker	gateway/circuit-breaker.ts	Correct implementation with CLOSED → OPEN → HALF_OPEN transitions. Correct threshold and cooldown.
Token Bucket (Quota)	gateway/quota.ts	Multi-window quota with priority-aware reservation floor (20% reserved for P0/P1). Good design for live-tutor priority.
Sliding Window Rate Limiter	gateway/rate-limiter.ts	Per-minute RPM and TPM tracking with timestamp pruning. Correct.
Exponential Backoff + Jitter	gateway/retry.ts	Per-error-kind retry counts, Retry-After header support, jitter. Correct.
Fallback Chain	gateway/fallback.ts + gateway/gateway.ts	Cross-provider fallback with capability matching. Good.
FSM	session-controller.ts	11-phase session state machine with explicit transition table. Correct pattern for session lifecycle.
EMA (Exponential Moving Average)	learner-model.ts	Learner dimension updates via emaUpdate(). Appropriate for gradual belief updating.
SM-2 Spaced Repetition	evaluator.ts (via @cpd/core)	Standard algorithm for review scheduling. Correctly applied.
Strategy Pattern	generators.ts	Each content kind has AI generation + template fallback. Clean separation.
Pipeline	content-review.ts	review → repair → re-validate → persist. Correct for content quality assurance.
Barrel Export	index.ts	Single public API surface for the AI package. Appropriate for package boundary.
3.2 Patterns Notably Absent (But Designed)
Pattern	Status	Design Doc Ref
Orchestrator (full)	Stub only — request() just delegates to gateway	Design doc §2
Context Cache	Not implemented	Design doc §19
pg-boss Background Jobs	enqueue() returns a stub JobRef	Design doc §6
Strategy Memory Feedback Loop	tutor-reasoning.ts records strategy outcomes but tutor.ts doesn't consume them yet	Design doc §12
3.3 Pattern Application Quality
Correct applications:
- Circuit breaker with persistence (loadFromDB) — restart-safe
- Quota priority floor — prevents background jobs from starving live tutoring
- Content review pipeline with deterministic override — AI never overrules sandbox execution
- FSM with explicit transition table — prevents illegal state transitions
Concerns:
- Gateway's request() method is ~200 lines with retry loop, fallback, and error classification interleaved. This is approaching a god-method. The retry loop in the main request() method duplicates logic that also exists in executeWithModel().
- Singleton patterns everywhere (gateway, circuit breaker, quota, rate limiter, retry, registry, router, fallback, context compiler, orchestrator) — at least 10 module-level singletons. This makes testing difficult and hides dependency graphs.
4. Dependency Analysis
4.1 Package Dependencies (Observed)
@cpd/core      ← (no internal deps, depends on drizzle-orm, pg)
@cpd/ai        ← @cpd/core (schema, types, DB)
@cpd/curriculum ← (not visible in reads, likely @cpd/core)
@apps/api      ← @cpd/core, @cpd/ai
@apps/executor ← (Deno, independent)
@apps/worker   ← (empty)
@apps/web      ← (empty)
Direction is correct: api → ai → core. No reverse dependencies detected.
4.2 Internal Dependency Graph (packages/ai/src)
contracts.ts ← (no deps, pure types)
provider.ts ← (no internal deps, pure provider abstraction)
content.ts ← (no internal deps, schemas)
executor-client.ts ← (no internal deps, HTTP to executor)
validator.ts ← content.ts, executor-client.ts
generators.ts ← provider.ts, content.ts, templates/
domain-builder.ts ← provider.ts, templates/
content-service.ts ← content.ts, generators.ts, validator.ts, executor-client.ts
learner.ts ← @cpd/core
evaluator.ts ← @cpd/core, executor-client.ts
tutor.ts ← @cpd/core, content-service.ts, learner.ts, domain-builder.ts
learner-model.ts ← contracts.ts
evidence.ts ← contracts.ts, @cpd/core
memory.ts ← contracts.ts, @cpd/core
tutor-reasoning.ts ← contracts.ts, @cpd/core
session-controller.ts ← contracts.ts, @cpd/core
context-compiler.ts ← contracts.ts, learner-model.ts, memory.ts
content-review.ts ← contracts.ts, orchestrator.ts, validator.ts
orchestrator.ts ← contracts.ts, gateway/gateway.ts
gateway/gateway.ts ← contracts.ts, provider.ts, gateway/*
gateway/router.ts ← contracts.ts, gateway/*
gateway/fallback.ts ← contracts.ts, gateway/*
4.3 Circular Dependencies
No circular package-level dependencies detected. The dependency graph is acyclic at the package level.
However, there is a near-cycle within the AI package:
- content-review.ts imports orchestrator.ts
- orchestrator.ts imports gateway/gateway.ts
- gateway/gateway.ts imports provider.ts
This is not a cycle, but content-review.ts calling orchestrator.request() while being called from the content pipeline creates a conceptual layering concern: the content layer reaches through the orchestrator layer to get AI calls, when ideally the orchestrator should be the caller, not the callee.
4.4 Coupling Assessment
Coupling Type	Severity	Location
DB coupling	High	Nearly every component takes a DB parameter. Correct for a modular monolith but makes testing require a real DB.
Singleton coupling	High	10+ module-level singletons hide dependency graphs and make DI impossible
Schema coupling	Medium	tutor.ts directly imports 6+ Drizzle tables. The tutor engine knows about persistence details.
Provider coupling	Low	Gateway correctly abstracts providers. provider.ts is only used by gateway.ts and generators.ts.
Cross-component calls	Medium	content-review.ts calls orchestrator.ts which calls gateway.ts — 3 layers deep for a single AI call
5. Boundary Analysis
5.1 Module Boundaries
Boundary	Meaningful?	Enforced?	Assessment
packages/ai vs packages/core	Yes — AI logic vs data/schema	By import convention	Correct. Core owns schema; AI owns behavior.
packages/ai/src/gateway/	Yes — provider interaction	Partially	Gateway components are well-isolated but all accessed via singletons, not injected.
contracts.ts as interface boundary	Yes	Weakly	Contracts file is the single source of truth but components also import Drizzle tables directly.
apps/api vs packages/ai	Yes	By import	API imports AI types and functions. Clean boundary.
5.2 Leaky Boundaries
1. tutor.ts leaks into persistence: The tutor engine directly imports and queries 6+ Drizzle tables (dailySessions, dailyTasks, domainNodes, domainEdges, userConceptState, userGoals, userLearningPath). It should depend on repository interfaces, not on the ORM schema directly.
2. evaluator.ts leaks into persistence: Same issue — directly imports and queries 12+ tables.
3. session-controller.ts leaks into persistence: Directly imports 7 tables.
4. memory.ts leaks into persistence: Directly imports 8 tables.
This is the most significant architectural smell in the codebase. Every "component" in the AI subsystem is directly coupled to the database schema. The contracts.ts interfaces (LearnerModel, MemorySystem, etc.) exist but are not used as the boundary — components bypass them and go straight to Drizzle queries.
5.3 Well-Enforced Boundaries
1. Gateway sub-modules: circuit-breaker.ts, quota.ts, rate-limiter.ts, retry.ts, router.ts, fallback.ts, provider-registry.ts, usage-tracker.ts — each has a clear single responsibility and clean interfaces between them.
2. Content pipeline: generators.ts → validator.ts → content-review.ts → content-service.ts — the pipeline stages are clearly separated with well-defined inputs/outputs.
3. Provider abstraction: provider.ts correctly abstracts the AI provider. generators.ts calls structured() without knowing which provider is active.
6. State Ownership
6.1 State Owners
State	Owner	Source of Truth	Mutation Authority
Learner concept mastery	evaluator.ts (via @cpd/core mastery math)	user_concept_state table	Deterministic functions of submission outcomes
Learner dimensions (12D)	learner-model.ts	learner_dimensions table	Deterministic EMA updates from evidence
Session phase	session-controller.ts	daily_sessions.currentPhase	FSM transition validation
Hypotheses	tutor-reasoning.ts	tutor_hypotheses table	AI + evidence-driven updates
Tutor decisions	tutor-reasoning.ts	tutor_decisions table	Written at decision time, verdict filled later
Strategy experience	tutor-reasoning.ts	tutor_experience table	Written after interventions
Content versions	content-service.ts	content_items table	Immutable versions, supersede on update
Circuit breaker	gateway/circuit-breaker.ts	In-memory + provider_state table	Failure/success counts
Quota	gateway/quota.ts	In-memory + provider_state table	Request/token counts
Daily curriculum plan	tutor.ts	daily_sessions + daily_tasks tables	Deterministic planning logic
6.2 Invariant Protection
Invariant	Protected?	How
Facts (submissions/executions) written only by deterministic code	Yes	evaluator.ts writes submissions; AI never writes them directly
AI never silently mutates curriculum/session state	Partially	Tutor decisions are persisted as hypotheses with evidence refs (tutor-reasoning.ts). But tutor.ts's decideObjective() is purely deterministic — no AI refinement path exists yet
No part of the tutoring system calls provider SDK directly	Yes	All AI calls go through provider.ts → gateway/ chain. Exception: generators.ts calls structured() from provider.ts directly, bypassing the gateway
Unapproved content never shown to learners	Yes	content-service.ts only returns content with validation.state = VALIDATED
Quota never double-decremented	Partially	reserve() is atomic within a single call, but there's no transactional guarantee across canReserve() + reserve() calls in the gateway loop
Background never consumes protected live capacity	Yes	Quota priority floor (PRIORITY_FLOOR = 0.2) reserves 20% for live tutoring
6.3 Concurrency Concerns
1. Gateway singletons are not thread-safe: CircuitBreaker, QuotaManager, RateLimiter use Map and plain number counters without synchronization. In a multi-worker deployment, each process would have independent state. The loadFromDB() methods exist but are never called at startup.
2. Quota race condition: In gateway.ts line 137, this.quota.reserve() is called after canReserve() check but before the actual provider call. If two requests interleave, both could pass canReserve() and both call reserve(). The reserve() method does re-check internally, but the canReserve() + reserve() pattern is not atomic.
3. Session state transitions: session-controller.ts reads current phase then writes, without any locking. Two concurrent transition calls could both read the same current phase and both write valid but conflicting targets.
7. Architectural Fitness Functions
7.1 Rules That Exist
Rule	Enforcement	Location
No tests exist yet	vitest 3.0 configured but zero test files found	package.json scripts reference tests/ directories that don't exist
Type checking	npm run typecheck runs tsc --noEmit across packages	Build script, not CI-enforced
Build order	npm run build respects workspace dependency order	package.json
7.2 Rules That Should Exist
1. No direct Drizzle imports in AI components (enforce dependency direction)
- Currently violated by tutor.ts, evaluator.ts, session-controller.ts, memory.ts
- Could use eslint-plugin-import rules or archunit-style tests
2. No circular imports within packages/ai/src/
- Currently clean, but easy to regress as code grows
3. Gateway singletons must not be used in tests
- Tests should inject dependencies, not use module-level singletons
4. All AI calls must go through the gateway
- Currently violated by generators.ts calling structured() from provider.ts directly
5. Content must pass deterministic validation before publication
- Enforced in code (content-review.ts line 361) but no automated test verifies it
6. Session FSM transitions must be valid
- Enforced in code (session-controller.ts) but no test coverage
8. Identified Architecture Smells
8.1 God Components
tutor.ts (491 lines) is the most concerning:
- Decides objectives (RECOVERY, REMEDIATION, CURRICULUM, REVIEW)
- Composes sessions with budget trimming
- Expands domain models
- Seeds initial learning paths
- Queries 6+ database tables directly
- Handles 7 different decision types
- Mixes curriculum planning, session composition, and domain expansion
This component has too many responsibilities and should be decomposed.
8.2 Leaky Abstractions
1. Every AI component depends directly on Drizzle schema: tutor.ts, evaluator.ts, session-controller.ts, memory.ts, learner-model.ts, tutor-reasoning.ts all import from @cpd/core and run Drizzle queries directly. The contracts.ts interfaces (LearnerModel, MemorySystem, etc.) define clean boundaries that are then bypassed.
2. generators.ts bypasses the gateway: Calls structured() from provider.ts directly instead of going through orchestrator.request(). This means content generation doesn't benefit from circuit breaking, quota management, rate limiting, or usage tracking.
3. content-review.ts reaches through orchestrator to gateway: Three layers deep for a single AI call, when the content review could be a direct consumer of the orchestrator interface.
8.3 Accidental Architecture
1. Singleton proliferation: 10+ module-level singletons (_gateway, _instance, _provider, _compiler, _orchestrator, etc.) create hidden global state. The dependency graph is invisible — you can't tell what depends on what by looking at constructors.
2. Flat file structure: All 30 AI files are in packages/ai/src/ with only gateway/ as a subdirectory. The design doc describes 9 sub-components (gateway, orchestrator, content, curriculum, learner, memory, tutor, session, evaluation) but only gateway has its own directory.
3. contracts.ts as monolith: 561 lines of type definitions for the entire AI subsystem in one file. This works at current scale but will become a merge conflict magnet.
8.4 Missing Abstractions
1. No repository layer: Components directly query Drizzle tables. There's no abstraction between business logic and persistence, making it impossible to test without a database.
2. No interface for the TutorEngine: The design doc defines TutorEngine as an interface, but tutor.ts exports a concrete class. There's no seam for testing or alternative implementations.
3. No configuration object: Components receive a raw DB parameter. There's no way to pass configuration (timeouts, limits, feature flags) without environment variables.
9. Failure and Change Propagation
9.1 Component Failure Scenarios
Failure	Blast Radius	Mitigation
AI provider down	Content generation fails; tutoring responses degrade	Circuit breaker opens, fallback to template generation, degraded tutor
Executor unreachable	Code exercises can't be validated or graded	Content left unvalidated; submissions fail with clear error
Database down	Everything stops — all state is DB-backed	No mitigation; single point of failure
Rate limit hit	Specific provider temporarily unavailable	Retry with backoff, fallback to another provider
Quota exhausted	One provider can't serve requests	Route to another provider; background jobs deferred
Circuit breaker opens	Provider marked unavailable for cooldown period	Automatic half-open probe after cooldown
9.2 Change Propagation
Change	Propagates To
Schema change in @cpd/core	All AI components that import tables, API server
New AI task type	contracts.ts (AITaskType), orchestrator.ts (TASK_CAPABILITIES, DEFAULT_PRIORITY), gateway (routing)
New content kind	generators.ts, validator.ts, content-review.ts, evaluator.ts, content.ts
New session phase	session-controller.ts (TRANSITIONS table), session report generation
New learner dimension	learner-model.ts (ALL_DIMENSIONS, mapEvidenceToDimensions), contracts.ts, memory.ts
9.3 Critical Failure Path
Provider failure during live tutoring (P0):
1. Gateway detects failure → circuit breaker records failure
2. If threshold reached → circuit breaker opens
3. Gateway attempts fallback to another provider
4. If no fallback available → AIResult.ok = false with error kind
5. Orchestrator receives failure → currently just returns it to caller
6. Tutor would need to handle this (not yet implemented) — design doc says "degrade to deterministic template tutor"
7. Session state is preserved — the session controller doesn't lose progress
The critical gap is step 6: there's no implementation of the degradation ladder for live tutoring when all AI providers fail.
10. Architecture Decision Records
ADR-001: Single AI Package as Modular Monolith
Decision: All AI logic lives in packages/ai as a single npm package with internal sub-modules.
Context: The system needs 9+ AI sub-components that share types and have complex inter-dependencies.
Trade-offs:
- ✅ Simple deployment (single process)
- ✅ No network boundaries between components
- ✅ Shared types without serialization
- ❌ No independent deployment of sub-components
- ❌ No runtime isolation between components
- ❌ All components share the same Node.js process
Revisit if: The system needs to scale individual components independently, or if the team grows to require separate ownership.
ADR-002: Gateway Pattern for AI Providers
Decision: All AI calls go through a gateway with circuit breaker, quota, rate limiting, retry, and fallback.
Context: Multiple AI providers with different characteristics; live tutoring must never be blocked by background jobs.
Trade-offs:
- ✅ Centralized provider management
- ✅ Priority-aware quota reservation
- ✅ Restart-safe circuit breaker state
- ❌ Gateway becomes a bottleneck (single entry point)
- ❌ Complex retry/fallback logic in one place
ADR-003: Deterministic-First with AI Enhancement
Decision: Core tutoring logic (objective selection, session composition, submission grading) is deterministic. AI is an optional refinement layer that can never override persisted learning state.
Context: AI providers are unreliable; the system must work offline; tutoring decisions must be auditable.
Trade-offs:
- ✅ System works without AI providers
- ✅ Decisions are testable and reproducible
- ✅ Audit trail is clear
- ❌ AI improvements are limited to additive enhancements
- ❌ More code to maintain (deterministic + AI paths)
ADR-004: Direct Drizzle Queries (No Repository Layer)
Decision: AI components query Drizzle tables directly instead of through repository interfaces.
Context: Small team, fast iteration, single database.
Trade-offs:
- ✅ No abstraction overhead
- ✅ Direct access to Drizzle's query builder
- ❌ Every component is coupled to the schema
- ❌ Testing requires a real database
- ❌ Schema changes propagate widely
Revisit when: Tests become a bottleneck, or when the team needs to mock the database for faster test cycles.
ADR-005: Module-Level Singletons
Decision: Gateway components (circuit breaker, quota, rate limiter, etc.) use module-level singleton instances.
Context: These components need to be shared across all callers in a single process.
Trade-offs:
- ✅ Simple access pattern
- ✅ State is naturally shared
- ❌ Impossible to inject in tests
- ❌ Hidden dependency graph
- ❌ Configuration is global
11. Recommendations
Priority 1: Critical (Fix Before Production)
1.1 Eliminate singleton proliferation — introduce dependency injection
The 10+ module-level singletons make testing impossible and hide the dependency graph. Refactor to constructor injection:
// Before
const gateway = getGateway(db); // hides all dependencies

// After  
const registry = new ProviderRegistry(envProviders);
const breaker = new CircuitBreaker(config);
const quota = new QuotaManager();
const rateLimiter = new RateLimiter();
const retryPolicy = new RetryPolicy();
const tracker = new UsageTracker(db);
const gateway = new AIGatewayImpl(db, registry, breaker, quota, rateLimiter, retryPolicy, tracker);
This is the single highest-impact change because it unblocks testability for everything else.
1.2 Make generators.ts use the orchestrator, not provider.ts directly
Currently generators.ts calls structured() from provider.ts, bypassing circuit breaking, quota, rate limiting, and usage tracking. Content generation should go through the orchestrator like everything else.
1.3 Implement session FSM locking or optimistic concurrency
session-controller.ts has a TOCTOU race on phase transitions. Either:
- Use SELECT ... FOR UPDATE when reading current phase, or
- Add a version column and use optimistic locking, or
- Use an atomic UPDATE ... WHERE currentPhase = $expected and check affected rows
Priority 2: High (Fix Soon)
2.1 Introduce a repository layer for the AI subsystem
Create thin repository interfaces between AI components and Drizzle:
packages/ai/src/repositories/
  session-repository.ts   (wraps dailySessions, dailyTasks queries)
  learner-repository.ts   (wraps userConceptState, learnerDimensions queries)
  content-repository.ts   (wraps contentItems, contentReviews queries)
  evidence-repository.ts  (wraps evidenceEvents queries)
This decouples AI logic from schema details and enables mock-based testing.
2.2 Decompose tutor.ts into focused components
Split into:
- tutor/objective-decider.ts — decideObjective() logic
- tutor/session-composer.ts — composeSession() logic
- tutor/domain-expander.ts — expandAndObjective() logic
- tutor/path-manager.ts — ensureInitialPath(), nextPathNode() logic
2.3 Add the loadFromDB() calls at startup
The gateway components have loadFromDB() methods for restart-safe state recovery, but they're never called. Add initialization logic to load circuit breaker and quota state from the database on startup.
Priority 3: Medium (Improve Quality)
3.1 Add architecture fitness function tests
Create tests that enforce:
- No Drizzle imports in files outside specific allowed paths
- No circular imports within packages/ai/src/
- All AI calls go through the gateway (no direct provider.ts usage except in gateway/)
- Session FSM transitions are valid
3.2 Add test infrastructure
The project has vitest configured but zero tests. The design doc defines 12 verification layers (A through L). Prioritize:
- Layer A (unit tests) for gateway components, evaluator, tutor decisions
- Layer B (contract tests) for component interfaces
- Layer D (provider failure tests) for circuit breaker, quota, fallback
3.3 Split contracts.ts into domain-specific contract files
At 561 lines, contracts.ts will become a merge conflict magnet. Split into:
- contracts/gateway.ts — AIRequest, AIResult, ProviderModel, etc.
- contracts/tutor.ts — TutorMessage, TutorResponse, TutorAction, etc.
- contracts/learner.ts — LearnerDimension, LearnerSnapshot, etc.
- contracts/memory.ts — MemoryQuery, MemoryHit, etc.
- contracts/content.ts — ContentReviewResult, etc.
Priority 4: Low (Future Improvement)
4.1 Implement the orchestrator fully
Currently OrchestratorImpl.request() just delegates to gateway.request() with priority/capability enrichment. The design doc specifies it should also check cache, classify tasks, and manage pg-boss job queue.
4.2 Add the tutor degradation ladder
When all AI providers fail during live tutoring, the system should:
1. Try fallback provider
2. Reuse approved content from library
3. Use prepared hints/examples
4. Fall back to deterministic template tutor
5. Preserve session state
This is designed in the spec but not implemented.
4.3 Add pg-boss integration for background jobs
enqueue() currently returns a stub. Background content generation (P3/P4) should actually be queued via pg-boss with proper retry and backoff.
Summary of Key Findings
Category	Finding	Severity
Pattern correctness	Gateway, circuit breaker, FSM, SM-2, EMA patterns are correctly implemented	✅ Good
Boundary enforcement	AI components bypass interfaces and query Drizzle directly	🔴 High
Testability	10+ singletons + no DI = impossible to unit test without DB	🔴 High
generators.ts	Bypasses gateway, missing circuit breaking/quota/tracking	🟡 Medium
tutor.ts	God component with 5+ responsibilities	🟡 Medium
Concurrency	Gateway singletons not thread-safe; FSM has TOCTOU race	🟡 Medium
Missing features	Orchestrator (stub), pg-boss (stub), tutor degradation (designed, not built)	🟡 Medium
Test coverage	Zero tests despite vitest configured and 12-layer test plan designed	🔴 High
Schema coupling	Every AI component imports 6-12 Drizzle tables directly	🟡 Medium
The architecture is well-designed at the conceptual level — the design doc is thorough, the patterns are appropriate, and the dependency direction is correct. The primary gap is between the designed architecture and the implemented architecture: the contracts exist but aren't enforced, the test plan exists but has no tests, and the component boundaries exist in the design but leak in the implementation.
