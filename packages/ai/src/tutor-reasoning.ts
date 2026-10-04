/**
 * Tutor Reasoning Engine — core intelligence loop for hypothesis tracking,
 * decision auditing, strategy memory, and clarification generation.
 */

import { ReasoningRepository } from "./repositories/index.js";
import type {
  Hypothesis,
  HypothesisStatus,
  TutorDecisionRecord,
  DecisionVerdict,
  TutorExperienceRecord,
} from "./contracts.js";

/* ------------------------------------------------------------------ */
/* Hypothesis Engine                                                    */
/* ------------------------------------------------------------------ */

export async function generateHypothesis(
  repo: ReasoningRepository,
  userId: string,
  subject: string,
  statement: string,
  confidence: number,
  alternatives: string[],
): Promise<Hypothesis> {
  const { id } = await repo.insertHypothesis({
    userId,
    subject,
    statement,
    confidence,
    alternatives,
    supportingEvidence: [],
    contradictingEvidence: [],
    status: "ACTIVE",
  });
  const row = await repo.findHypothesisById(id);
  return row!;
}

export async function updateHypothesis(
  repo: ReasoningRepository,
  hypothesisId: string,
  evidenceId: string,
  supports: boolean,
): Promise<Hypothesis> {
  const existing = await repo.findHypothesisById(hypothesisId);

  if (!existing) {
    throw new Error(`Hypothesis ${hypothesisId} not found`);
  }

  const supporting = existing.supportingEvidence as string[];
  const contradicting = existing.contradictingEvidence as string[];

  const updatedSupporting = supports
    ? [...new Set([...supporting, evidenceId])]
    : supporting;
  const updatedContradicting = !supports
    ? [...new Set([...contradicting, evidenceId])]
    : contradicting;

  const totalEvidence = updatedSupporting.length + updatedContradicting.length;
  const prevConfidence = existing.confidence as number;
  const supportRatio = totalEvidence > 0 ? updatedSupporting.length / totalEvidence : prevConfidence;

  const newConfidence = Math.max(0.01, Math.min(0.99, supportRatio));

  let newStatus: HypothesisStatus = existing.status as HypothesisStatus;
  if (newConfidence >= 0.8 && totalEvidence >= 2) {
    newStatus = "CONFIRMED";
  } else if (newConfidence <= 0.2 && totalEvidence >= 2) {
    newStatus = "DISPROVEN";
  } else if (newConfidence < prevConfidence && totalEvidence >= 2) {
    newStatus = "WEAKENED";
  }

  await repo.updateHypothesis(hypothesisId, {
    supportingEvidence: updatedSupporting,
    contradictingEvidence: updatedContradicting,
    confidence: newConfidence,
    status: newStatus,
  });

  const updated = await repo.findHypothesisById(hypothesisId);
  return updated!;
}

export async function getActiveHypotheses(
  repo: ReasoningRepository,
  userId: string,
): Promise<Hypothesis[]> {
  return repo.findActiveHypotheses(userId);
}

export async function supersedeHypothesis(
  repo: ReasoningRepository,
  oldHypothesisId: string,
  newStatement: string,
): Promise<Hypothesis> {
  const existing = await repo.findHypothesisById(oldHypothesisId);

  if (!existing) {
    throw new Error(`Hypothesis ${oldHypothesisId} not found`);
  }

  await repo.supersedeHypothesis(oldHypothesisId);

  const alternatives = (existing.alternatives as string[]).filter(
    (s) => s !== existing.statement,
  );

  const { id } = await repo.insertHypothesis({
    userId: existing.userId as string,
    subject: existing.subject as string,
    statement: newStatement,
    confidence: existing.confidence as number,
    alternatives: [...alternatives, existing.statement as string],
    supportingEvidence: existing.supportingEvidence as string[],
    contradictingEvidence: existing.contradictingEvidence as string[],
    status: "ACTIVE",
  });

  const newHypothesis = await repo.findHypothesisById(id);
  return newHypothesis!;
}

export async function evaluateHypothesis(
  repo: ReasoningRepository,
  hypothesisId: string,
): Promise<Hypothesis> {
  const existing = await repo.findHypothesisById(hypothesisId);

  if (!existing) {
    throw new Error(`Hypothesis ${hypothesisId} not found`);
  }

  const supporting = existing.supportingEvidence as string[];
  const contradicting = existing.contradictingEvidence as string[];
  const totalEvidence = supporting.length + contradicting.length;

  if (totalEvidence === 0) return existing!;

  const supportRatio = supporting.length / totalEvidence;
  const newConfidence = Math.max(0.01, Math.min(0.99, supportRatio));
  const prevConfidence = existing.confidence as number;

  let newStatus: HypothesisStatus = "ACTIVE";
  if (newConfidence >= 0.8 && totalEvidence >= 2) {
    newStatus = "CONFIRMED";
  } else if (newConfidence <= 0.2 && totalEvidence >= 2) {
    newStatus = "DISPROVEN";
  } else if (newConfidence < prevConfidence) {
    newStatus = "WEAKENED";
  } else {
    newStatus = "ACTIVE";
  }

  await repo.updateHypothesis(hypothesisId, {
    confidence: newConfidence,
    status: newStatus,
  });

  const updated = await repo.findHypothesisById(hypothesisId);
  return updated!;
}

