# AI Subsystem — Design Contracts

Reference spec: `usethisforAIsubsystem.txt` (the 63-section requirements doc). This file fixes the component architecture, interfaces, state models, and contracts for the AI subsystem of Code Practice Daily, grounded in the existing schema (`packages/core/src/db/schema.ts`) and modules (`packages/ai/*`, `apps/api`, `apps/executor`).

## 0. Grounding in the current codebase

Already implemented (Phases 3–4 of the spec, deterministic first):

| Spec concept | Where it lives today |
|---|---|
| Content Intelligence (retrieval-first, generate, validate, persist, version) | `packages/ai/src/content-service.ts` (retrieval → generate via provider or template → `validateContent` → persist `AI_GENERATED`/`TEMPLATE`, `VALIDATED` only when checks pass), `packages/ai/src/validator.ts` (schema + sandbox execution), `content_items` table (payload jsonb + validation result) |
| Content generation pipeline (schema → deterministic validation) | `validator.ts`; AI critic + bounded repair are NOT yet built |
| Curriculum Intelligence (graph, prerequisites, frontiers, expansion) | `domain_nodes`, `domain_edges`, `user_learning_path`, `packages/ai/src/domain-builder.ts` (CPP/PYTHON/RUST/C/BASH/JS frontiers + AI expansion), `tutor.ts` `ensureInitialPath`/`expandObjective` |
| Daily planning / session plan | `tutor.ts` `decideObjective` (REVIEW/RECOVERY/CURRICULUM/ASSESS decisions), `composeSession` → `daily_sessions` (decision jsonb, kind REGULAR/RECOVERY/REVIEW) + `daily_tasks` |
| Learner model (mastery, retention, misconceptions) | `user_concept_state` (recallStrength, consecutiveSuccess/Fail, totalAttempts, nextReviewAt, reviewIntervalDays, reviewEase, reviewCount), SM-2 in `evaluator.ts`, `mistakes` table (upsert by userId+nodeId+pattern, severity), `user_goals` + `goal_milestones` |
| Evidence / facts | `submissions`, `executions`, `daily_completions`, `xp_ledger`, `streaks` |
| Session memory / reporting | `daily_sessions` + `daily_tasks` + `completions`; structured session REPORT (handoff) NOT yet built |
| Provider abstraction | `packages/ai/src/provider.ts` — `getProvider()` with TEMPLATE deterministic fallback; no registry/router/quota/retry/circuit-breaker yet |
| Tutor reasoning engine (hypotheses, clarification, decision audit) | NOT built — `tutor.ts` is deterministic decision logic; this doc defines the contracts for adding it |
| Executor | `apps/executor` — 6 languages (cpp/python/rust/c/bash/js), harnesses with wire format `P|desc|expected|actual`, sandboxed docker/bwrap |

Non-negotiable invariants (from the spec, already enforced by design):
- Facts (submissions/executions/completions) are written only by deterministic code.
- AI interpretations never silently mutate curriculum/session state; they are persisted as hypotheses/decisions with evidence refs and are auditable.
- No part of the tutoring system calls a provider SDK directly; everything goes through the AI Gateway / Orchestrator.

## 1. Component architecture

```
                        APPLICATION (api + web)
                                 │
            ┌────────────────────┼────────────────────┐
            ▼                    ▼                    ▼
   Session UI (web)     Session HTTP API     Background Worker (pg-boss)
            │                    │                    │
            └─────────┬──────────┴────────────────────┘
                      ▼
        ╔═════════════════════════════════════════════╗
        ║              AI SUBSYSTEM                   ║
        ║  gateway/   provider abstractions, router,  ║
        ║             quota, rate limit, retry,       ║
        ║             fallback, circuit breaker,      ║
        ║             observability                   ║
        ║  orchestrator/ task registry, priorities,   ║
        ║             request lifecycle, cache,       ║
        ║             context compiler                ║
        ║  content/   retrieval, generation,          ║
        ║             validation, review, repair,     ║
        ║             versioning, provenance          ║
        ║  curriculum/ planner, progression,          ║
        ║             prerequisites, daily-plan       ║
        ║  learner/   learner model, mastery,         ║
        ║             misconceptions, retention,      ║
        ║             independence                    ║
        ║  memory/    session, historical, learner,   ║
        ║             tutor-experience, retrieval     ║
        ║  tutor/     reasoning loop, hypotheses,     ║
        ║             clarification, decisions,       ║
        ║             pedagogy, strategy memory       ║
        ║  session/   controller, state machine,      ║
        ║             report, handoff                 ║
        ║  evaluation/ tutor/content evaluation,      ║
        ║             decision audit, outcome analysis║
        ╚═════════════════════════════════════════════╝
                      ▼
                AI PROVIDERS (via adapters)
```

