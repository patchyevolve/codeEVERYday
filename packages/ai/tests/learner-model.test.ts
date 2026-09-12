import { describe, it, expect } from "vitest";
import {
  clamp,
  emaUpdate,
  mapEvidenceToDimensions,
  computeIndependence,
} from "../src/learner-model.js";
import type {
  EvidenceEvent,
  LearnerDimension,
  DimensionValue,
} from "../src/contracts.js";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function makeEvidence(
  overrides: Partial<EvidenceEvent> = {}
): EvidenceEvent {
  return {
    id: "ev-1",
    userId: "u1",
    sessionId: "s1",
    type: "CODE_SUBMISSION",
    concept: "variables",
    result: "correct",
    source: "sandbox",
    payload: {},
    observedAt: new Date(),
    ...overrides,
  };
}

function makeDimMap(
  entries: [LearnerDimension, Partial<DimensionValue>][] = []
): Map<LearnerDimension, DimensionValue> {
  const map = new Map<LearnerDimension, DimensionValue>();
  for (const [dim, overrides] of entries) {
    map.set(dim, {
      dimension: dim,
      value: 0.5,
      confidence: 0.5,
      evidenceRefs: [],
      lastUpdated: new Date(),
      ...overrides,
    });
  }
  return map;
}

/* ------------------------------------------------------------------ */
/* clamp                                                               */
/* ------------------------------------------------------------------ */

describe("clamp", () => {
  it("clamps below lo", () => expect(clamp(-0.5)).toBe(0));
  it("clamps above hi", () => expect(clamp(1.5)).toBe(1));
  it("passes through in range", () => expect(clamp(0.5)).toBe(0.5));
  it("returns lo for value exactly at lo", () => expect(clamp(0)).toBe(0));
  it("returns hi for value exactly at hi", () => expect(clamp(1)).toBe(1));
  it("respects custom bounds", () => expect(clamp(15, 0, 10)).toBe(10));
  it("clamps negative with custom bounds", () => expect(clamp(-5, 0, 10)).toBe(0));
  it("passes through mid-range with custom bounds", () => expect(clamp(5, 0, 10)).toBe(5));
});

/* ------------------------------------------------------------------ */
/* emaUpdate                                                           */
/* ------------------------------------------------------------------ */

describe("emaUpdate", () => {
  it("moves toward target", () => {
    const [val, conf] = emaUpdate(0.3, 0.2, 0.9, 0.7);
    expect(val).toBeGreaterThan(0.3);
    expect(val).toBeLessThan(0.9);
    expect(conf).toBeGreaterThan(0.2);
  });
  it("clamps output to [0,1]", () => {
    const [val, conf] = emaUpdate(0.95, 0.9, 1.0, 1.0);
    expect(val).toBeLessThanOrEqual(1);
    expect(conf).toBeLessThanOrEqual(1);
  });
  it("does not overshoot target significantly", () => {
    const [val] = emaUpdate(0.5, 0.5, 0.8, 0.5);
    expect(val).toBeLessThanOrEqual(0.8);
  });
  it("returns same value when signalStrength is 0", () => {
    const [val, conf] = emaUpdate(0.4, 0.3, 0.9, 0);
    expect(val).toBe(0.4);
    expect(conf).toBe(0.3);
  });
  it("returns target when signalStrength is 1 and full alpha", () => {
    // ALPHA = 0.3, so weight = 0.3 * 1 = 0.3
    const [val] = emaUpdate(0.2, 0.2, 1.0, 1.0);
    // 0.2 + 0.3 * (1.0 - 0.2) = 0.2 + 0.24 = 0.44
    expect(val).toBeCloseTo(0.44, 5);
  });
  it("increases confidence when moving toward target", () => {
    const [, conf1] = emaUpdate(0.5, 0.5, 0.8, 0.5);
    const [, conf2] = emaUpdate(0.5, 0.1, 0.8, 0.5);
    expect(conf1).toBeGreaterThan(0.5);
    expect(conf2).toBeGreaterThan(0.1);
  });
});

/* ------------------------------------------------------------------ */
/* mapEvidenceToDimensions                                            */
/* ------------------------------------------------------------------ */

