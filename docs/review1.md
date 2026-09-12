Code Review: CPD AI Subsystem
Summary Verdict
CONDITIONAL PASS — the architecture is well-designed and most invariants are correctly enforced. There are 4 blocking issues that must be fixed before any production use, 7 high-severity issues, and several medium/low items. The blocking issues are all in correctness, security, or concurrency domains.
BLOCKING Issues (must fix before ship)
B1. AIGatewayImpl bypasses Router.route() — capability/cost routing dead code
Area	Impact	Severity	Confidence
Architecture	Security, compliance	High	High
File: gateway.ts:89
AIGatewayImpl.processRequest() calls provider.complete() directly at line 89. The entire Router class (lines 9–37) — which is the design's single choke point for task-type routing, capability filtering, and cost-tier enforcement — is never invoked. This means:
- Any provider can serve any task type (no capability filtering)
- Cost-tier budget enforcement is unreachable
- The TaskType enum is meaningless at the gateway level
Fix: Wire Router into the gateway's processRequest path, or remove Router and document the design change. The recommended approach is to call this.router.route(taskType) to resolve the provider, then delegate to provider.complete().
B2. sessionCookieOptions() missing secure: true
Area	Impact	Severity	Confidence
Security	Session hijacking via MITM	High	High
File: apps/api/src/auth.ts:49
The cookie options are { path: "/", httpOnly: true, sameSite: "lax", maxAge: MAX_AGE_S }. The secure flag is absent. In production (HTTPS), cookies without secure are sent over plaintext HTTP, enabling session hijacking. httpOnly prevents JS access but not network interception.
Fix: Add secure: process.env.NODE_ENV === "production" (or always true in production). This is a one-line fix.
B3. MemorySystemImpl.queryExactDate — userId filter dropped when date is provided
Area	Impact	Severity	Confidence
Correctness	Cross-user data leak	High	High
File: memory.ts:159
The sessionReports query filters only on eq(sessionReports.userId, q.userId) regardless of q.date, but the dailySessions query filters on both userId AND localDate. The report join uses reportMap.get(row.id), so the userId filter is correct here. However, the intent is confusing and the two queries are not joined — if the sessionReports table has records for multiple users on the same date, the reportMap may map the wrong report to the wrong session if session IDs collide across users (unlikely but architecturally unsound).
More critically: Line 160: q.date ? and(eq(sessionReports.userId, q.userId)) : eq(sessionReports.userId, q.userId) — the and() with a single clause is a no-op wrapper, and both branches produce the same filter. The q.date branch was likely intended to also filter on sessionReports.createdAt or sessionReports.sessionId but doesn't.
Fix: Either remove the branching (since both paths are identical) or add the intended date filter. At minimum, remove the dead conditional to avoid confusion.
B4. applyEvidence read-modify-write race condition
Area	Impact	Severity	Confidence
Concurrency	Stale dimension values, lost updates	High	Medium
File: learner-model.ts:289–416
applyEvidence() does: (1) SELECT existing rows, (2) compute new values in memory, (3) INSERT/UPDATE. Under concurrent requests for the same userId+nodeId, two requests can read the same current state, compute independently, and the second write overwrites the first — losing evidence updates. The onConflictDoUpdate writes a fixed value/confidence but doesn't compose with the in-flight update.
Fix: Wrap in a transaction with SELECT ... FOR UPDATE, or use an atomic EMA update formula in SQL (e.g., SET value = value + alpha * (target - value)). The current in-memory approach cannot be made safe without locking.
HIGH Issues (fix before production)
H1. RateLimiter module-level singleton not resettable
Area	Impact	Severity	Confidence
Testing	Test isolation failure	High	High
File: rate-limiter.ts:102–109
_instance is module-level with no reset function (unlike provider.ts which has resetProvider() and client.ts which has resetDbInstance()). Tests cannot create fresh RateLimiter instances; the class is also not exported for direct instantiation.
Fix: Export RateLimiter class (it already has a public constructor), or add a resetRateLimiter() function mirroring the pattern in provider.ts.
H2. RetryPolicy private constructor with no test reset
Area	Impact	Severity	Confidence
Testing	Cannot unit-test with deterministic delays	High	High
File: retry.ts:54
The constructor is private, forcing use of getInstance(). The singleton is never resettable. For tests, you cannot create a RetryPolicy with custom baseDelayMs/maxDelayMs.
Fix: Make the constructor public (or add a static create() factory), and add a static reset() method. The getDelay method uses Math.random() which makes tests non-deterministic — inject a PRNG or use vi.spyOn(Math, 'random').
H3. ContextCompiler module-level singleton not resettable
Area	Impact	Severity	Confidence
Testing	Test isolation, memory leaks	High	Medium
File: context-compiler.ts:138–145
Same pattern as RateLimiter — module-level _compiler with no reset. Also, getContextCompiler() ignores the db parameter after first call (it returns the cached instance even if a different db is passed).
Fix: Add resetContextCompiler() and export the class.
H4. Template exercise answer index always 0
Area	Impact	Severity	Confidence
Correctness	Cheatable assessments	Medium	High
File: generators.ts:254, 337–357
Template fallback assessments and conceptual questions always put the correct answer at index 0. A learner who notices this pattern can answer correctly without reading.
Fix: Randomize answerIndex in template generators, or shuffle options post-generation.
H5. sanitizePayload leaks answerIndex for ASSESSMENT questions
Area	Impact	Severity	Confidence
Security	Answer key exposure	Medium	High
File: apps/api/src/sanitize.ts:35–38
The sanitization maps questions but does NOT strip answerIndex. The MCP spec says the learner should never see the answer key. While the route at content.ts:49 calls sanitizePayload, the sanitized output still contains answerIndex.
Fix: Add delete qq.answerIndex (or omit it from the mapped object) for MCQ questions.
H6. No frontend app or API tests exist
Area	Impact	Severity	Confidence
Testing	Zero verification of any invariant	High	High
File: (global)
Zero test files across the entire codebase. Zero test scripts in package.json. The design spec defines 12 verification layers (A–L); none are implemented. This is a blocking gap for any production deployment.
H7. Worker app is empty — no background execution loop
Area	Impact	Severity	Confidence
Architecture	Designed components unreachable	Medium	High
File: apps/worker/src/index.ts
The worker is a skeleton. Orchestrator.enqueue() is a no-op. The SessionController.phase() FSM exists but is never called from any route or worker. The entire session lifecycle (Phase 1–11) and background generation pipeline are dead code paths with no entry point.
MEDIUM Issues
M1. sql\...\${domainNodes.id} IN \${nodeIds}\`` — SQL injection vector via array values
File: memory.ts:259
Using sql\IN \${nodeIds}\` with a raw array is safe in Drizzle (it parameterizes), but the template literal approach is fragile. Drizzle's inArray()` operator is the safer idiom.
Recommendation: Replace with .where(inArray(domainNodes.id, nodeIds)).
M2. recordSessionMemory uses sql.placeholder("userId") but never binds it
File: memory.ts:44
The userId field in the insert uses sql.placeholder("userId") but there's no .execute({ userId: ... }) call. The sessionReports table requires userId (NOT NULL). This will fail at runtime.
Fix: Pass userId as a parameter or use s.userId directly (the SessionMemory interface doesn't carry userId, so the caller must provide it — this is a design gap in the MemorySystem interface).
M3. retry.ts jitter formula produces delays exceeding maxDelayMs
File: retry.ts:86–87
const jitter = Math.random() * capped * 0.5 then return Math.floor(capped + jitter). If capped = maxDelayMs, the result can be maxDelayMs + maxDelayMs * 0.5 = 1.5 * maxDelayMs. The jitter should be applied to the base, not added after capping.
Fix: const backoff = Math.min(baseDelayMs * Math.pow(2, attemptNumber), maxDelayMs); return Math.floor(backoff + Math.random() * backoff * 0.3);
M4. parseRetryAfter — negative delta returns 0 instead of retrying immediately
File: retry.ts:43
return delta > 0 ? delta : 0 — if the Retry-After date is in the past, it returns 0. This is correct (retry immediately), but the comment should clarify intent.
M5. DomainExpansion type declared but never exported or used
File: domain-builder.ts:31–34
The DomainExpansion interface is declared but the expandDomain function returns NewNode[] not DomainExpansion. Dead type.
M6. MemorySystem.query — SEMANTIC kind falls through to CONCEPT_INDEX
File: memory.ts:117
The design spec calls for semantic similarity search (vector embeddings). The current implementation just does concept-index lookup. This is a known limitation per §5.1.6 ("future enhancement") but should be documented in code.
M7. learner-model.ts applyEvidence uses prev as fallback for unrelated dimensions
File: learner-model.ts:352
const cur = current.get(delta.dimension) ?? prev — if a dimension hasn't been initialized, it falls back to the implementation_skill value (the prev variable from line 344). This means uninitialized conceptual_understanding inherits implementation_skill's value, which is semantically wrong.
Fix: Use a per-dimension default (0 or DEFAULT_CONFIDENCE) instead of prev.
LOW Issues
#	File:Line	Issue
L1	sanitize.ts:36	ASSESSMENT promptMd is included but promptMd is not on the ContentPayload ASSESSMENT type — likely should be omitted
L2	generators.ts:207	templateExercise throws if no archetype matches — should return a graceful fallback
L3	evaluator.ts:18	EvidenceEvent import used for type but the evidenceEvents table import is also named evidenceEvents — minor naming collision
L4	tutor-reasoning.ts:147	supersedeHypothesis copies evidence from old to new but doesn't clear the old — both hypotheses share evidence refs
L5	gateway/quota.ts	QuotaManager uses Map with no eviction — long-running processes accumulate stale entries
L6	domain-builder.ts:207	templateExercise throws Error on missing archetype — uncaught error in a generator path
Evidence Quality Matrix
Layer	Status	Notes
A: Component (unit)	❌ None	Zero test files
B: Contract (schema)	❌ None	Zod schemas exist but no tests validate them
C: Provider (integration)	❌ None	No mock provider tests
D: AI Response	❌ None	No response-shape validation tests
E: State Machine	❌ None	11-phase FSM has no state transition tests
F: Integration	❌ None	No route-level tests
G: Failure / retry	❌ None	No circuit breaker / retry tests
H: Behavioral	❌ None	No test.sh or assertion-based scripts
I: Session Lifecycle	❌ None	No end-to-end session flow tests
J: Longitudinal	❌ None	No spaced repetition tests
K: Cross-Session	❌ None	No hypothesis cascade tests
L: System	❌ None	No load / soak tests
Recommended Priority Order
1. B2 (cookie secure) — one-line fix, immediate security win
2. B1 (gateway routing) — wire Router or remove it
3. B4 (concurrency) — add transaction locking to applyEvidence
4. H5 (sanitize leaks answerIndex) — one-line fix
5. H1/H2/H3 (testability resets) — add reset functions for singletons
6. B3 (memory query bug) — fix the dead conditional
7. H6 (write tests) — start with Layer A on CircuitBreaker (pure class, zero deps)
8. M2 (placeholder binding) — fix before any integration test runs
