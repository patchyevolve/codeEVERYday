/**
 * DB-backed Job Queue — lightweight alternative to pg-boss.
 *
 * Uses polling with PostgreSQL LISTEN/NOTIFY for wake-up. Jobs are
 * inserted into the `ai_jobs` table and processed by a background loop.
 *
 * Spec reference: docs/ai-subsystem-design.md §2 (Orchestrator.enqueue)
 */

import { eq, sql } from "drizzle-orm";
import { aiJobs, type DB } from "@cpd/core";

/* ------------------------------------------------------------------ */
/* Types                                                                */
/* ------------------------------------------------------------------ */

export type JobStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";

export interface Job<T = unknown> {
  id: string;
  jobType: string;
  priority: string;
  status: JobStatus;
  payload: T;
  result: unknown;
  error: string | null;
  attempts: number;
  maxAttempts: number;
  runAfter: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
}

export type JobHandler<T = unknown> = (payload: T) => Promise<unknown>;

/* ------------------------------------------------------------------ */
/* JobQueue                                                             */
/* ------------------------------------------------------------------ */

export class JobQueue {
  private readonly handlers = new Map<string, JobHandler>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private processing = false;

  constructor(
    private readonly db: DB,
    private readonly pollIntervalMs = 2000,
    private readonly batchSize = 10,
  ) {}

  /** Register a handler for a job type. */
  on<T = unknown>(jobType: string, handler: JobHandler<T>): void {
    this.handlers.set(jobType, handler as JobHandler);
  }

  /** Enqueue a job. Returns the job ID. */
  async enqueue<T = unknown>(
    jobType: string,
    payload: T,
    opts: { priority?: string; runAfter?: Date; maxAttempts?: number } = {},
  ): Promise<string> {
    const [row] = await this.db
      .insert(aiJobs)
      .values({
        jobType,
        priority: opts.priority ?? "P3",
        status: "QUEUED",
        payload: payload as never,
        maxAttempts: opts.maxAttempts ?? 3,
        runAfter: opts.runAfter ?? new Date(),
      })
      .returning({ id: aiJobs.id });
    return row!.id;
  }

  /** Get job status. */
  async getJob(jobId: string): Promise<Job | null> {
    const [row] = await this.db
      .select()
      .from(aiJobs)
      .where(eq(aiJobs.id, jobId))
      .limit(1);
    return (row as Job) ?? null;
  }

  /** Start the background polling loop. */
  start(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      void this.poll();
    }, this.pollIntervalMs);
  }

  /** Stop the background polling loop. */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Atomically claim a batch of due jobs.
   *
   * `FOR UPDATE SKIP LOCKED` is the standard Postgres queue pattern: each
   * worker locks only rows it can actually take, so concurrent pollers never
   * claim the same job and never block each other. The previous
   * SELECT-then-UPDATE sequence let two workers pick up identical rows and run
   * the same job twice — harmless in a single process, but guaranteed to
   * duplicate work (and side effects) with more than one worker replica.
   */
  private async claimBatch(): Promise<Job[]> {
    const rows = await this.db
      .update(aiJobs)
      .set({
        status: "RUNNING",
        startedAt: new Date(),
        updatedAt: new Date(),
        attempts: sql`${aiJobs.attempts} + 1`,
      })
      .where(sql`
        ${aiJobs.id} in (
          select id from ${aiJobs}
          where ${aiJobs.status} = 'QUEUED'
            and ${aiJobs.runAfter} <= now()
          order by ${aiJobs.priority}, ${aiJobs.createdAt}
          limit ${this.batchSize}
          for update skip locked
        )
      `)
      .returning();
    return rows as unknown as Job[];
  }

  /** Process one batch of pending jobs (also callable manually). */
  async poll(): Promise<number> {
    if (this.processing) return 0;
    this.processing = true;

    let processed = 0;
    try {
      const pending = await this.claimBatch();

      for (const row of pending) {
        const handler = this.handlers.get(row.jobType);
        if (!handler) {
          await this.db
            .update(aiJobs)
            .set({ status: "FAILED", error: `No handler for job type: ${row.jobType}`, updatedAt: new Date() })
            .where(eq(aiJobs.id, row.id));
          continue;
        }

        // NOTE: `row.attempts` was already incremented when the job was
        // claimed, so failure handling below reuses it instead of adding 1
        // again (which would burn maxAttempts twice as fast).
        try {
          const result = await handler(row.payload as never);
          await this.db
            .update(aiJobs)
            .set({
              status: "COMPLETED",
              result: result as never,
              completedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(aiJobs.id, row.id));
          processed++;
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          const failed = row.attempts >= row.maxAttempts;

          await this.db
            .update(aiJobs)
            .set({
              status: failed ? "FAILED" : "QUEUED",
              error: errorMsg,
              attempts: row.attempts,
              runAfter: failed
                ? new Date()
                : new Date(Date.now() + this.backoffMs(row.attempts)),
              updatedAt: new Date(),
            })
            .where(eq(aiJobs.id, row.id));
          processed++;
        }
      }
    } finally {
      this.processing = false;
    }
    return processed;
  }

  /** Get counts by status. */
  async stats(): Promise<{ queued: number; running: number; completed: number; failed: number }> {
    const rows = await this.db
      .select({ status: aiJobs.status, count: sql<number>`count(*)::int` })
      .from(aiJobs)
      .groupBy(aiJobs.status);

    const stats = { queued: 0, running: 0, completed: 0, failed: 0 };
    for (const row of rows) {
      const key = row.status as keyof typeof stats;
      if (key in stats) stats[key] = row.count;
    }
    return stats;
  }

  private backoffMs(attempt: number): number {
    return Math.min(1000 * Math.pow(2, attempt), 60_000);
  }
}