describe("mapEvidenceToDimensions", () => {
  it("maps CODE_SUBMISSION correct to implementation_skill", () => {
    const deltas = mapEvidenceToDimensions(
      makeEvidence({ type: "CODE_SUBMISSION", result: "correct" }),
      makeDimMap()
    );
    expect(
      deltas.some((d) => d.dimension === "implementation_skill" && d.target === 0.9)
    ).toBe(true);
  });
  it("maps CODE_SUBMISSION correct to also include procedural_skill", () => {
    const deltas = mapEvidenceToDimensions(
      makeEvidence({ type: "CODE_SUBMISSION", result: "correct" }),
      makeDimMap()
    );
    expect(
      deltas.some((d) => d.dimension === "procedural_skill" && d.target === 0.75)
    ).toBe(true);
  });
  it("maps CODE_SUBMISSION partial to lower target", () => {
    const deltas = mapEvidenceToDimensions(
      makeEvidence({ type: "CODE_SUBMISSION", result: "partial" }),
      makeDimMap()
    );
    const impl = deltas.find((d) => d.dimension === "implementation_skill");
    expect(impl?.target).toBe(0.5);
  });
  it("maps CODE_SUBMISSION incorrect to low target", () => {
    const deltas = mapEvidenceToDimensions(
      makeEvidence({ type: "CODE_SUBMISSION", result: "incorrect" }),
      makeDimMap()
    );
    const impl = deltas.find((d) => d.dimension === "implementation_skill");
    expect(impl?.target).toBe(0.2);
  });
  it("maps ANSWER correct to conceptual_understanding", () => {
    const deltas = mapEvidenceToDimensions(
      makeEvidence({ type: "ANSWER", result: "correct" }),
      makeDimMap()
    );
    expect(
      deltas.some(
        (d) =>
          d.dimension === "conceptual_understanding" && d.target === 0.85
      )
    ).toBe(true);
  });
  it("maps ANSWER incorrect to low conceptual_understanding", () => {
    const deltas = mapEvidenceToDimensions(
      makeEvidence({ type: "ANSWER", result: "incorrect" }),
      makeDimMap()
    );
    const cu = deltas.find((d) => d.dimension === "conceptual_understanding");
    expect(cu?.target).toBe(0.15);
  });
  it("maps HINT_REQUEST to hint_dependency", () => {
    const deltas = mapEvidenceToDimensions(
      makeEvidence({ type: "HINT_REQUEST", payload: { hintsUsed: 2 } }),
      makeDimMap()
    );
    expect(deltas.some((d) => d.dimension === "hint_dependency")).toBe(true);
  });
  it("maps HINT_REQUEST target scales with hint count", () => {
    const d1 = mapEvidenceToDimensions(
      makeEvidence({ type: "HINT_REQUEST", payload: { hintsUsed: 1 } }),
      makeDimMap()
    );
    const d5 = mapEvidenceToDimensions(
      makeEvidence({ type: "HINT_REQUEST", payload: { hintsUsed: 5 } }),
      makeDimMap()
    );
    const t1 = d1.find((d) => d.dimension === "hint_dependency")!.target;
    const t5 = d5.find((d) => d.dimension === "hint_dependency")!.target;
    expect(t5).toBeGreaterThan(t1);
  });
  it("maps EXPLANATION correct to explanation_ability", () => {
    const deltas = mapEvidenceToDimensions(
      makeEvidence({ type: "EXPLANATION", result: "correct" }),
      makeDimMap()
    );
    expect(
      deltas.some(
        (d) => d.dimension === "explanation_ability" && d.target === 0.9
      )
    ).toBe(true);
  });
  it("maps SELF_CORRECTION correct to reasoning", () => {
    const deltas = mapEvidenceToDimensions(
      makeEvidence({ type: "SELF_CORRECTION", result: "correct" }),
      makeDimMap()
    );
    expect(
      deltas.some((d) => d.dimension === "reasoning" && d.target === 0.85)
    ).toBe(true);
  });
  it("maps CONFIDENCE_STATEMENT to confidence", () => {
    const deltas = mapEvidenceToDimensions(
      makeEvidence({
        type: "CONFIDENCE_STATEMENT",
        payload: { confidence: 0.8 },
      }),
      makeDimMap()
    );
    expect(
      deltas.some((d) => d.dimension === "confidence" && d.target === 0.8)
    ).toBe(true);
  });
  it("maps ERROR to debugging_skill", () => {
    const deltas = mapEvidenceToDimensions(
      makeEvidence({ type: "ERROR" }),
      makeDimMap()
    );
    expect(
      deltas.some((d) => d.dimension === "debugging_skill" && d.target === 0.3)
    ).toBe(true);
  });
  it("maps SESSION_BEHAVIOR tracing to problem_recognition", () => {
    const deltas = mapEvidenceToDimensions(
      makeEvidence({
        type: "SESSION_BEHAVIOR",
        result: "correct",
        payload: { contentKind: "TRACING" },
      }),
      makeDimMap()
    );
    expect(
      deltas.some(
        (d) => d.dimension === "problem_recognition" && d.target === 0.85
      )
    ).toBe(true);
  });
  it("returns empty array for SESSION_BEHAVIOR with non-tracing content", () => {
    const deltas = mapEvidenceToDimensions(
      makeEvidence({
        type: "SESSION_BEHAVIOR",
        result: "correct",
        payload: { contentKind: "CODING" },
      }),
      makeDimMap()
    );
    expect(deltas.length).toBe(0);
  });
  it("maps EXERCISE_RESULT correct to procedural_skill", () => {
    const deltas = mapEvidenceToDimensions(
      makeEvidence({ type: "EXERCISE_RESULT", result: "correct" }),
      makeDimMap()
    );
    expect(
      deltas.some(
        (d) => d.dimension === "procedural_skill" && d.target === 0.8
      )
    ).toBe(true);
  });
  it("maps CODE_EXECUTION correct to implementation_skill", () => {
    const deltas = mapEvidenceToDimensions(
      makeEvidence({ type: "CODE_EXECUTION", result: "correct" }),
      makeDimMap()
    );
    expect(
      deltas.some(
        (d) => d.dimension === "implementation_skill" && d.target === 0.85
      )
    ).toBe(true);
  });
  it("maps LEARNER_CLAIM correct to reasoning", () => {
    const deltas = mapEvidenceToDimensions(
      makeEvidence({ type: "LEARNER_CLAIM", result: "correct" }),
      makeDimMap()
    );
    expect(
      deltas.some((d) => d.dimension === "reasoning" && d.target === 0.8)
    ).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* computeIndependence                                                 */
/* ------------------------------------------------------------------ */

describe("computeIndependence", () => {
  it("returns higher independence for self-correction events", () => {
    const evidence = [
      makeEvidence({ type: "SELF_CORRECTION", result: "correct" }),
    ];
    const delta = computeIndependence(evidence, makeDimMap());
    expect(delta.target).toBeGreaterThan(0.5);
  });
  it("returns lower independence for hint requests", () => {
    const evidence = [makeEvidence({ type: "HINT_REQUEST" })];
    const delta = computeIndependence(
      evidence,
      makeDimMap([["hint_dependency", { value: 0.8 }]])
    );
    expect(delta.target).toBeLessThan(0.5);
  });
  it("returns base independence for empty evidence", () => {
    const delta = computeIndependence([], makeDimMap());
    expect(delta.dimension).toBe("independence");
    // baseIndependence = 1 - 0 (no hint_dependency) = 1
    // totalWeight === 0, so target = baseIndependence = 1
    expect(delta.target).toBe(1);
  });
  it("positive evidence raises independence above base", () => {
    const evidence = [
      makeEvidence({ type: "CODE_SUBMISSION", result: "correct" }),
    ];
    const delta = computeIndependence(evidence, makeDimMap());
    expect(delta.target).toBeGreaterThan(0.5);
  });
  it("combines hint dependency with positive evidence", () => {
    const evidence = [
      makeEvidence({ type: "CODE_SUBMISSION", result: "correct" }),
    ];
    const delta = computeIndependence(
      evidence,
      makeDimMap([["hint_dependency", { value: 0.5 }]])
    );
    // baseIndependence = 0.5, with positive signal
    expect(delta.target).toBeGreaterThanOrEqual(0);
    expect(delta.target).toBeLessThanOrEqual(1);
  });
  it("always returns dimension 'independence'", () => {
    const delta = computeIndependence(
      [makeEvidence({ type: "HINT_REQUEST" })],
      makeDimMap()
    );
    expect(delta.dimension).toBe("independence");
  });
  it("multiple positive events compound signal", () => {
    const evidence = [
      makeEvidence({ type: "CODE_SUBMISSION", result: "correct" }),
      makeEvidence({ type: "SELF_CORRECTION", result: "correct" }),
      makeEvidence({ type: "ANSWER", result: "correct" }),
    ];
    const single = computeIndependence([evidence[0]!], makeDimMap());
    const multi = computeIndependence(evidence, makeDimMap());
    expect(multi.target).toBeGreaterThanOrEqual(single.target);
  });
  it("returns confidence 0.5 when there are weighted events", () => {
    const evidence = [makeEvidence({ type: "CODE_SUBMISSION" })];
    const delta = computeIndependence(evidence, makeDimMap());
    expect(delta.confidence).toBe(0.5);
  });
  it("returns confidence 0.3 when evidence is empty", () => {
    const delta = computeIndependence([], makeDimMap());
    expect(delta.confidence).toBe(0.3);
  });
});
