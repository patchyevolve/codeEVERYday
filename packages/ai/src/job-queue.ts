/**
 * DB-backed Job Queue — lightweight alternative to pg-boss.
 *
 * Uses polling with PostgreSQL LISTEN/NOTIFY for wake-up. Jobs are
 * inserted into the `ai_jobs` table and processed by a background loop.
 *
 * Spec reference: docs/ai-subsystem-design.md §2 (Orchestrator.enqueue)
 */

import { and, eq, lte, sql } from "drizzle-orm";
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

  /** Process one batch of pending jobs (also callable manually). */
  async poll(): Promise<number> {
    if (this.processing) return 0;
    this.processing = true;

    let processed = 0;
    try {
      const pending = await this.db
        .select()
        .from(aiJobs)
        .where(
          and(
            eq(aiJobs.status, "QUEUED"),
            lte(aiJobs.runAfter, new Date()),
          ),
        )
        .orderBy(aiJobs.priority, aiJobs.createdAt)
        .limit(10);

      for (const row of pending) {
        const handler = this.handlers.get(row.jobType);
        if (!handler) {
          await this.db
            .update(aiJobs)
            .set({ status: "FAILED", error: `No handler for job type: ${row.jobType}`, updatedAt: new Date() })
            .where(eq(aiJobs.id, row.id));
          continue;
        }

        await this.db
          .update(aiJobs)
          .set({
            status: "RUNNING",
            startedAt: new Date(),
            attempts: row.attempts + 1,
            updatedAt: new Date(),
          })
          .where(eq(aiJobs.id, row.id));

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
          const newAttempts = row.attempts + 1;
          const failed = newAttempts >= row.maxAttempts;

          await this.db
            .update(aiJobs)
            .set({
              status: failed ? "FAILED" : "QUEUED",
              error: errorMsg,
              attempts: newAttempts,
              runAfter: failed
                ? new Date()
                : new Date(Date.now() + this.backoffMs(newAttempts)),
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
