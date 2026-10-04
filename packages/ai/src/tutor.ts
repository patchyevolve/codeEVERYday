import type { ExecutorLanguage } from "@cpd/core";
/**
 * Tutor Decision Engine + Session Composer.
 *
 * The tutor is the curriculum authority. It decides what the learner does
 * next based on the learner model, retention state, mistakes and curriculum
 * position — and it is allowed to say "no" to progression. Decisions are
 * deterministic (testable); AI is an optional refinement layer that can never
 * override persisted learning state.
 *
 * DB access is delegated to repositories. Pure decision functions are exported
 * for unit testing without a database.
 */

import {
  type LearnerProfile,
  type TutorDecision
} from "@cpd/core";
import { ContentService, type ContentKind } from "./content-service.js";
import type { ProfileExtras } from "./learner.js";
import { DOMAIN_FRONTIERS, isDomainNodeKey } from "./domain-builder.js";
import { NodeRepository, type NodeLite } from "./repositories/node-repository.js";
import { SessionRepository } from "./repositories/session-repository.js";
import { StreakRepository } from "./repositories/streak-repository.js";
import { UserRepository } from "./repositories/user-repository.js";

export interface Objective {
  decision: TutorDecision;
  objectiveNodeId: string | null;
}

export const WEAK_STATES = new Set(["WEAK", "REVIEW_REQUIRED", "DECAYING"]);
export const PASS_STATES = new Set(["PROFICIENT", "MASTERED"]);

/* ------------------------------------------------------------------ */
/* Pure decision functions (no DB, easy to test)                        */
/* ------------------------------------------------------------------ */

export function pickWorstWeakNode(
  concepts: { nodeId: string; nodeKey: string; state: string; mastery: number }[],
  heat: Map<string, number>
): { nodeId: string; nodeKey: string } | null {
  const weak = concepts.filter((c) => WEAK_STATES.has(c.state));
  if (weak.length === 0) return null;
  const sorted = [...weak].sort((a, b) => {
    const ha = heat.get(a.nodeKey) ?? 0;
    const hb = heat.get(b.nodeKey) ?? 0;
    return hb - ha || a.mastery - b.mastery;
  });
  return sorted[0]!;
}

export function pickNextPathNode(
  path: { nodeId: string; nodeKey: string; position: number; status: string }[],
  states: Map<string, { state: string; mastery: number }>,
  prereqMap: Map<string, string[]>
): { nodeId: string; nodeKey: string; position: number; status: string } | null {
  const ordered = [...path].sort((a, b) => a.position - b.position);

  // Forward: first PLANNED/ACTIVE node whose prereqs are satisfied
  for (const entry of ordered) {
    if (entry.status === "COMPLETED" || entry.status === "BLOCKED") continue;
    const own = states.get(entry.nodeKey);
    if (own && PASS_STATES.has(own.state)) continue;
    const prereqs = prereqMap.get(entry.nodeId) ?? [];
    const ready = prereqs.every((p) => {
      const st = states.get(p);
      return st ? PASS_STATES.has(st.state) : true;
    });
    if (ready) return entry;
  }

  // Backward move: an ACTIVE node has a weak prerequisite
  for (const entry of ordered) {
    if (entry.status !== "ACTIVE") continue;
    const prereqs = prereqMap.get(entry.nodeId) ?? [];
    const weakPrereqKey = prereqs.find((p) => {
      const st = states.get(p);
      return st ? WEAK_STATES.has(st.state) : false;
    });
    if (weakPrereqKey) {
      return { nodeId: "", nodeKey: weakPrereqKey, position: entry.position - 1, status: "PLANNED" };
    }
  }
  return null;
}

export function buildCurriculumActivities(
  nodeKey: string,
  states: Map<string, { state: string; mastery: number }>
): string[] {
  if (isDomainNodeKey(nodeKey)) return ["LESSON", "CONCEPTUAL", "REAL_WORLD", "ASSESSMENT"];
  const st = states.get(nodeKey);
  const weak = st ? WEAK_STATES.has(st.state) : false;
  return weak ? ["LESSON", "DEBUGGING", "CODING", "ASSESSMENT"] : ["LESSON", "CODING", "CONCEPTUAL", "APPLY", "ASSESSMENT"];
}