Dependency direction: `evaluation ← session ← tutor ← {memory, learner, curriculum, content} ← orchestrator ← gateway`. `tutor` depends on interfaces, never on providers.

## 2. Component responsibilities

- **AI Gateway** (`gateway/`): provider-agnostic `generate/stream/structuredGenerate`. Owns provider registry, model registry, capability registry, quota, rate limits, health, circuit breaker, retry/backoff/jitter, fallback routing, usage+cost tracking. Callers never name a provider.
- **AI Orchestrator** (`orchestrator/`): the only entry point for AI work from higher layers. Classifies tasks, checks cache, reserves quota by priority, routes, executes, validates, retries/falls back, records usage, returns result. Exposes `orchestrator.request(task)`; live-tutor tasks are P0 and must never queue behind background jobs.
- **Content Engine** (`content/`): retrieval-first library for lessons/examples/hints/exercises; need-driven generation; pipeline `requirement → search → generate → schema → deterministic validation → AI review → bounded repair → approve → persist (immutable, versioned)`.
- **Curriculum Engine** (`curriculum/`): owns the dependency graph, prerequisites, progression, and *where* the learner goes. Produces daily plan inputs; does not teach.
- **Tutor Engine** (`tutor/`): owns *how* to teach — the reasoning loop (observe → evidence → interpret → hypothesize → clarify → decide → intervene → evaluate → update learner model and tutor experience → next action). The only component allowed to call the clarification engine.
- **Learner Model** (`learner/`): multidimensional belief state with per-dimension confidence and evidence refs. Read/write via this module only.
- **Memory System** (`memory/`): five stores (session, learner, historical, tutor-experience, temporary context) + retrieval (exact/date, concept-indexed, semantic only where needed).
- **Session Engine** (`session/`): validates state transitions, holds current-phase state, produces the session report and next-session handoff.
- **Evaluation** (`evaluation/`): tutor/content quality metrics, decision audit, cost-per-outcome.

## 3. Interfaces between components

All cross-component calls are TypeScript interfaces in `packages/ai/src/contracts.ts` (single source). Key signatures:

```ts
// gateway
interface AIGateway {
  generate(req: AIRequest): Promise<AIResult>;
  stream?(req: AIRequest, onChunk: (s: string) => void): Promise<AIResult>;
  structuredGenerate<T>(req: StructuredRequest<T>): Promise<T | null>; // null = unrecoverable failure
}
interface AIRequest {
  taskType: AITaskType; priority: Priority; userId?: string; sessionId?: string;
  jobId?: string; messages: ChatMessage[]; outputSchema?: ZodType;
  contextBudgetTokens?: number; cacheKey?: string;
}
// orchestrator
interface Orchestrator {
  request(req: AIRequest): Promise<AIResult>;          // P0/P1 synchronous
  enqueue(req: AIRequest): Promise<JobRef>;             // P2–P4, durable (pg-boss)
}
// tutor
interface TutorEngine { /* existing + */
  handleIncoming(userId: string, sessionId: string, message: TutorMessage): Promise<TutorResponse>;
}
// learner model
interface LearnerModel {
  get(userId: string): Promise<LearnerSnapshot>;
  applyEvidence(userId: string, evidence: EvidenceEvent[]): Promise<void>; // deterministic updates only
  updateHypothesis(userId: string, h: Hypothesis): Promise<void>;
}
// memory
interface MemorySystem {
  recordSessionMemory(s: SessionMemory): Promise<void>;
  recordHistorical(e: EvidenceEvent): Promise<void>;
  recordTutorExperience(x: TutorExperienceRecord): Promise<void>;
  query(q: MemoryQuery): Promise<MemoryHit[]>; // exact date / concept / semantic (fallback)
}
```

