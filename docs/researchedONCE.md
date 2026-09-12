Technical Research Report: Testing Infrastructure for CPD AI Subsystem
Research Question
Under the constraints of a TypeScript ESM monorepo (npm workspaces) with 12 mandatory verification layers (A-L), PostgreSQL via Drizzle ORM, a multi-language code execution sandbox, and an AI provider abstraction, what is the optimal vitest configuration, test isolation strategy, and first-implementable verification layer?
Scope
- Versions: vitest ^3.0.0, TypeScript 5.7+, Drizzle ORM ^0.38, Node.js ESM
- Platforms: Linux (primary), macOS (secondary)
- Decision horizon: Immediate — establishing the test foundation
- Excluded: CI/CD pipeline, frontend testing, production deployment
Evidence Matrix
1. Vitest Monorepo Configuration
Claim	Source	Strength	Caveat
test.projects replaces deprecated workspace in Vitest 3.2+	vitest.dev/guide/projects (primary)	Strong	API stable since 3.2
Root config doesn't inherit to projects by default	vitest.dev docs + community reports	Strong	Must use extends: true or shared config
vite-tsconfig-paths needed for workspace path aliases	vitest-dev/vitest#10054, community discussions	Strong	Built-in tsconfigPaths only in Vite 8+, vitest may not pick it up
Each project gets its own ViteDevServer	vitest source code (primary)	Strong	Isolation is real
Evidence: Vitest 3.x test.projects array accepts glob patterns (packages/*) or config file paths. Each project gets unique hashing, independent Vite server, and separate module graph. Root config only affects reporters, coverage, globalSetup. Path aliases require vite-tsconfig-paths plugin in both root and project configs.
2. Database Testing Strategy
Approach	Startup Time	Real SQL	Parallel Safety	Maturity	Evidence
PGlite (in-memory WASM)	~50-100ms	Yes (Postgres-compatible)	Per-file safe; concurrent workers have WASM contention risk	0.5.x (active development)	electric-sql/pglite issues #1046, #1053, #945
vitest-drizzle-mock	~0ms	No (mocked queries)	Fully parallel	0.6.0 (Feb 2026, 7 versions)	github.com/serialexp/vitest-drizzle-mock
Testcontainers (real Postgres)	~2-4s initial	Yes (exact match)	Fully parallel	Mature	Community standard
drizzle.mock() alone	~0ms	No	Fully parallel	Built into drizzle-orm	drizzle.team/docs/goodies#mock-driver
PGlite findings:
- Single-transaction limitation with pglite-socket (issue #1046): concurrent extended-protocol batches interleave across connections. Not relevant for this codebase because Drizzle uses direct PGlite client, not pglite-socket.
- SIGSEGV under heavy concurrent WASM init (issue #1053): Determined to be hardware-specific (Core Ultra 9 285HX), not a PGlite bug. Sequential or moderate parallelism is safe.
- SELECT COUNT(*) hang (issue #945): Fixed in v0.4.3 by disabling parallel query planner. Workaround: SET max_parallel_workers_per_gather = 0.
- Key insight: Each vitest worker can have its own PGlite instance with memory:// URL. This avoids single-transaction contention entirely.
vitest-drizzle-mock findings:
- Uses drizzle.mock() constructor + mockDatabase() interceptor
- Supports node-postgres driver (matching this codebase's drizzle-orm/node-postgres)
- Table-based matching (mock.onSelect(schema.users).respond([...])) and SQL-based matching
- Very new (Feb 2026) but well-designed, supports transactions
- Risk: 7 versions total, no long track record
drizzle.mock() findings:
- Built into drizzle-orm since ~0.36
- drizzle.mock({ schema }) creates typed mock instance
- Cannot execute queries — only generates SQL. Issue #4177 confirms client.query is not a function error
- vitest-drizzle-mock solves this by intercepting prepareQuery
3. Testability of Current Codebase
Pattern	Location	Testability Impact	Mitigation
Module-level singletons (_instance)	circuit-breaker.ts:109, quota.ts:229, rate-limiter.ts, retry.ts, provider.ts:105	State leaks between tests	Need reset() functions or new per test
getDb() singleton	core/src/db/client.ts:17	Can't swap DB in tests	resetDbInstance() exists; mock module
getProvider() singleton	ai/src/provider.ts:107	Can't swap provider	resetProvider() exists
AIGatewayImpl constructor DI	gateway.ts:39	Good — accepts DB	Internal singleton access still hardcoded
CircuitBreaker constructor config	circuit-breaker.ts:20	Good — accepts config	Singleton getter ignores config after first call
QuotaManager — no constructor config	quota.ts:65	Config via registerProvider()	Fully testable as standalone class
Critical finding: The gateway components (CircuitBreaker, QuotaManager, RateLimiter, RetryPolicy) are all classes with public methods that can be instantiated directly in tests — the singletons are just convenience getters. Tests should instantiate classes directly, bypassing singletons entirely.
4. Provider Mocking
Claim	Source	Strength
AIProvider interface is clean and mockable	provider.ts:27-31 (primary source)	Strong
NullProvider provides fallback behavior	provider.ts:96-103	Strong
resetProvider() allows swapping in tests	provider.ts:115-117	Strong
structured() returns null when provider unconfigured	provider.ts:123-143	Strong
Evidence: The AIProvider interface has 3 members: name, configured, chat(). Creating a mock provider is trivial: { name: 'mock', configured: true, chat: vi.fn() }. The structured() function gracefully returns null when provider is unconfigured — enabling deterministic-only test paths.
5. Fastify Testing
Claim	Source	Strength
inject() provides in-process HTTP testing	fastify.dev/docs/latest/Guides/Testing (primary)	Strong
No need for supertest — inject() is faster	Fastify docs + vitest example	Strong
Must call app.ready() before inject()	helpmetest.com/blog/fastify-plugin-testing	Strong
Each test should get fresh Fastify instance	Community best practice	Strong
Evidence: Fastify's inject() uses light-my-request for fake HTTP injection without binding to a port. Plugins register asynchronously — ready() ensures all hooks/decorators are registered. The apps/api/src/index.ts creates a Fastify instance via a function pattern, making it testable.
Alternatives Synthesis
Option A: PGlite Integration + vitest-drizzle-mock Unit (Recommended)
For Layer A (Unit Tests):
- Use vitest-drizzle-mock for components that need mocked DB
- Instantiate gateway classes directly (bypass singletons)
- Mock AIProvider interface for provider-dependent tests
- No external dependencies needed
For Layer C (Integration Tests):
- Use PGlite with drizzle-orm/pglite driver
- One PGlite instance per test file (beforeAll)
- Schema push via drizzle-kit/api pushSchema()
- beforeEach truncates data for isolation
Pros: Fast (no Docker), real SQL for integration, typed mocks for unit
Cons: PGlite WASM contention under heavy parallelism; vitest-drizzle-mock is very new
Option B: Testcontainers (Real Postgres)
For all DB-dependent tests:
- Docker-based Postgres per test suite
- Snapshot-based restore for speed
- Exact production parity
Pros: Highest fidelity, mature ecosystem
Cons: Docker dependency, ~2-4s cold start, CI requires Docker service containers
Option C: drizzle.mock() + Manual SQL Assertions
For Layer A only:
- Use drizzle.mock() to generate SQL without executing
- Assert on generated SQL strings
- No DB, no mocks library
Pros: Zero dependencies, built into drizzle
Cons: Can't test actual query results, can't test transactions, limited to SQL generation assertions
Recommendation
Choose Option A (PGlite + vitest-drizzle-mock) with the following rationale:
1. Layer A (Unit Tests) is the immediate priority. The gateway components (CircuitBreaker, QuotaManager, RateLimiter, RetryPolicy) are pure classes with no DB dependency — they can be tested with zero infrastructure. vitest-drizzle-mock covers components that need DB mocking.
2. Layer C (Integration Tests) can use PGlite with per-worker isolation. The codebase uses Drizzle's direct PGlite client (not pglite-socket), avoiding the single-transaction limitation. Set max_parallel_workers_per_gather = 0 to avoid the Gather node hang.
3. The singleton pattern is not a blocker. Every gateway singleton has either a reset() function or can be bypassed by instantiating the class directly. Tests should never call getCircuitBreaker() — they should new CircuitBreaker({ failureThreshold: 3 }).
4. Risk mitigation for vitest-drizzle-mock immaturity: Start with Layer A tests that exercise the mock library's core features (table-based matching, respond/throw). If the library fails, fall back to vi.fn() stubs on the Drizzle instance — more verbose but proven.
Conditional Recommendation
- If PGlite causes WASM contention in CI: Fall back to Testcontainers for integration tests only. Keep vitest-drizzle-mock for unit tests.
- If vitest-drizzle-mock has breaking issues: Use drizzle.mock() + manual vi.fn() stubs on the session. More verbose but zero external dependency.
- If the team already has Docker in CI: Option B (Testcontainers) is simpler to reason about and has no WASM edge cases.
Confidence, Caveats, and Residual Uncertainty
Claim	Confidence	Basis
Vitest test.projects works for this monorepo	High	Primary docs + multiple community reports
vite-tsconfig-paths needed for @cpd/* imports in tests	High	Multiple confirmed issues, workspace symlink resolution
Gateway classes are testable via direct instantiation	High	Source code inspection — all have public constructors
PGlite works with Drizzle's node-postgres driver	High	Drizzle docs + community examples
vitest-drizzle-mock works with this codebase's Drizzle version	Medium	Requires drizzle-orm >=0.36.0; codebase has ^0.38.0 — compatible
PGlite parallel workers won't SIGSEGV in this project's CI	Medium	Hardware-specific issue; moderate parallelism (4-8 workers) should be safe
Layer A is the correct first implementation layer	High	Design doc §22.1, lowest-hanging fruit, foundation for all other layers
Residual uncertainty:
- PGlite behavior under this project's specific schema complexity (28 tables, 18 enums) — schema push time untested
- vitest-drizzle-mock handling of Drizzle relational queries (db.query.users.findMany()) — documentation doesn't cover this explicitly
- Whether pushSchema() from drizzle-kit/api works correctly with PGlite's WASM Postgres for all column types (jsonb, uuid, enum arrays)
