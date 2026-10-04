/**
 * Content Repository — encapsulates all content_items and content_reviews queries.
 */

import { and, asc, count, eq, lte, sql } from "drizzle-orm";
import { contentItems, contentReviews, type ContentPayload, type ContentValidation, type DB } from "@cpd/core";

export type ContentSource = "AI_GENERATED" | "TEMPLATE";
export type ContentStatus = "DRAFT" | "VALIDATED" | "RETIRED";

export class ContentRepository {
  constructor(private readonly db: DB) {}

  async retrieveBest(
    nodeId: string,
    kind: string,
    difficulty: number,
    allowAnyDifficulty = false,
  ): Promise<typeof contentItems.$inferSelect | null> {
    const conds = [
      eq(contentItems.nodeId, nodeId),
      eq(contentItems.kind, kind as never),
      eq(contentItems.status, "VALIDATED"),
    ];
    if (!allowAnyDifficulty) {
      conds.push(lte(contentItems.difficulty, difficulty + 1));
    }
    const rows = await this.db
      .select()
      .from(contentItems)
      .where(and(...conds))
      .orderBy(
        asc(contentItems.usageCount),
        asc(sql`abs(${contentItems.difficulty} - ${difficulty})`),
      )
      .limit(5);
    return rows[0] ?? null;
  }

  async incrementUsage(id: string): Promise<void> {
    await this.db
      .update(contentItems)
      .set({ usageCount: sql`${contentItems.usageCount} + 1` })
      .where(eq(contentItems.id, id));
  }

  async insert(item: {
    nodeId: string;
    kind: string;
    title: string;
    difficulty: number;
    estMinutes: number;
    payload: ContentPayload;
    source: string;
    status: string;
    validation: ContentValidation;
    generatedBy: string;
    usageCount: number;
  }): Promise<typeof contentItems.$inferSelect> {
    const [row] = await this.db
      .insert(contentItems)
      .values({
        ...item,
        kind: item.kind as "LESSON" | "CODING" | "DEBUGGING" | "CONCEPTUAL" | "TRACING" | "PREDICTION" | "ASSESSMENT" | "REAL_WORLD" | "PROJECT",
        source: item.source as "AI_GENERATED" | "TEMPLATE",
        status: item.status as "DRAFT" | "VALIDATED" | "RETIRED",
      })
      .returning();
    return row!;
  }

  async countForNode(nodeId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(contentItems)
      .where(and(eq(contentItems.nodeId, nodeId), sql`${contentItems.status} != 'RETIRED'`));
    return row?.n ?? 0;
  }

  async getMaxReviewVersion(contentId: string): Promise<number> {
    const rows = await this.db
      .select({ maxVersion: sql<number>`coalesce(max(${contentReviews.version}), 0)` })
      .from(contentReviews)
      .where(eq(contentReviews.contentId, contentId));
    return rows[0]?.maxVersion ?? 0;
  }

  async insertReview(review: {
    contentId: string;
    version: number;
    reviewType: string;
    passed: boolean;
    issues: unknown[];
    reviewer: string;
    reviewerModel: string;
    promptVersion: string;
  }): Promise<void> {
    await this.db.insert(contentReviews).values(review);
  }

  /**
   * Supersede an existing content item by marking it as replaced.
   * Returns the new item with version = old.version + 1.
   */
  async supersede(
    oldItemId: string,
    newItem: {
      nodeId: string;
      kind: string;
      title: string;
      difficulty: number;
      estMinutes: number;
      payload: ContentPayload;
      source: string;
      status: string;
      validation: ContentValidation;
      generatedBy: string;
      usageCount: number;
    },
  ): Promise<typeof contentItems.$inferSelect> {
    // Get old item to inherit version
    const [oldItem] = await this.db
      .select()
      .from(contentItems)
      .where(eq(contentItems.id, oldItemId));

    const newVersion = (oldItem?.version ?? 0) + 1;

    // Insert new version
    const [row] = await this.db
      .insert(contentItems)
      .values({
        ...newItem,
        nodeId: newItem.nodeId,
        kind: newItem.kind as "LESSON" | "CODING" | "DEBUGGING" | "CONCEPTUAL" | "TRACING" | "PREDICTION" | "ASSESSMENT" | "REAL_WORLD" | "PROJECT",
        source: newItem.source as "AI_GENERATED" | "TEMPLATE",
        status: newItem.status as "DRAFT" | "VALIDATED" | "RETIRED",
        version: newVersion,
      })
      .returning();

    // Mark old item as superseded
    await this.db
      .update(contentItems)
      .set({ supersededBy: row!.id, status: "RETIRED" })
      .where(eq(contentItems.id, oldItemId));

    return row!;
  }

  /**
   * Get the version history for a content item (same nodeId + kind).
   */
  async getVersionHistory(
    nodeId: string,
    kind: string,
  ): Promise<typeof contentItems.$inferSelect[]> {
    return this.db
      .select()
      .from(contentItems)
      .where(
        and(
          eq(contentItems.nodeId, nodeId),
          eq(contentItems.kind, kind as never),
        ),
      )
      .orderBy(sql`${contentItems.version} DESC`);
  }

  /**
   * Mark an existing content item as superseded by another item.
   * Sets `supersededBy` on the old item and marks it as RETIRED.
   */
  async markSuperseded(
    oldContentId: string,
    newContentId: string,
  ): Promise<void> {
    await this.db
      .update(contentItems)
      .set({ supersededBy: newContentId, status: "RETIRED" })
      .where(eq(contentItems.id, oldContentId));
  }
}