`TutorEngine` keeps its existing deterministic API (`composeSession`, `decideObjective`, `submit`, `hints`, `debugAssist`) — the reasoning loop is additive.

## 4. State models

### 4.1 Evidence event (fact — deterministic writers only)
```
EvidenceEvent { id, userId, sessionId?, type: ANSWER|QUESTION|CODE_SUBMISSION|CODE_EXECUTION|ERROR|
  EXERCISE_RESULT|EXPLANATION|HINT_REQUEST|SELF_CORRECTION|CONFIDENCE_STATEMENT|LEARNER_CLAIM|SESSION_BEHAVIOR,
  concept?, result?: correct|incorrect|partial|timeout|error, source: learner|compiler|assessment|tutor|system,
  payload: jsonb, observedAt }
```
Persisted in new table `evidence_events` (append-only). Existing `submissions`/`executions` remain; evidence_events references them.

### 4.2 Hypothesis (belief — AI-written, audited)
```
Hypothesis { id, userId, subject, statement, confidence, supportingEvidence: [evidenceId],
  contradictingEvidence: [evidenceId], alternatives: [string], createdAt, lastEvaluatedAt,
  status: ACTIVE|UNCERTAIN|CONFIRMED|WEAKENED|DISPROVEN|SUPERSEDED }
```
New table `tutor_hypotheses`. Always linked to at least one evidence event; never silently deleted — superseded.

### 4.3 Tutor decision (audit)
```
TutorDecision { id, sessionId, userId, observations: [evidenceId], hypotheses: [hypId],
  selectedHypothesis?, confidence, action, expectedOutcome, actualOutcome?, verdict: unknown|correct|incorrect, correction? }
```
New table `tutor_decisions`. Written at decision time; verdict/actualOutcome filled later by the evaluation layer.

### 4.4 Tutor experience memory (what teaching worked)
```
TutorExperienceRecord { id, concept, learnerProblem, strategy, outcome: effective|ineffective|mixed,
  context: { learnerState?, difficulty? }, evidenceRefs, createdAt }
```
New table `tutor_experience`. This is memory about the tutor's interventions, not about the learner.

### 4.5 Session report / handoff
```
SessionReport { sessionId, userId, objective, planned[], completed[], incomplete[],
  evidenceSummary, strengths[], weaknesses[], misconceptions[], unresolvedHypotheses[],
  strategies: { strategy, outcome }[], learnerQuestions[], learnerContext[],
  environmentalIssues[], hintDependency, independentPerformance, retention,
  decisionsRequiringReview[], recommendedNext[] }
```
Persisted as a row in new table `session_reports` (jsonb body) + materialized summaries on `daily_sessions`. It is the primary input to the next day's planner.

## 5. Data models (deltas to schema.ts)

New tables (all with `created_at`, FKs to users where appropriate):
1. `evidence_events` (see 4.1) — index on (user_id, observed_at), (session_id).
2. `tutor_hypotheses` (4.2).
3. `tutor_decisions` (4.3).
4. `tutor_experience` (4.4).
5. `session_reports` (4.5).
6. `ai_requests` (observability: requestId, taskType, priority, userId, sessionId, jobId, provider, model, promptVersion, status, latencyMs, tokensIn/Out, estCost, retryCount, fallbackChain, error) — written by orchestrator for every AI call.
7. `content_reviews` (provenance for content: contentId, version, reviewType: SCHEMA|DETERMINISTIC|AI_CRITIC, passed, issues jsonb, reviewer, reviewerModel, promptVersion, createdAt).
8. `user_goal` milestone progress already exists (`goal_milestones`); add `completed_at` status transitions if needed — currently first ACTIVE rest LOCKED.