export function buildObjective(
  type: TutorDecision["type"],
  node: NodeLite | null,
  reason: string,
  activities: string[],
  mode: TutorDecision["mode"],
  aiRefined = false
): Objective {
  return {
    decision: {
      type,
      reason,
      objectiveNodeId: node?.id ?? null,
      mode,
      estimatedMinutes: activities.length * 15,
      activities,
      aiRefined,
      source: "DETERMINISTIC"
    },
    objectiveNodeId: node?.id ?? null
  };
}

/* ------------------------------------------------------------------ */
/* TutorEngine (facade over repositories + pure functions)              */
/* ------------------------------------------------------------------ */

export class TutorEngine {
  constructor(
    private content: ContentService,
    private nodes: NodeRepository,
    private sessions: SessionRepository,
    private users: UserRepository,
    private streaks: StreakRepository,
  ) {}

  /** Decide today's objective for a user. Reads state, writes nothing. */
  async decideObjective(userId: string, profile: LearnerProfile): Promise<Objective> {
    let path = await this.users.getPath(userId);
    const states = await this.users.getNodeStates(userId);
    const mastered = [...states.entries()].filter(([, s]) => PASS_STATES.has(s.state)).map(([k]) => k);
    const heat = await this.streaks.getMistakeHeat(userId);

    // 1. Recovery pending for today?
    const todayRecovery = await this.sessions.findTodayRecovery(userId, profile.todayLocal);
    if (todayRecovery && todayRecovery.status !== "COMPLETED") {
      const target = await this.worstWeakNode(userId, profile);
      return buildObjective(
        "RECOVERY",
        target,
        "Yesterday's session was missed. Today is a recovery session — no new material until weak concepts are reviewed.",
        ["REVIEW", "LESSON", "CODING", "ASSESSMENT"],
        "REMEDIATE"
      );
    }

    // 2. Weakness remediation (the tutor says "no" to new material)
    const worstWeak = await this.worstWeakNode(userId, profile);
    if (worstWeak) {
      const hasLesson = await this.sessions.hasServedKind(userId, worstWeak.id, "LESSON");
      const activities = hasLesson ? ["DEBUGGING", "CODING", "ASSESSMENT"] : ["LESSON", "DEBUGGING", "CODING", "ASSESSMENT"];
      return buildObjective(
        "REMEDIATION",
        worstWeak,
        `Repeated mistakes detected in ${worstWeak.label.toLowerCase()}. Normal progression is paused until the weakness is repaired.`,
        activities,
        "REMEDIATE"
      );
    }

    // 3. Early domain expansion
    const masteredNow = [...states.entries()].filter(([, s]) => PASS_STATES.has(s.state)).map(([k]) => k);
    const domains = await this.users.getGoals(userId);
    const languageLevel = masteredNow.length;
    if (languageLevel > 0 && domains.length > 0) {
      const entryLevel = Math.min(
        ...domains.flatMap((d) => (DOMAIN_FRONTIERS[d] ?? []).slice(0, 1)).map((n) => n.requiresLanguageLevel ?? 1)
      );
      const domainKeys = domains.flatMap((d) => DOMAIN_FRONTIERS[d] ?? []).map((n) => n.nodeKey);
      const opened = await this.users.getOpenedDomainKeys(userId, profile.languageKey, domainKeys);
      if (opened.length === 0 && languageLevel >= entryLevel) {
        const obj = await this.expandAndObjective(userId, profile.languageKey, mastered, domains, states, path, true);
        if (obj) return obj;
      }
    }

    // 4. Curriculum progression (seed the path if this learner is brand new)
    if (path.length === 0) {
      path = await this.ensureInitialPath(userId, profile.languageKey);
    }

    // Build prereq map for nextPathNode
    const prereqMap = await this.nodes.prereqsForNodes(path.map((p) => p.nodeId));
    const next = pickNextPathNode(path, states, prereqMap);
    if (next) {
      // Resolve the weak-prereq backward move to a real node
      let targetNode: NodeLite | null = null;
      if (next.nodeId) {
        targetNode = await this.nodes.findById(next.nodeId);
      } else if (next.nodeKey) {
        const id = await this.nodes.findIdByKey(next.nodeKey);
        if (id) targetNode = await this.nodes.findById(id);
      }
      if (targetNode) {
        return buildObjective(
          "CURRICULUM",
          targetNode,
          `Continue the learning path: ${targetNode.label}. Prerequisite foundations are in place.`,
          buildCurriculumActivities(targetNode.nodeKey, states),
          "LEARN"
        );
      }
    }

    // 5. Expand the domain model and continue (path exhausted)
    const obj = await this.expandAndObjective(userId, profile.languageKey, mastered, domains, states, path, false);
    if (obj) return obj;

    // 6. Retention-only day
    if (profile.reviewDueNodes.length > 0) {
      return buildObjective("REVIEW", null, "All curriculum objectives are in review. Today is a spaced-repetition day.", ["REVIEW"], "REVIEW");
    }

    // 7. Fallback: consolidate
    return buildObjective("REVIEW", null, "You have covered the current curriculum. Today consolidates everything you practiced.", ["REVIEW"], "REVIEW");
  }

