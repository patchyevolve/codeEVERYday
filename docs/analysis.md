Analysis Report: Code Practice Daily (CPD) — AI Tutoring Subsystem
1. Current Behavior and Intent
CPD is a daily coding apprenticeship platform with an AI-powered persistent tutor. The system:
- Generates daily practice sessions based on learner state and curriculum graph
- Evaluates code submissions against test cases in 8 languages (C++, Python, Rust, C, Bash, JS, ASM, SQL)
- Tracks mastery across 12 learner dimensions using SM-2 spaced repetition
- Maintains session memory, hypotheses about learner understanding, and strategy experience
- Provides debug assistance and progressive hints
The AI subsystem (design doc + 63-section spec) defines a multi-session tutoring loop with hypothesis/clarification/reasoning, but the current implementation is deterministic-first — AI is an optional refinement layer.
2. Implementation Status
Fully Implemented
Component	Location	Lines
DB Schema (28 tables, 18 enums)	packages/core/src/db/schema.ts	~500
Core utilities (mastery, SM-2, difficulty, streaks, dates)	packages/core/src/lib/	~800
AI Gateway (registry, router, quota, breaker, retry, fallback)	packages/ai/src/gateway/	8 files
Orchestrator	packages/ai/src/orchestrator.ts	141
Tutor Engine (deterministic decisions)	packages/ai/src/tutor.ts	491
Tutor Reasoning (hypotheses, clarification, audit)	packages/ai/src/tutor-reasoning.ts	373
Learner Model (12-dim EMA)	packages/ai/src/learner-model.ts	520
Content Pipeline (retrieval, generation, review, repair)	packages/ai/src/content-*.ts	818
Memory System (4 query types)	packages/ai/src/memory.ts	336
Session Controller (11-phase FSM)	packages/ai/src/session-controller.ts	276
Context Compiler (budgeted prompts)	packages/ai/src/context-compiler.ts	145
Domain Builder (8 language frontiers)	packages/ai/src/domain-builder.ts	703
Evaluator (submission grading)	packages/ai/src/evaluator.ts	490
API Server (11 routes)	apps/api/src/index.ts	472
Executor (6 language harnesses)	apps/executor/src/	9 files
Not Implemented
Component	Status
apps/worker/	Empty directory — no background jobs
apps/web/	Empty directory — no frontend
Seed content	Only 2 of 5 planned JSON files (cpp-dsa.json, python-fundamentals.json)
Stubbed / Incomplete
Component	Issue
Orchestrator.enqueue()	Returns JobRef but no pg-boss integration — no actual job queue
AIGatewayImpl	Picks models[0] directly instead of using Router.route()
Cache layer	AIResult.fromCache exists but no cache implementation
Semantic memory	query("SEMANTIC") delegates to concept-index — no embeddings
3. Architectural Boundaries
packages/core     — schema, constants, pure utils (no AI dependency)
packages/ai       — all AI logic, depends on core
packages/curriculum — seed data, depends on core + ai (for validation)
apps/api          — HTTP layer, depends on core + ai
apps/executor     — code sandbox, standalone (no workspace deps)
apps/worker       — (empty)
apps/web          — (empty)
Dependency direction is clean: core ← ai ← curriculum and core ← api, executor is standalone. No circular dependencies detected.
4. Data/Control Flow
Daily session lifecycle:
1. GET /api/today → buildLearnerProfile() → decideObjective() → composeSession() → writes daily_sessions + daily_tasks + content_items
2. POST /api/tasks/:id/submit → evaluateSubmission() → writes submissions + executions + user_concept_state + xp_ledger
3. POST /api/tasks/:id/debug-assist → debugAssist() → reads failed submission, returns guidance
AI provider flow (deterministic path):
- Content generation: generators.ts → tries orchestrator.request() → falls back to TEMPLATE deterministic generation
- No live tutoring interaction exists yet (P0/P1 synchronous path defined but never called in apps/api)
5. Risks
Correctness
- Zero tests. All 12 verification layers (A–L) from the design spec are missing. No vitest config. No ai:test* scripts in package.json. The e2e-eval.ts is a manual script with no assertions.
- Router not wired. AIGatewayImpl bypasses Router.route() — capability/cost routing is dead code.
- Enqueue is a no-op. Background jobs (P2–P4) never actually queue — pg-boss integration missing.
Security
- .env file is present in repo root (.gitignore confirmed present — needs verification that .env is excluded).
- Executor sandbox: Docker --network none and dropped capabilities are good, but plain process fallback has weaker isolation (only prlimit/ulimit).
Performance
- No caching layer for AI responses or content retrieval.
- MemorySystem.query("SEMANTIC") falls back to concept-index — no vector search for open-ended queries.
Maintainability
- All gateway singletons use module-level _instance patterns — testing requires careful reset.
- contracts.ts is 561 lines but well-organized as the single source of truth.
- domain-builder.ts at 703 lines is the largest file — frontier generation logic could benefit from decomposition.
6. Evidence and Uncertainty
Claim	Evidence	Confidence
Schema is complete for spec	28 tables, 18 enums, design doc tables §5 match	High
AI reasoning loop is functional	tutor-reasoning.ts has hypothesis/clarification/audit logic	Medium — no tests prove it works
Content pipeline works	content-review.ts + validator.ts + generators.ts all implemented	Medium — no tests
Executor supports 6 languages	6 harness files exist with compile+run logic	High — e2e-eval.ts exercises it
Background jobs needed but missing	apps/worker/ is empty; enqueue() is stubbed	High
7. Smallest Justified Next Step
Create the vitest configuration and test infrastructure. The design doc (§22.2) defines 9 npm scripts that should exist. The single most impactful action:
1. Add vitest.config.ts to the root
2. Add the ai:test* scripts to package.json
3. Implement Layer A (Unit Tests) for the deterministic components — these require no LLM, no live DB, and provide the foundation for all other layers
This is justified because:
- The codebase has ~8,600 lines of AI logic with zero verification
- Unit tests on deterministic components (quota, circuit breaker, retry, mastery state machine, SM-2, session FSM, hypothesis state transitions) are the lowest-hanging fruit
- Every other verification layer builds on this foundation
- The design doc explicitly states: "the subsystem is never declared working without demonstrated behavior"
