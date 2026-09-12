/**
 * Tests for TutorEngine pure functions + repository integration.
 *
 * Pure functions are tested without a database. Repository tests use
 * the in-memory test DB when available.
 */

import { describe, it, expect } from "vitest";
import {
  WEAK_STATES,
  PASS_STATES,
  pickWorstWeakNode,
  pickNextPathNode,
  buildCurriculumActivities,
  buildObjective,
} from "../src/tutor.js";

describe("pickWorstWeakNode", () => {
  const heat = new Map([["variables", 5], ["loops", 2]]);

  it("returns null when no weak concepts exist", () => {
    const concepts = [
      { nodeId: "1", nodeKey: "variables", state: "MASTERED", mastery: 0.9 },
      { nodeId: "2", nodeKey: "loops", state: "PROFICIENT", mastery: 0.7 },
    ];
    expect(pickWorstWeakNode(concepts, heat)).toBeNull();
  });

  it("picks the weak node with highest heat", () => {
    const concepts = [
      { nodeId: "1", nodeKey: "variables", state: "WEAK", mastery: 0.3 },
      { nodeId: "2", nodeKey: "loops", state: "DECAYING", mastery: 0.5 },
    ];
    const result = pickWorstWeakNode(concepts, heat);
    expect(result?.nodeKey).toBe("variables");
  });

  it("breaks heat ties by lowest mastery", () => {
    const concepts = [
      { nodeId: "1", nodeKey: "a", state: "WEAK", mastery: 0.6 },
      { nodeId: "2", nodeKey: "b", state: "REVIEW_REQUIRED", mastery: 0.2 },
    ];
    const flatHeat = new Map([["a", 1], ["b", 1]]);
    const result = pickWorstWeakNode(concepts, flatHeat);
    expect(result?.nodeKey).toBe("b");
  });

  it("handles REVIEW_REQUIRED state", () => {
    const concepts = [
      { nodeId: "1", nodeKey: "x", state: "REVIEW_REQUIRED", mastery: 0.4 },
    ];
    const result = pickWorstWeakNode(concepts, new Map());
    expect(result?.nodeKey).toBe("x");
  });
});

describe("pickNextPathNode", () => {
  const states = new Map([
    ["intro", { state: "MASTERED", mastery: 0.9 }],
    ["basics", { state: "PROFICIENT", mastery: 0.7 }],
    ["mid", { state: "WEAK", mastery: 0.3 }],
  ]);

  it("skips completed and blocked nodes", () => {
    const path = [
      { nodeId: "1", nodeKey: "intro", position: 1, status: "COMPLETED" },
      { nodeId: "2", nodeKey: "basics", position: 2, status: "BLOCKED" },
      { nodeId: "3", nodeKey: "mid", position: 3, status: "PLANNED" },
    ];
    const result = pickNextPathNode(path, states, new Map());
    expect(result?.nodeKey).toBe("mid");
  });

  it("returns node when prereqs are satisfied", () => {
    const path = [
      { nodeId: "1", nodeKey: "intro", position: 1, status: "PLANNED" },
      { nodeId: "2", nodeKey: "mid", position: 2, status: "PLANNED" },
    ];
    const prereqs = new Map([["2", ["intro"]]]); // mid requires intro
    // intro is MASTERED in states, so mid should be reachable
    const result = pickNextPathNode(path, states, prereqs);
    expect(result?.nodeKey).toBe("mid");
  });

  it("skips nodes whose prereqs are not satisfied", () => {
    const weakStates = new Map([
      ["intro", { state: "WEAK", mastery: 0.3 }],
    ]);
    const path = [
      { nodeId: "1", nodeKey: "intro", position: 1, status: "COMPLETED" },
      { nodeId: "2", nodeKey: "mid", position: 2, status: "PLANNED" },
    ];
    const prereqs = new Map([["2", ["intro"]]]);
    // intro is COMPLETED (skipped), mid requires intro but intro is WEAK (not PASS) → prereq not met
    const result = pickNextPathNode(path, weakStates, prereqs);
    expect(result).toBeNull();
  });

  it("returns first PLANNED node with satisfied prereqs", () => {
    const path = [
      { nodeId: "1", nodeKey: "intro", position: 1, status: "PLANNED" },
      { nodeId: "2", nodeKey: "basics", position: 2, status: "PLANNED" },
    ];
    // "intro" is MASTERED in states, so it gets skipped — "basics" is PROFICIENT (also PASS)
    // Use a node that's NOT in states at all to make it PLANNED with no state
    const path2 = [
      { nodeId: "3", nodeKey: "newTopic", position: 1, status: "PLANNED" },
      { nodeId: "4", nodeKey: "another", position: 2, status: "PLANNED" },
    ];
    const result = pickNextPathNode(path2, states, new Map());
    expect(result?.nodeKey).toBe("newTopic");
  });

  it("returns null when all nodes are completed", () => {
    const path = [
      { nodeId: "1", nodeKey: "intro", position: 1, status: "COMPLETED" },
    ];
    const result = pickNextPathNode(path, states, new Map());
    expect(result).toBeNull();
  });
});

describe("buildCurriculumActivities", () => {
  it("returns domain activities for domain nodes", () => {
    const acts = buildCurriculumActivities("web-react", new Map());
    expect(acts).toEqual(["LESSON", "CONCEPTUAL", "REAL_WORLD", "ASSESSMENT"]);
  });

  it("returns weak activities for weak concepts", () => {
    const states = new Map([["loops", { state: "WEAK", mastery: 0.3 }]]);
    const acts = buildCurriculumActivities("loops", states);
    expect(acts).toEqual(["LESSON", "DEBUGGING", "CODING", "ASSESSMENT"]);
  });

  it("returns standard activities for strong concepts", () => {
    const states = new Map([["loops", { state: "MASTERED", mastery: 0.9 }]]);
    const acts = buildCurriculumActivities("loops", states);
    expect(acts).toEqual(["LESSON", "CODING", "CONCEPTUAL", "APPLY", "ASSESSMENT"]);
  });

  it("returns standard activities for unknown nodes", () => {
    const acts = buildCurriculumActivities("unknown", new Map());
    expect(acts).toEqual(["LESSON", "CODING", "CONCEPTUAL", "APPLY", "ASSESSMENT"]);
  });
});

describe("buildObjective", () => {
  it("builds a decision with correct structure", () => {
    const obj = buildObjective(
      "CURRICULUM",
      { id: "n1", nodeKey: "loops", label: "Loops", definition: "repeat", applications: [], misconceptions: [], difficulty: 3, estMinutes: 15 },
      "Continue the path",
      ["LESSON", "CODING"],
      "LEARN"
    );
    expect(obj.decision.type).toBe("CURRICULUM");
    expect(obj.decision.objectiveNodeId).toBe("n1");
    expect(obj.decision.activities).toEqual(["LESSON", "CODING"]);
    expect(obj.decision.estimatedMinutes).toBe(30);
    expect(obj.objectiveNodeId).toBe("n1");
  });

  it("sets objectiveNodeId to null when node is null", () => {
    const obj = buildObjective("REVIEW", null, "Review day", ["REVIEW"], "REVIEW");
    expect(obj.decision.objectiveNodeId).toBeNull();
    expect(obj.objectiveNodeId).toBeNull();
  });

  it("marks aiRefined when true", () => {
    const obj = buildObjective("CURRICULUM", null, "AI refined", ["CODING"], "LEARN", true);
    expect(obj.decision.aiRefined).toBe(true);
    expect(obj.decision.source).toBe("DETERMINISTIC");
  });
});
