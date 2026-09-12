/**
 * Multidimensional Learner Model — per-concept state tracking across 12
 * dimensions. Dimension updates are deterministic functions of evidence;
 * AI interpretations live in hypotheses, not here.
 */

import type { DB } from "@cpd/core";
import type {
  LearnerDimension,
  DimensionValue,
  LearnerSnapshot,
  EvidenceEvent,
} from "./contracts.js";
import type { LearnerDimensionRepository } from "./repositories/learner-dimension-repository.js";

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const ALL_DIMENSIONS: LearnerDimension[] = [
  "conceptual_understanding",
  "procedural_skill",
  "implementation_skill",
  "problem_recognition",
  "reasoning",
  "explanation_ability",
  "debugging_skill",
  "transfer_ability",
  "retention",
  "independence",
  "hint_dependency",
  "confidence",
];

/** Default confidence when a dimension has no evidence yet. */
const DEFAULT_CONFIDENCE = 0;

/** Learning rate: how quickly a dimension moves toward the evidence signal. */
const ALPHA = 0.3;

/** Independence dimension weights (evidence type → weight). */
const INDEPENDENCE_WEIGHTS: Partial<
  Record<EvidenceEvent["type"], number>
> = {
  CODE_SUBMISSION: 0.25,
  SELF_CORRECTION: 0.20,
  ANSWER: 0.15,
  EXPLANATION: 0.10,
  HINT_REQUEST: -0.15,
  CONFIDENCE_STATEMENT: 0.05,
  EXERCISE_RESULT: 0.10,
};

/* ------------------------------------------------------------------ */
/* Internal helpers                                                    */
/* ------------------------------------------------------------------ */

export function clamp(v: number, lo = 0, hi = 1): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * EMA-style update: new = old + α × (target − old).
 * Returns [newValue, newConfidence].
 */
export function emaUpdate(
  current: number,
  currentConfidence: number,
  target: number,
  signalStrength: number
): [number, number] {
  const weight = ALPHA * signalStrength;
  const newValue = clamp(current + weight * (target - current));
  const newConfidence = clamp(
    currentConfidence + weight * (1 - currentConfidence)
  );
  return [newValue, newConfidence];
}

/* ------------------------------------------------------------------ */
/* Dimension update mappings                                           */
/* ------------------------------------------------------------------ */

interface DimensionDelta {
  dimension: LearnerDimension;
  target: number;
  confidence: number;
}

export function mapEvidenceToDimensions(
  event: EvidenceEvent,
  current: Map<LearnerDimension, DimensionValue>
): DimensionDelta[] {
  const deltas: DimensionDelta[] = [];
  const result = event.result;

  switch (event.type) {
    case "CODE_SUBMISSION": {
      const target = result === "correct" ? 0.9 : result === "partial" ? 0.5 : 0.2;
      deltas.push({ dimension: "implementation_skill", target, confidence: 0.7 });
      if (result === "correct") {
        deltas.push({ dimension: "procedural_skill", target: 0.75, confidence: 0.5 });
      }
      break;
    }
    case "ANSWER": {
      const target = result === "correct" ? 0.85 : result === "partial" ? 0.5 : 0.15;
      deltas.push({ dimension: "conceptual_understanding", target, confidence: 0.7 });
      break;
    }
    case "EXERCISE_RESULT": {
      const target = result === "correct" ? 0.8 : result === "partial" ? 0.5 : 0.2;
      deltas.push({ dimension: "procedural_skill", target, confidence: 0.6 });
      break;
    }
    case "CODE_EXECUTION": {
      const target = result === "correct" ? 0.85 : 0.25;
      deltas.push({ dimension: "implementation_skill", target, confidence: 0.6 });
      break;
    }
    case "EXPLANATION": {
      const target = result === "correct" ? 0.9 : result === "partial" ? 0.55 : 0.2;
      deltas.push({ dimension: "explanation_ability", target, confidence: 0.65 });
      break;
    }
    case "HINT_REQUEST": {
      const hintCount = (event.payload.hintsUsed as number) ?? 1;
      const hintFactor = clamp(1 - hintCount * 0.15);
      deltas.push({
        dimension: "hint_dependency",
        target: 1 - hintFactor,
        confidence: 0.6,
      });
      break;
    }
    case "SELF_CORRECTION": {
      const target = result === "correct" ? 0.85 : 0.4;
      deltas.push({ dimension: "reasoning", target, confidence: 0.6 });
      break;
    }
    case "CONFIDENCE_STATEMENT": {
      const stated = (event.payload.confidence as number) ?? 0.5;
      deltas.push({ dimension: "confidence", target: clamp(stated), confidence: 0.5 });
      break;
    }
    case "SESSION_BEHAVIOR": {
      const tracingOrPrediction =
        event.payload.contentKind === "TRACING" ||
        event.payload.contentKind === "PREDICTION";
      if (tracingOrPrediction) {
        const target = result === "correct" ? 0.85 : 0.3;
        deltas.push({ dimension: "problem_recognition", target, confidence: 0.6 });
      }
      break;
    }
    case "ERROR": {
      deltas.push({ dimension: "debugging_skill", target: 0.3, confidence: 0.4 });
      break;
    }
    case "LEARNER_CLAIM": {
      const target = result === "correct" ? 0.8 : 0.3;
      deltas.push({ dimension: "reasoning", target, confidence: 0.5 });
      break;
    }
  }

  return deltas;
}