Extensions: `content_items` gains `supersededBy` (uuid nullable) and `version` (int, default 1); never mutate a validated payload — insert v2 and supersede.

## 6. AI request/response contracts

```ts
type AITaskType = "CURRICULUM_PLANNING" | "DAILY_SESSION_PLANNING" | "SESSION_REVIEW" |
  "LEARNER_DIAGNOSIS" | "HYPOTHESIS_GENERATION" | "HYPOTHESIS_EVALUATION" | "TUTOR_EXPLANATION" |
  "TUTOR_CLARIFICATION" | "TUTOR_HINT" | "TUTOR_EXAMPLE" | "TUTOR_ANALOGY" | "TUTOR_DEBUGGING" |
  "TUTOR_CODE_REVIEW" | "SESSION_SUMMARY" | "LEARNER_STATE_ANALYSIS" |
  "CONTENT_GENERATION" | "CONTENT_REVIEW" | "CONTENT_REPAIR" | "CONTENT_CLASSIFICATION" | "REMEDIATION_GENERATION";
type Priority = "P0" | "P1" | "P2" | "P3" | "P4";
interface AIResult { ok: boolean; content?: string; data?: unknown; provider: string; model: string;
  latencyMs: number; tokens: { in: number; out: number }; costUsd: number; fromCache: boolean; error?: AIErrorKind }
```

Routing policy: task → required capabilities (e.g. `structuredOutput`, `code`, `fastLatency`) → candidate models from registry filtered by health/quota → cost/latency-weighted pick. Deterministic template fallback remains the final resort for CONTENT_* and, degraded, for TUTOR_HINT/EXPLANATION (spec §51 live degradation ladder).

## 7. Quota and fallback strategy

- Token buckets per provider per window (rpm/tpm/day/month); reservations are atomic and priority-aware — a P3/P4 job can only reserve from the pool above a reserved P0/P1 floor.
- Error taxonomy: `RATE_LIMIT` (retry w/ backoff+jitter, honor Retry-After), `DAILY_QUOTA_EXHAUSTED` (no retry; route to another capable provider or degrade), `PROVIDER_FAILURE` (circuit breaker: open after N failures, half-open probe), `MODEL_UNAVAILABLE` (reroute), `INVALID_REQUEST` (no retry, log + alert).
- Fallback chain: same-capability model on another provider → same provider another model → template (content) / degraded tutor (live). Fallback receives the identical semantic task and output schema.
- Persisted state in `provider_state` table (circuit breaker counts, quota windows) so restarts don't reset breakers.

## 8. Content generation lifecycle (need-driven)

```
Need { concept, learningObjective, learnerLevel, prerequisites, reason, resourceType,
       difficulty, estMinutes, curriculumContext, knownWeaknesses? }
  → search approved content (by concept+kind+difficulty range+language, validated=true)
  → reuse if suitable
  → else orchestrator.request(CONTENT_GENERATION, priority by context: P0 if learner waiting, else P3)
  → candidate → schema validation → deterministic validation (sandbox-execute reference: compile, tests,
    edge cases) → AI critic (issue types: TECHNICAL_ERROR|PREREQUISITE_VIOLATION|PEDAGOGICAL_ERROR|
    DIFFICULTY_MISMATCH|AMBIGUITY|DUPLICATION|INCORRECT_EXAMPLE|INVALID_EXERCISE|
    INCORRECT_EXPECTED_OUTPUT|INCONSISTENT_DEFINITION) → bounded repair (max 2 rounds) → final validation
  → insert content_items v{n} with provenance; supersede on repair.
```

Never auto-publish: an item is visible to learners only when `validation.state = VALIDATED`. Deterministic validation failure always rejects, regardless of critic opinion.

## 9. Content review lifecycle

AI critic runs as `CONTENT_REVIEW` with the original need + learner level + prerequisites + generated payload + technical constraints; returns structured issues only. Repair (`CONTENT_REPAIR`) regenerates only the flagged fields. Both logged in `content_reviews`.

## 10. Learner model design