  /** Compose and persist today's session + tasks from a decision. */
  async composeSession(
    userId: string,
    profile: LearnerProfile & ProfileExtras,
    objective: Objective,
    opts: { kind?: "REGULAR" | "RECOVERY" | "REVIEW"; dueAt?: Date; deadlineAt?: Date; sourceSessionId?: string | null } = {}
  ): Promise<{ sessionId: string; tasks: number }> {
    const prefs = profile.prefs!;
    const budget = prefs.dailyMinutes;
    const decision = objective.decision;

    const session = await this.sessions.createSession({
      userId,
      localDate: profile.todayLocal,
      kind: opts.kind ??
        (decision.type === "RECOVERY" ? "RECOVERY" : decision.type === "REVIEW" && !decision.objectiveNodeId ? "REVIEW" : "REGULAR"),
      decision,
      plannedMinutes: Math.min(decision.estimatedMinutes, budget),
      dueAt: opts.dueAt ?? new Date(),
      deadlineAt: opts.deadlineAt ?? new Date(Date.now() + 60 * 60 * 1000),
      sourceSessionId: opts.sourceSessionId ?? null,
    });

    const plan: { kind: string; contentKind: ContentKind; nodeId: string; required: boolean }[] = [];

    // spaced review targets
    for (const rt of this.reviewTargets(profile, budget)) {
      plan.push({ kind: "REVIEW", contentKind: rt.reviewCount % 2 === 0 ? "TRACING" : "CONCEPTUAL", nodeId: rt.nodeId, required: true });
    }

    if (objective.objectiveNodeId) {
      const node = await this.nodes.findById(objective.objectiveNodeId);
      for (const activity of decision.activities) {
        switch (activity) {
          case "LESSON":
            plan.push({ kind: "LEARN", contentKind: "LESSON", nodeId: node.id, required: true });
            break;
          case "CODING":
            plan.push({ kind: "PRACTICE", contentKind: "CODING", nodeId: node.id, required: true });
            break;
          case "DEBUGGING":
            plan.push({ kind: "PRACTICE", contentKind: "DEBUGGING", nodeId: node.id, required: true });
            break;
          case "CONCEPTUAL":
            plan.push({ kind: "PRACTICE", contentKind: "CONCEPTUAL", nodeId: node.id, required: true });
            break;
          case "APPLY":
            plan.push({ kind: "PRACTICE", contentKind: "REAL_WORLD", nodeId: node.id, required: false });
            break;
          case "ASSESSMENT":
            plan.push({ kind: "ASSESS", contentKind: "ASSESSMENT", nodeId: node.id, required: true });
            break;
          case "PROJECT":
            plan.push({ kind: "PROJECT", contentKind: "PROJECT", nodeId: node.id, required: false });
            break;
        }
      }
    }

    // budget trimming: drop optional tasks first
    const budgetCap = Math.max(budget, 20) * 1.2;
    const kept: typeof plan = [];
    let total = 0;
    for (const task of plan) {
      const node = await this.nodes.findById(task.nodeId);
      const est = node.estMinutes;
      if (total + est > budgetCap && !task.required && kept.length > 0) continue;
      total += est;
      kept.push(task);
    }

    let position = 0;
    for (const task of kept) {
      const node = await this.nodes.findById(task.nodeId);
      try {
        const resolved = await this.content.resolve(
          {
            nodeId: node.id,
            nodeKey: node.nodeKey,
            label: node.label,
            definition: node.definition,
            applications: node.applications,
            misconceptions: node.misconceptions,
            languageKey: prefs.languageKey as ExecutorLanguage,
            difficulty: this.adaptiveFor(node, profile),
            estMinutes: node.estMinutes,
            learner: this.learnerCtx(profile),
            usageCount: await this.content.countForNode(node.id)
          },
          task.contentKind
        );
        await this.sessions.addTask({
          sessionId: session.id,
          position: position++,
          kind: task.kind,
          contentItemId: resolved.itemId,
          title: resolved.title,
          estMinutes: resolved.estMinutes,
          required: task.required,
        });
      } catch (err) {
        console.warn(`[tutor] skipping task ${task.kind}@${node.nodeKey}: ${err instanceof Error ? err.message : err}`);
      }
    }

    await this.sessions.updatePlannedMinutes(session.id, Math.min(total, budget));

    return { sessionId: session.id, tasks: kept.length };
  }

