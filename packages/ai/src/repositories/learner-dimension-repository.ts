/**
 * LearnerDimensionRepository — encapsulates all learner_dimensions queries.
 *
 * Compound PK: (userId, nodeId, dimension).
 * The findForUpdate method uses raw SQL for SELECT ... FOR UPDATE
 * which must run inside a transaction.
 */

import { and, eq, sql } from "drizzle-orm";
import { learnerDimensions, type DB } from "@cpd/core";

export interface LearnerDimensionRow {
  [key: string]: unknown;
  dimension: string;
  value: number;
  confidence: number;
  evidenceRefs: string[];
  updatedAt: Date;
}

export class LearnerDimensionRepository {
  constructor(private readonly db: DB) {}

  /** All dimension rows for a user (across all concepts). */
  async findByUserId(userId: string): Promise<typeof learnerDimensions.$inferSelect[]> {
    return this.db
      .select()
      .from(learnerDimensions)
      .where(eq(learnerDimensions.userId, userId));
  }

  /** All dimensions for a specific user + concept node. */
  async findByUserAndNode(userId: string, nodeId: string): Promise<typeof learnerDimensions.$inferSelect[]> {
    return this.db
      .select()
      .from(learnerDimensions)
      .where(
        and(
          eq(learnerDimensions.userId, userId),
          eq(learnerDimensions.nodeId, nodeId),
        ),
      );
  }

  /**
   * SELECT ... FOR UPDATE — locks rows for the given user+node.
   * MUST be called inside a transaction (pass the tx client as `ctx`).
   */
  async findForUpdate(
    userId: string,
    nodeId: string,
    ctx: DB,
  ): Promise<LearnerDimensionRow[]> {
    const result = await ctx.execute<LearnerDimensionRow>(
      sql`SELECT dimension, value, confidence, "evidenceRefs", "updatedAt"
          FROM learner_dimensions
          WHERE "userId" = ${userId} AND "nodeId" = ${nodeId}
          FOR UPDATE`,
    );
    const rows = (result as { rows?: LearnerDimensionRow[] }).rows ?? (result as unknown as LearnerDimensionRow[]);
    return rows;
  }

  /** Read a single dimension row (for EMA update in updateDimension). */
  async findOne(
    userId: string,
    nodeId: string,
    dimension: string,
  ): Promise<typeof learnerDimensions.$inferSelect | null> {
    const [row] = await this.db
      .select()
      .from(learnerDimensions)
      .where(
        and(
          eq(learnerDimensions.userId, userId),
          eq(learnerDimensions.nodeId, nodeId),
          eq(learnerDimensions.dimension, dimension),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /**
   * Upsert a single dimension (insert or update on conflict).
   * Can optionally run inside a transaction (pass tx as `ctx`).
   */
  async upsert(
    userId: string,
    nodeId: string,
    dimension: string,
    value: number,
    confidence: number,
    evidenceRefs: string[],
    ctx?: DB,
  ): Promise<void> {
    const client = ctx ?? this.db;
    await client
      .insert(learnerDimensions)
      .values({
        userId,
        nodeId,
        dimension,
        value,
        confidence,
        evidenceRefs,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [learnerDimensions.userId, learnerDimensions.nodeId, learnerDimensions.dimension],
        set: {
          value,
          confidence,
          evidenceRefs,
          updatedAt: new Date(),
        },
      });
  }
}
