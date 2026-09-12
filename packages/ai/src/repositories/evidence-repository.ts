/**
 * Evidence Repository — encapsulates all evidence-event DB queries.
 *
 * Extracts query logic from evidence.ts into a reusable, testable class
 * that participates in the DI container.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { evidenceEvents, type DB } from "@cpd/core";
import type { EvidenceEvent, EvidenceType } from "../contracts.js";

type EvidenceInsert = Omit<EvidenceEvent, "id" | "observedAt">;

export class EvidenceRepository {
  constructor(private readonly db: DB) {}

  /** Record a single evidence event; returns the row with generated id + observedAt. */
  async record(event: EvidenceInsert): Promise<EvidenceEvent> {
    const [row] = await this.db.insert(evidenceEvents).values(event).returning();
    return row as EvidenceEvent;
  }

  /** Record multiple evidence events in one statement. */
  async recordBulk(events: EvidenceInsert[]): Promise<EvidenceEvent[]> {
    if (events.length === 0) return [];
    return this.db
      .insert(evidenceEvents)
      .values(events)
      .returning() as Promise<EvidenceEvent[]>;
  }

  /** Get all evidence for a given session, ordered by recency. */
  async findBySession(sessionId: string): Promise<EvidenceEvent[]> {
    return this.db
      .select({
        id: evidenceEvents.id,
        userId: evidenceEvents.userId,
        sessionId: evidenceEvents.sessionId,
        type: evidenceEvents.type,
        concept: evidenceEvents.concept,
        result: evidenceEvents.result,
        source: evidenceEvents.source,
        payload: evidenceEvents.payload,
        observedAt: evidenceEvents.observedAt,
      })
      .from(evidenceEvents)
      .where(eq(evidenceEvents.sessionId, sessionId))
      .orderBy(desc(evidenceEvents.observedAt))
      .limit(10000) as Promise<EvidenceEvent[]>;
  }

  /** Get evidence for a user with optional concept / date / limit filters. */
  async findByUser(
    userId: string,
    opts?: { concept?: string; since?: Date; limit?: number },
  ): Promise<EvidenceEvent[]> {
    const conditions = [eq(evidenceEvents.userId, userId)];
    if (opts?.concept) conditions.push(eq(evidenceEvents.concept, opts.concept));
    if (opts?.since) conditions.push(sql`${evidenceEvents.observedAt} >= ${opts.since}`);

    return this.db
      .select({
        id: evidenceEvents.id,
        userId: evidenceEvents.userId,
        sessionId: evidenceEvents.sessionId,
        type: evidenceEvents.type,
        concept: evidenceEvents.concept,
        result: evidenceEvents.result,
        source: evidenceEvents.source,
        payload: evidenceEvents.payload,
        observedAt: evidenceEvents.observedAt,
      })
      .from(evidenceEvents)
      .where(and(...conditions))
      .orderBy(desc(evidenceEvents.observedAt))
      .limit(opts?.limit ?? 10000) as Promise<EvidenceEvent[]>;
  }

  /** Get evidence for a user filtered by type, with optional date / limit filters. */
  async findByType(
    userId: string,
    type: EvidenceType,
    opts?: { since?: Date; limit?: number },
  ): Promise<EvidenceEvent[]> {
    const conditions = [
      eq(evidenceEvents.userId, userId),
      eq(evidenceEvents.type, type),
    ];
    if (opts?.since) conditions.push(sql`${evidenceEvents.observedAt} >= ${opts.since}`);

    return this.db
      .select({
        id: evidenceEvents.id,
        userId: evidenceEvents.userId,
        sessionId: evidenceEvents.sessionId,
        type: evidenceEvents.type,
        concept: evidenceEvents.concept,
        result: evidenceEvents.result,
        source: evidenceEvents.source,
        payload: evidenceEvents.payload,
        observedAt: evidenceEvents.observedAt,
      })
      .from(evidenceEvents)
      .where(and(...conditions))
      .orderBy(desc(evidenceEvents.observedAt))
      .limit(opts?.limit ?? 10000) as Promise<EvidenceEvent[]>;
  }

  /** Get evidence for a specific user + concept, ordered by recency. */
  async findByConcept(userId: string, concept: string): Promise<EvidenceEvent[]> {
    return this.db
      .select({
        id: evidenceEvents.id,
        userId: evidenceEvents.userId,
        sessionId: evidenceEvents.sessionId,
        type: evidenceEvents.type,
        concept: evidenceEvents.concept,
        result: evidenceEvents.result,
        source: evidenceEvents.source,
        payload: evidenceEvents.payload,
        observedAt: evidenceEvents.observedAt,
      })
      .from(evidenceEvents)
      .where(and(eq(evidenceEvents.userId, userId), eq(evidenceEvents.concept, concept)))
      .orderBy(desc(evidenceEvents.observedAt))
      .limit(10000) as Promise<EvidenceEvent[]>;
  }
}