  /* ------------------------------------------------------------------ */
  /* Private helpers                                                     */
  /* ------------------------------------------------------------------ */

  private async expandAndObjective(
    userId: string,
    languageKey: string,
    mastered: string[],
    domains: string[],
    states: Map<string, { state: string; mastery: number }>,
    path: { nodeId: string; nodeKey: string; position: number; status: string }[],
    forceFirstInserted: boolean
  ): Promise<Objective | null> {
    const expansion = await this.nodes.expandDomainModel(languageKey, mastered, domains, path.map((p) => p.nodeKey));
    if (expansion.nodes.length === 0) return null;
    const createdIds = await this.nodes.insertExpansion(languageKey, expansion);
    void createdIds;
    const allNodes = await this.nodes.findKeysByLanguageKey(languageKey);
    const byKey = new Map(allNodes.map((r) => [r.nodeKey, r.id]));
    const maxPos = path.length > 0 ? Math.max(...path.map((p) => p.position)) : 0;
    let added = 0;
    for (const n of expansion.nodes) {
      const id = byKey.get(n.nodeKey);
      if (id && !path.some((p) => p.nodeId === id)) {
        await this.users.addToPath({
          userId,
          nodeId: id,
          position: maxPos + 1 + added,
          status: "PLANNED",
          reason: `domain expansion (${expansion.source})`,
        });
        added++;
      }
    }
    let node: NodeLite | null = null;
    if (forceFirstInserted) {
      const first = expansion.nodes.find((n) => isDomainNodeKey(n.nodeKey)) ?? expansion.nodes[0]!;
      const id = byKey.get(first.nodeKey);
      if (id) node = await this.nodes.findById(id);
    } else {
      const freshPath = await this.users.getPath(userId);
      const prereqMap = await this.nodes.prereqsForNodes(freshPath.map((p) => p.nodeId));
      const target = pickNextPathNode(freshPath, states, prereqMap);
      if (target) {
        const tid = target.nodeId || (await this.nodes.findIdByKey(target.nodeKey));
        if (tid) node = await this.nodes.findById(tid);
      }
    }
    if (!node) return null;
    return buildObjective(
      "CURRICULUM",
      node,
      `The domain model was expanded (${expansion.source}). New frontier: ${node.label}.`,
      buildCurriculumActivities(node.nodeKey, states),
      "LEARN",
      expansion.source === "AI"
    );
  }

  private async ensureInitialPath(userId: string, languageKey: string) {
    const nodes = await this.nodes.findByLanguageKey(languageKey);
    const pathNodes = nodes.filter((n) => !isDomainNodeKey(n.nodeKey));
    let pos = 0;
    for (const n of pathNodes) {
      await this.users.addToPath({
        userId,
        nodeId: n.id,
        position: pos++,
        status: "PLANNED",
        reason: "initial curriculum seed",
      });
    }
    return this.users.getPath(userId);
  }

  private async worstWeakNode(userId: string, profile: LearnerProfile): Promise<NodeLite | null> {
    const heat = await this.streaks.getMistakeHeat(userId);
    const target = pickWorstWeakNode(profile.concepts, heat);
    if (!target) return null;
    return this.nodes.findById(target.nodeId);
  }

  private reviewTargets(profile: LearnerProfile, budget: number): { nodeId: string; reviewCount: number }[] {
    const maxReviews = Math.max(1, Math.floor(budget / 35));
    return profile.concepts
      .filter((c) => c.reviewDue)
      .slice(0, maxReviews)
      .map((c) => ({ nodeId: c.nodeId, reviewCount: c.mistakeCount }));
  }

  private learnerCtx(profile: LearnerProfile) {
    const mastered = profile.concepts.filter((c) => PASS_STATES.has(c.state)).map((c) => c.nodeKey);
    const recent = profile.mistakePatterns.map((m) => m.pattern);
    return { level: profile.level, prerequisitesMastered: mastered, recentMistakes: recent };
  }

  private adaptiveFor(node: NodeLite, profile: LearnerProfile): number {
    void node;
    return Math.min(5, Math.max(1, profile.difficultyPref));
  }
}