Per-concept dimensions (all float 0..1, each with confidence + evidenceRefs + lastUpdated + history):
`conceptualUnderstanding, proceduralSkill, implementationSkill, problemRecognition, reasoning,
explanationAbility, debuggingSkill, transferAbility, retention, independence, hintDependency (inverted),
confidence`.

- Storage: new table `learner_dimensions` (user_id, node_id, dimension, value, confidence, evidence_jsonb, updated_at) — append-only history in `learner_dimension_history` or jsonb on update; retention continues to use SM-2 in `user_concept_state`.
- Multi-signal: dimension updates are deterministic functions of evidence (assessment results, coding performance, debugging, explanations, predictions, transfer, hint usage, repeated mistakes, self-corrections, learner statements, retention checks). Example rule: `implementationSkill` updates from CODING executions and hint usage; `problemRecognition` from TRACING/PREDICTION and transfer items; `explanationAbility` from EXPLAIN answers.
- Environment/context factors live in temporary context (session-scoped), never baked into learner dimensions.

## 11. Memory architecture

- Session memory: `daily_sessions` + `daily_tasks` + `evidence_events`(sessionId) + `session_reports`.
- Historical memory: exact date/session lookups over `daily_sessions`+`session_reports`; concept history over `user_learning_path`/`domain_nodes`/`evidence_events(concept)`; semantic retrieval (embeddings) only for open-ended "when did we…" queries, always cross-checked against structured records before answering.
- Learner memory: `learner_dimensions`, `mistakes`, `user_concept_state`.
- Tutor experience: `tutor_experience`.
- Temporary context: `daily_sessions`-scoped jsonb (`environmental_notes`, learner claims), cleared per session.
- Retrieval: exact/date first; never send whole history; context compiler selects.

## 12. Tutor reasoning lifecycle

```
observe (evidence event) → extract evidence → update learner model (deterministic)
  → hypotheses: if evidence ambiguous, generate hypotheses (LLM or template) w/ confidence
  → uncertainty: if top-2 confidences close → clarification engine asks smallest distinguishing question
  → interpret reply (updates hypotheses + learner model)
  → decision engine (action from table below), constrained by deterministic curriculum state
  → intervention (teach/ask/practice/hint/remediate…) → observe outcome → evaluate
  → record tutor_experience + tutor_decisions verdict → next action
```

Action set: `CONTINUE|EXPLAIN|REEXPLAIN|ASK|DIAGNOSE|GIVE_HINT|GUIDED_SOLUTION|REVIEW_PREREQUISITE|
CHANGE_TEACHING_METHOD|REPEAT|ADVANCE|REMEDIATE|PAUSE|END_SESSION`.

Pedagogical strategies: `DIRECT_EXPLANATION|SIMPLIFICATION|ANALOGY|CONCRETE_EXAMPLE|COUNTEREXAMPLE|
VISUAL_MODEL|CODE_TRACE|PREDICTION|SOCRATIC_QUESTION|GUIDED_PROBLEM|DEBUGGING|PREREQUISITE_REVIEW|
COMPARISON|REAL_WORLD_APPLICATION|TRANSFER_PROBLEM|SPACED_REVIEW|INDEPENDENT_ATTEMPT`.

Strategy choice is evidence-based; repeated failures of a strategy on the same problem type downgrade its preference (tutor_experience), with context keys (concept, problemType, learnerState).

## 13. Hypothesis/clarification model

- Hypotheses per spec §35 (fields in 4.2). Status transitions: ACTIVE → (evidence) → CONFIRMED/WEAKENED/DISPROVEN → SUPERSEDED.
- Clarification: only when distinguishing information exists; the smallest question that separates the top hypotheses; learner answer is `LEARNER_CLAIM` evidence; claims can update (not flip) confidence; verify high-stakes claims with a follow-up question or diagnostic task (spec §38/§49).
- Scenario A (keyboard): repeated punctuation errors + learner claim → new temporary context (environmental) → those errors excluded from syntax-weakness evidence while context active.

## 14. Session state machine