export function computeIndependence(
  evidence: EvidenceEvent[],
  current: Map<LearnerDimension, DimensionValue>
): DimensionDelta {
  let weightedSum = 0;
  let totalWeight = 0;

  for (const ev of evidence) {
    const w = INDEPENDENCE_WEIGHTS[ev.type] ?? 0;
    if (w === 0) continue;
    weightedSum += w;
    totalWeight += Math.abs(w);
  }

  const hintDep = current.get("hint_dependency")?.value ?? 0;
  const baseIndependence = 1 - hintDep;

  if (totalWeight === 0) {
    return { dimension: "independence", target: baseIndependence, confidence: 0.3 };
  }

  const signal = clamp(0.5 + weightedSum);
  const target = clamp(baseIndependence * 0.4 + signal * 0.6);
  return { dimension: "independence", target, confidence: 0.5 };
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Build a learner snapshot from the database for all concepts.
 * Returns an aggregate across all nodes.
 */
export async function getLearnerModel(
  repo: LearnerDimensionRepository,
  userId: string
): Promise<LearnerSnapshot> {
  const rows = await repo.findByUserId(userId);

  const dimensionMap = new Map<LearnerDimension, {
    totalValue: number;
    totalConfidence: number;
    count: number;
    allEvidenceRefs: string[];
    lastUpdated: Date;
  }>();

  for (const row of rows) {
    const dim = row.dimension as LearnerDimension;
    const existing = dimensionMap.get(dim);
    const updatedAt = row.updatedAt instanceof Date
      ? row.updatedAt
      : new Date(row.updatedAt);

    if (existing) {
      existing.totalValue += row.value;
      existing.totalConfidence += row.confidence;
      existing.count += 1;
      existing.allEvidenceRefs.push(...(row.evidenceRefs ?? []));
      if (updatedAt > existing.lastUpdated) {
        existing.lastUpdated = updatedAt;
      }
    } else {
      dimensionMap.set(dim, {
        totalValue: row.value,
        totalConfidence: row.confidence,
        count: 1,
        allEvidenceRefs: [...(row.evidenceRefs ?? [])],
        lastUpdated: updatedAt,
      });
    }
  }

  const dimensions: DimensionValue[] = [];
  let overallSum = 0;

  for (const dim of ALL_DIMENSIONS) {
    const entry = dimensionMap.get(dim);
    if (entry) {
      const avgValue = entry.totalValue / entry.count;
      const avgConfidence = entry.totalConfidence / entry.count;
      dimensions.push({
        dimension: dim,
        value: avgValue,
        confidence: avgConfidence,
        evidenceRefs: [...new Set(entry.allEvidenceRefs)],
        lastUpdated: entry.lastUpdated,
      });
      overallSum += avgValue;
    } else {
      dimensions.push({
        dimension: dim,
        value: 0,
        confidence: DEFAULT_CONFIDENCE,
        evidenceRefs: [],
        lastUpdated: new Date(0),
      });
    }
  }

  return {
    userId,
    dimensions,
    overallMastery: overallSum / ALL_DIMENSIONS.length,
    lastUpdated: dimensions.reduce(
      (latest, d) => (d.lastUpdated > latest ? d.lastUpdated : latest),
      new Date(0)
    ),
  };
}

/**
 * Apply a batch of evidence events to the learner model.
 * Each event updates the relevant dimensions deterministically.
 */
export async function applyEvidence(
  db: DB,
  repo: LearnerDimensionRepository,
  userId: string,
  nodeId: string,
  evidence: EvidenceEvent[]
): Promise<void> {
  if (evidence.length === 0) return;

  await db.transaction(async (tx) => {
    const lockedRows = await repo.findForUpdate(userId, nodeId, tx);

    const current = new Map<LearnerDimension, DimensionValue>();
    for (const row of lockedRows) {
      const dim = row.dimension as LearnerDimension;
      current.set(dim, {
        dimension: dim,
        value: row.value,
        confidence: row.confidence,
        evidenceRefs: (row.evidenceRefs as string[]) ?? [],
        lastUpdated: row.updatedAt instanceof Date
          ? row.updatedAt
          : new Date(row.updatedAt),
      });
    }

    const pendingUpdates = new Map<
      string,
      { dimension: LearnerDimension; value: number; confidence: number; evidenceIds: string[] }
    >();

    function queueUpdate(dim: LearnerDimension, newValue: number, newConf: number, evidenceId: string) {
      const key = dim;
      const existing = pendingUpdates.get(key);
      if (existing) {
        existing.value = newValue;
        existing.confidence = newConf;
        existing.evidenceIds.push(evidenceId);
      } else {
        pendingUpdates.set(key, {
          dimension: dim,
          value: newValue,
          confidence: newConf,
          evidenceIds: [evidenceId],
        });
      }
    }

    for (const event of evidence) {
      const deltas = mapEvidenceToDimensions(event, current);

      for (const delta of deltas) {
        const cur = current.get(delta.dimension) ?? {
          value: 0,
          confidence: DEFAULT_CONFIDENCE,
          evidenceRefs: [],
          lastUpdated: new Date(0),
        };
        const [newVal, newConf] = emaUpdate(
          cur.value,
          cur.confidence,
          delta.target,
          delta.confidence
        );
        queueUpdate(delta.dimension, newVal, newConf, event.id);
        current.set(delta.dimension, {
          dimension: delta.dimension,
          value: newVal,
          confidence: newConf,
          evidenceRefs: cur.evidenceRefs,
          lastUpdated: new Date(),
        });
      }
    }

    const indDelta = computeIndependence(evidence, current);
    {
      const cur = current.get("independence") ?? {
        value: 0,
        confidence: DEFAULT_CONFIDENCE,
        evidenceRefs: [],
        lastUpdated: new Date(0),
      };
      const [newVal, newConf] = emaUpdate(
        cur.value,
        cur.confidence,
        indDelta.target,
        indDelta.confidence
      );
      queueUpdate("independence", newVal, newConf, evidence[0]!.id);
      current.set("independence", {
        dimension: "independence",
        value: newVal,
        confidence: newConf,
        evidenceRefs: cur.evidenceRefs,
        lastUpdated: new Date(),
      });
    }

    for (const [dim, update] of pendingUpdates) {
      const cur = current.get(dim as LearnerDimension);
      await repo.upsert(
        userId,
        nodeId,
        update.dimension,
        update.value,
        update.confidence,
        cur?.evidenceRefs ?? update.evidenceIds,
        tx,
      );
    }
  });
}

/**
 * Get all dimensions for a specific concept node.
 */
export async function getDimensions(
  repo: LearnerDimensionRepository,
  userId: string,
  nodeId: string
): Promise<DimensionValue[]> {
  const rows = await repo.findByUserAndNode(userId, nodeId);

  const present = new Map<string, DimensionValue>();
  for (const row of rows) {
    present.set(row.dimension, {
      dimension: row.dimension as LearnerDimension,
      value: row.value,
      confidence: row.confidence,
      evidenceRefs: (row.evidenceRefs as string[]) ?? [],
      lastUpdated: row.updatedAt instanceof Date
        ? row.updatedAt
        : new Date(row.updatedAt),
    });
  }

  return ALL_DIMENSIONS.map((dim) => {
    const existing = present.get(dim);
    return (
      existing ?? {
        dimension: dim,
        value: 0,
        confidence: DEFAULT_CONFIDENCE,
        evidenceRefs: [],
        lastUpdated: new Date(0),
      }
    );
  });
}

/**
 * Update a single dimension for a user/concept pair.
 */
export async function updateDimension(
  repo: LearnerDimensionRepository,
  userId: string,
  nodeId: string,
  dimension: LearnerDimension,
  value: number,
  confidence: number,
  evidenceId: string
): Promise<void> {
  const existing = await repo.findOne(userId, nodeId, dimension);

  const prevValue = existing?.value ?? 0;
  const prevConfidence = existing?.confidence ?? DEFAULT_CONFIDENCE;
  const prevRefs = ((existing?.evidenceRefs as string[]) ?? []) as string[];

  const [newValue, newConfidence] = emaUpdate(
    prevValue,
    prevConfidence,
    value,
    confidence
  );

  const mergedRefs = [...new Set([...prevRefs, evidenceId])];

  await repo.upsert(
    userId,
    nodeId,
    dimension,
    newValue,
    newConfidence,
    mergedRefs,
  );
}
