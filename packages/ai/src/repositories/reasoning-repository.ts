import { and, desc, eq, sql } from "drizzle-orm";
import {
  tutorHypotheses,
  tutorDecisions,
  tutorExperience,
  type DB,
} from "@cpd/core";
import type {
  Hypothesis,
  HypothesisStatus,
  TutorDecisionRecord,
  DecisionVerdict,
  TutorExperienceRecord,
  StrategyOutcome,
} from "../contracts.js";

export class ReasoningRepository {
  constructor(private readonly db: DB) {}

  /* ------------------------------------------------------------------ */
  /* Hypothesis queries                                                   */
  /* ------------------------------------------------------------------ */

  async insertHypothesis(values: {
    userId: string;
    subject: string;
    statement: string;
    confidence: number;
    alternatives: string[];
    supportingEvidence?: string[];
    contradictingEvidence?: string[];
    status?: HypothesisStatus;
  }): Promise<Hypothesis> {
    const [row] = await this.db
      .insert(tutorHypotheses)
      .values({
        ...values,
        supportingEvidence: values.supportingEvidence ?? [],
        contradictingEvidence: values.contradictingEvidence ?? [],
        status: (values.status ?? "ACTIVE") as never,
      })
      .returning();
    return row as Hypothesis;
  }

  async findHypothesisById(id: string): Promise<Hypothesis | null> {
    const [row] = await this.db
      .select()
      .from(tutorHypotheses)
      .where(eq(tutorHypotheses.id, id))
      .limit(1);
    return (row as Hypothesis) ?? null;
  }

  async updateHypothesis(
    id: string,
    values: {
      confidence?: number;
      status?: HypothesisStatus;
      supportingEvidence?: string[];
      contradictingEvidence?: string[];
    },
  ): Promise<Hypothesis> {
    const [row] = await this.db
      .update(tutorHypotheses)
      .set({ ...values, lastEvaluatedAt: new Date() })
      .where(eq(tutorHypotheses.id, id))
      .returning();
    return row as Hypothesis;
  }

  async findActiveHypotheses(userId: string): Promise<Hypothesis[]> {
    const rows = await this.db
      .select()
      .from(tutorHypotheses)
      .where(
        and(
          eq(tutorHypotheses.userId, userId),
          eq(tutorHypotheses.status, "ACTIVE"),
        ),
      )
      .orderBy(desc(tutorHypotheses.confidence));
    return rows as Hypothesis[];
  }

  async supersedeHypothesis(id: string): Promise<void> {
    await this.db
      .update(tutorHypotheses)
      .set({
        status: "SUPERSEDED",
        lastEvaluatedAt: new Date(),
        supportingEvidence: [],
        contradictingEvidence: [],
      })
      .where(eq(tutorHypotheses.id, id));
  }

  /* ------------------------------------------------------------------ */
  /* Decision queries                                                     */
  /* ------------------------------------------------------------------ */

  async insertDecision(values: {
    userId: string;
    sessionId: string;
    selectedHypothesis?: string | null;
    observations?: string[];
    hypotheses?: string[];
    action: string;
    confidence?: number;
    expectedOutcome?: string;
    riskLevel?: string;
  }): Promise<TutorDecisionRecord> {
    const [row] = await this.db
      .insert(tutorDecisions)
      .values({
        userId: values.userId,
        sessionId: values.sessionId,
        selectedHypothesis: values.selectedHypothesis ?? null,
        observations: values.observations ?? [],
        hypotheses: values.hypotheses ?? [],
        action: values.action,
        confidence: values.confidence ?? 0.5,
        expectedOutcome: values.expectedOutcome ?? null,
        riskLevel: values.riskLevel ?? "low",
      })
      .returning();
    return row as TutorDecisionRecord;
  }

  async findDecisionsBySession(sessionId: string): Promise<TutorDecisionRecord[]> {
    const rows = await this.db
      .select()
      .from(tutorDecisions)
      .where(eq(tutorDecisions.sessionId, sessionId))
      .orderBy(desc(tutorDecisions.createdAt));
    return rows as TutorDecisionRecord[];
  }

  async findDecisionsByUser(
    userId: string,
    limit = 100,
  ): Promise<TutorDecisionRecord[]> {
    const rows = await this.db
      .select()
      .from(tutorDecisions)
      .where(eq(tutorDecisions.userId, userId))
      .orderBy(desc(tutorDecisions.createdAt))
      .limit(limit);
    return rows as TutorDecisionRecord[];
  }

  async updateDecisionVerdict(
    id: string,
    verdict: DecisionVerdict,
    actualOutcome?: string,
    correction?: string,
  ): Promise<void> {
    await this.db
      .update(tutorDecisions)
      .set({ verdict, actualOutcome, correction })
      .where(eq(tutorDecisions.id, id));
  }

  /* ------------------------------------------------------------------ */
  /* Experience / Strategy queries                                         */
  /* ------------------------------------------------------------------ */

  async insertExperience(record: {
    concept: string;
    learnerProblem: string;
    strategy: string;
    outcome: StrategyOutcome;
    context: TutorExperienceRecord["context"];
    evidenceRefs: string[];
  }): Promise<TutorExperienceRecord> {
    const [row] = await this.db
      .insert(tutorExperience)
      .values(record)
      .returning();
    return row as TutorExperienceRecord;
  }

  async findExperienceByConcept(
    concept: string,
    learnerProblem?: string,
  ): Promise<TutorExperienceRecord[]> {
    const conditions = [eq(tutorExperience.concept, concept)];
    if (learnerProblem !== undefined) {
      conditions.push(eq(tutorExperience.learnerProblem, learnerProblem));
    }
    const rows = await this.db
      .select()
      .from(tutorExperience)
      .where(and(...conditions))
      .orderBy(desc(tutorExperience.createdAt));
    return rows as TutorExperienceRecord[];
  }

  async findDecisionsBySessionForReport(
    sessionId: string,
  ): Promise<
    {
      action: string;
      verdict: string;
      correction: string | null;
      confidence: number;
      selectedHypothesis: string | null;
    }[]
  > {
    return this.db
      .select({
        action: tutorDecisions.action,
        verdict: tutorDecisions.verdict,
        correction: tutorDecisions.correction,
        confidence: tutorDecisions.confidence,
        selectedHypothesis: tutorDecisions.selectedHypothesis,
      })
      .from(tutorDecisions)
      .where(eq(tutorDecisions.sessionId, sessionId));
  }

  async findExperienceForStrategy(
    concept: string,
    learnerState?: string,
  ): Promise<{ strategy: string; outcome: StrategyOutcome }[]> {
    const conditions = [eq(tutorExperience.concept, concept)];
    if (learnerState !== undefined) {
      conditions.push(
        sql`(${tutorExperience.context}->>'learnerState') = ${learnerState}`,
      );
    }
    return this.db
      .select({
        strategy: tutorExperience.strategy,
        outcome: tutorExperience.outcome,
      })
      .from(tutorExperience)
      .where(and(...conditions)) as Promise<{ strategy: string; outcome: StrategyOutcome }[]>;
  }
}