```
OPENING → RECALL → DIAGNOSTIC → TEACHING → INTERACTION → GUIDED_PRACTICE → INDEPENDENT_PRACTICE
  → TRANSFER → ASSESSMENT → REFLECTION → CLOSING
```
Phases optional per session; tutor recommends transitions, session engine validates (persisted phases on `daily_sessions.phase` jsonb or per-phase rows). Existing session lifecycle (`SCHEDULED → ACTIVE → COMPLETED`) stays; phase sub-state is additive.

## 15. Daily planning lifecycle

Inputs: curriculum state, yesterday's `session_reports`, recent sessions, learner model, unresolved work, retention schedule, planned trajectory, tutor observations. Planner (task `DAILY_SESSION_PLANNING`) emits: `objective, reason, retrievalItems[], prerequisiteChecks[], teachingSegments[], questions[], practice[], transfer[], assessment[], fallbackPath, expectedNextState`. `decideObjective` already produces decisions; the planner enriches it with reason + fallback path. The plan may deviate mid-session when evidence requires (spec §17).

## 16. Session report / handoff model

Per 4.5. Generated at CLOSING (`SESSION_SUMMARY` task, structured schema) by the worker; stored in `session_reports`; the planner's primary input next day. Must answer: what was planned/done/incomplete, evidence, strengths, weaknesses, misconceptions, unresolved hypotheses, strategies tried + outcomes, learner questions/context, environmental issues, independence, hint dependency, retention, decisions that look wrong, next actions.

## 17. Tutor decision audit model

Per 4.3 (`tutor_decisions`). Written for: curriculum changes, declaring mastery, remediation, strategy switches, long-term learner-model changes, hypothesis status changes. The evaluation layer compares expected vs actual outcome after a lag window and writes the verdict. Incorrect decisions are never deleted — superseded with correction.

## 18. Error/failure handling

- Live tutor (P0): provider failover → approved content reuse → prepared hints/examples → degrade to deterministic template tutor → preserve session state. Never lose progress.
- Content (P3/P4): fail on quota exhaustion and retry later (job stays in pg-boss with backoff), preemptible.
- Executor failures: mark content unvalidated (already the behavior: `executor unreachable — content left unvalidated`), do not publish.
- Circuit breakers + quota persisted (restart-safe).

## 19. Caching strategy

1. Approved-content cache (the content library itself, query by need). 2. Semantic response cache for deterministic/common queries (e.g. small example variants) keyed by hash of task+context-fingerprint. 3. Provider response cache for idempotent background generation (jobId-keyed). Live learner-specific answers are never cached. Cache hits bypass quota but are recorded in `ai_requests` with `fromCache=true`.

## 20. Context compilation strategy

`ContextCompiler.compile(request)` → budgeted prompt: system tutor policy (fixed) + curriculum objective + current session state + relevant learner dimensions (top-k by relevance, not all) + relevant history (exact matches) + tutor experience (matching concept/problemType) + approved content + current learner message. Enforce token budget per task type; drop least-relevant sections first; never include learner PII beyond name. Authority order on conflicts: application state/verified execution > approved curriculum > verified historical records > learner statements > tutor hypotheses > model speculation (spec §49).

## 21. Observability

Every AI call → `ai_requests` row (requestId, taskType, priority, userId/sessionId/jobId, provider, model, promptVersion, timestamps, latency, tokens, estCost, retryCount, fallbackChain, status, error). Answers to "why this model/fallback/failure, how much quota" must be queryable from this table + `provider_state`.

## 22. Verification contract (acceptance spec: `usethisforAIsubsystemTESTING.txt`)

Verification is part of the architecture; the subsystem is never declared working without demonstrated behavior. Compliance rules (spec §39): no weakened assertions, no mocking the component under test, no snapshot tests as behavioral proof, no hiding failures, every discovered bug becomes a permanent regression scenario.

### 22.1 Verification layers (each mandatory; passing one does not imply the next)