/* ------------------------------------------------------------------ */
/* Decision Audit                                                       */
/* ------------------------------------------------------------------ */

export async function recordDecision(
  repo: ReasoningRepository,
  decision: Omit<TutorDecisionRecord, "id" | "createdAt">,
): Promise<TutorDecisionRecord> {
  return repo.insertDecision({
    userId: decision.userId,
    sessionId: decision.sessionId,
    selectedHypothesis: decision.selectedHypothesis ?? null,
    observations: decision.observations,
    hypotheses: decision.hypotheses,
    action: decision.action as string,
    confidence: decision.confidence,
    expectedOutcome: decision.expectedOutcome,
    riskLevel: decision.riskLevel ?? "low",
  });
}

export async function getDecisionsForSession(
  repo: ReasoningRepository,
  sessionId: string,
): Promise<TutorDecisionRecord[]> {
  return repo.findDecisionsBySession(sessionId);
}

export async function getDecisionsForUser(
  repo: ReasoningRepository,
  userId: string,
  opts?: { limit?: number },
): Promise<TutorDecisionRecord[]> {
  const limit = opts?.limit ?? 100;
  return repo.findDecisionsByUser(userId, limit);
}

export async function updateVerdict(
  repo: ReasoningRepository,
  decisionId: string,
  verdict: DecisionVerdict,
  actualOutcome?: string,
  correction?: string,
): Promise<void> {
  await repo.updateDecisionVerdict(decisionId, verdict, actualOutcome, correction);
}

/* ------------------------------------------------------------------ */
/* Strategy Memory                                                      */
/* ------------------------------------------------------------------ */

export async function recordStrategyOutcome(
  repo: ReasoningRepository,
  record: Omit<TutorExperienceRecord, "id" | "createdAt">,
): Promise<TutorExperienceRecord> {
  return repo.insertExperience({
    concept: record.concept,
    learnerProblem: record.learnerProblem,
    strategy: record.strategy,
    outcome: record.outcome,
    context: record.context,
    evidenceRefs: record.evidenceRefs,
  });
}

export async function getStrategyHistory(
  repo: ReasoningRepository,
  concept: string,
  learnerProblem?: string,
): Promise<TutorExperienceRecord[]> {
  return repo.findExperienceByConcept(concept, learnerProblem);
}

export async function getBestStrategies(
  repo: ReasoningRepository,
  concept: string,
  learnerState?: string,
): Promise<{ strategy: string; effectiveness: number }[]> {
  const rows = await repo.findExperienceForStrategy(concept, learnerState);

  const effectivenessMap = new Map<string, { effective: number; total: number }>();

  for (const row of rows) {
    const existing = effectivenessMap.get(row.strategy) ?? { effective: 0, total: 0 };
    existing.total += 1;
    if (row.outcome === "effective") existing.effective += 1;
    effectivenessMap.set(row.strategy, existing);
  }

  const results: { strategy: string; effectiveness: number }[] = [];
  for (const [strategy, stats] of effectivenessMap) {
    results.push({
      strategy,
      effectiveness: stats.total > 0 ? stats.effective / stats.total : 0,
    });
  }

  results.sort((a, b) => b.effectiveness - a.effectiveness);
  return results;
}

/* ------------------------------------------------------------------ */
/* Clarification Engine                                                 */
/* ------------------------------------------------------------------ */

export async function needsClarification(
  repo: ReasoningRepository,
  userId: string,
): Promise<{ needed: boolean; topHypothesis?: Hypothesis; alternative?: Hypothesis }> {
  const hypotheses = await getActiveHypotheses(repo, userId);

  if (hypotheses.length < 2) {
    return { needed: false };
  }

  const top = hypotheses[0]!;
  const alt = hypotheses[1]!;
  const gap = top.confidence - alt.confidence;

  if (gap < 0.15) {
    return { needed: true, topHypothesis: top, alternative: alt };
  }

  return { needed: false };
}

export function generateClarificationQuestion(
  top: Hypothesis,
  alt: Hypothesis,
): string {
  return `To help me understand better: is it closer to "${top.statement}" (which I think at ${Math.round(top.confidence * 100)}% confidence), or "${alt.statement}" (which I think at ${Math.round(alt.confidence * 100)}% confidence)?`;
}