| Layer | Purpose | Home |
|---|---|---|
| A. Unit | deterministic logic: provider selection, capability matching, quota accounting/reservation/release, rate-limit state, retry/fallback policy, circuit breaker, prioritization, content state transitions, versioning, learner-state updates, evidence aggregation, hypothesis/session/curriculum transitions, memory persistence, temporal date resolution, decision recording, report generation | `tests/ai/unit/` |
| B. Contract | explicit I/O contracts per component: Gateway `AIRequest→AIResponse`, Tutor `TutorContext→TutorDecision`, Evidence `RawEvent→EvidenceEvent`, Hypothesis `EvidenceSet→HypothesisSet`, Planner `LearnerState+CurriculumState+PreviousSession→SessionPlan`, Reporter `SessionState→SessionReport`, Retrieval `MemoryQuery→MemoryResults`, Generator `Requirement→Content`, Reviewer `Content+Requirement→ReviewResult` — structured outputs only, no LLM-prose parsing for state transitions | `tests/ai/contract/` |
| C. Integration | components communicate and preserve state correctly against the real test DB | `tests/ai/integration/` |
| D. Provider failure | fake providers simulating: success, timeout, 429, daily-quota, token-quota, 500, malformed response, invalid structured output, unavailable model, invalid credentials, network failure, unexpected content — each must follow its policy (RATE_LIMIT → bounded backoff; DAILY_QUOTA → no repeated retry, mark unavailable until reset, route elsewhere; INVALID_CREDENTIALS → no continuous retry, mark unhealthy; MALFORMED → validate, bounded repair, else fail safe). Fallback test: A healthy → A fails → B selected with same task/capabilities/context, usage recorded against B, A marked, no duplicated learner action | `tests/ai/providers/` |
| E. Content pipeline | full lifecycle: requirement → retrieve → reuse or generate → schema → deterministic → AI review → bounded repair → revalidate → approve → persist → available to tutor. Deterministic failure always rejects regardless of AI opinion. Coding items: compile scaffold+reference, run every test, edge cases, reject broken reference/harness/malformed exercise | `tests/ai/content/` |
| F. Memory | five stores stay separate; new learner state never overwrites historical facts (Session A struggle + Session B mastery → historical query still reports A's struggle, current query reflects B); temporal queries (yesterday/Monday/when did we learn X/last week/planned today/already learned) retrieve actual stored records — LLM never invents history | `tests/ai/memory/` |
| G. Curriculum | continuity across sessions (partial completion recognized next session, progression from real state + dependencies, not one-item-per-day; one failed exercise does not auto-trigger excessive remediation) | `tests/ai/curriculum/` |
| H. Tutor behavior scenarios | behavioral spec of the tutor; each scenario: initial state, observed evidence, possible interpretations, learner response, expected tutor behavior, expected state changes, prohibited behavior. Evaluate structured decisions, not NL wording | `tests/ai/tutor/scenarios/` |
| I. Multi-session E2E | Day1→Day2→Day3 against the real test DB (spec §26, §27): plans, recall, clarify, context, strategy change, execute, report persisted, learner/curriculum/tutor-experience updated, Day 2 generated from Day 1 state, historical questions answered from records, later evidence revises prior hypothesis while original decision stays auditable | `tests/ai/e2e/` |
| J. Real-model evaluation | separate suite, versioned (model, provider, model version, prompt version, tutor policy version, scenario version, date, result, structured decision, evaluator result); evaluates structured properties (asked clarification? identified uncertainty? considered alternatives? updated after clarification? avoided unsupported diagnosis? retrieved history? chose appropriate intervention? avoided unnecessary remediation? preserved continuity?) — never exact text | `tests/ai/eval/` |
| K. Regression | every discovered tutor bug becomes a permanent scenario (e.g. `environmental-input-vs-learning-error`), runs in CI forever | `tests/ai/regressions/` |
| L. Invariant checks | 12 invariants from spec §34: history immutable; current state cannot rewrite facts; unapproved content never used as curriculum; quota never double-decremented; background never consumes protected live capacity; failed provider request never fabricates a tutor action; hypotheses ≠ facts; learner claims are evidence not facts; deterministic execution cannot be overridden by LLM opinion; decisions traceable to evidence; session reports reproducible from session events; curriculum position derivable from persisted state + approved transitions | `tests/ai/invariants/` |

### 22.2 Commands (npm workspaces — package.json `scripts`)

```
npm run ai:test            # all deterministic tests (A–I, K, L)
npm run ai:test:unit       # A
npm run ai:test:integration# C
npm run ai:test:providers  # D (+ quota concurrency, atomic final-reservation)
npm run ai:test:content    # E
npm run ai:test:tutor      # H (+ K regressions)
npm run ai:test:e2e        # I
npm run ai:eval            # J (real-model, only when providers configured)
npm run ai:verify          # complete suite → machine-readable report
```

### 22.3 Report + acceptance levels

`ai:verify` writes `verification-report.json` + console summary (Component/Contract/Provider/Quota/Content/Memory/Curriculum/Tutor Scenarios/Multi-Session E2E/Provider-Failure E2E/Real-Model/Unverified/Failed/Overall). Levels: `VERIFIED` (all deterministic+integration+behavioral+E2E pass, no critical invariant violations, real-model eval meets thresholds), `PARTIALLY_VERIFIED` (implementation works where tested but ≥1 layer incomplete), `FAILED` (behavior/invariants fail), `UNVERIFIED` (insufficient evidence). Never use "COMPLETE" as a synonym for "code exists". Final acceptance (§40): the Day1–Day3 sequence incl. provider failure, quota protection, fallback, auditable revision, and Day-3 history reconstruction must pass, else NOT VERIFIED.

Every claim of correctness must state: what was tested, how, expected, actual, deterministic?, real model involved?, what remains unverified.

## 23. Example end-to-end flows (spec §62)

Day 1: session opens (OPENING) → recall question → evidence → learner model update → teaching → repeated mistakes → hypothesis generation (syntax weakness vs typing) → clarification question → learner claim (bad key) → temporary context → intervention → fails → tutor_experience records failure → strategy switch → success → CLOSING → session report + decisions audit written.
Day 2: planner reads yesterday's report → retrieval-first opening → partial recall identified → connect to today's lesson → learner asks historical question → exact retrieval from session_reports → learner claims "we learned this" → history check: related concept learned, exact one not → explain difference → provider quota exhausted mid-session → circuit breaker + fallback provider → background generation paused (P3 job deferred) → live tutoring continues → weeks later prior diagnosis disproven → original decision preserved, correction recorded, future reasoning retrieves it.

## 24. Implementation order (after this doc is accepted)

Each phase ships with its verification layer (acceptance spec STEP 11: tests alongside every subsystem); `ai:verify` gates the whole effort.

1. Provider layer: registry, model registry, quota, rate limit, retry/backoff, circuit breaker, fallback, `ai_requests` observability, adapters (openai-compatible first). + layers A (unit), B (contract), D (provider failure + quota concurrency + fallback), invariants 4–6.
2. Orchestrator: task registry, priorities, structured outputs, context compiler, cache, request lifecycle, pg-boss integration for P2–P4. + layer A, invariant 5.
3. Content: AI critic + bounded repair + content_reviews + versioning/supersede. + layers A, E, invariants 3, 9, 11.
4. Evidence + learner dimensions + session phase sub-state. + layers A, C, invariants 1, 2, 7, 8, 10, 12.
5. Memory: evidence_events, tutor_experience, session_reports, historical retrieval. + layers F (memory separation + temporal queries), C.
6. Tutor reasoning loop: hypothesis engine, clarification, decision audit, strategy memory (replacing/augmenting deterministic decisions incrementally, deterministic always as fallback). + layers H (all §14–25 scenarios as the behavioral spec), K (regressions), invariant 10.
7. Session controller enrichment (phases, opening/closing, handoff). + layer G (curriculum continuity).
8. Evaluation: verdicts on tutor_decisions, metrics, cost/outcome. + layer J (real-model eval) and layer I (multi-session E2E, §26/§27 + §40 final acceptance), then `ai:verify` → verification report.
