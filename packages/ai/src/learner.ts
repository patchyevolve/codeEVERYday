/**
 * Learner model — a compact, queryable profile assembled from persisted
 * learning state. This is what the tutor decides on; the AI never receives
 * raw database history.
 */

import {
  type LearnerProfile
} from "@cpd/core";
import { todayLocal } from "@cpd/core";
import type { UserRepository } from "./repositories/user-repository.js";
import type { StreakRepository } from "./repositories/streak-repository.js";
import type { SessionRepository } from "./repositories/session-repository.js";
import type { NodeRepository } from "./repositories/node-repository.js";
import type { SubmissionRepository } from "./repositories/submission-repository.js";

export interface LearnerDeps {
  users: UserRepository;
  streaks: StreakRepository;
  sessions: SessionRepository;
  nodes: NodeRepository;
  submissions: SubmissionRepository;
}

export interface ProfileExtras {
  streakRow: { userId: string; currentLength: number; longestLength: number; currentStart: string | null; lastCompletedDate: string | null; brokenAt: Date | null } | null;
  prefs: { timezone: string; languageKey: string; dailyMinutes: number; difficultyPref: number };
}

export async function buildLearnerProfile(deps: LearnerDeps, userId: string): Promise<LearnerProfile & ProfileExtras> {
  const user = await deps.users.getUser(userId);
  if (!user) throw new Error(`user ${userId} not found`);

  const prefs = await deps.users.getPrefs(userId);
  if (!prefs) throw new Error(`preferences missing for ${userId} — onboarding incomplete`);

  const streak = await deps.streaks.findStreak(userId);
  const tz = prefs.timezone;
  const today = todayLocal(tz);

  // concept states joined with node info
  const states = await deps.users.getUserConceptStates(userId);

  // active mistakes grouped by node + pattern
  const mistakeRows = await deps.users.getActiveMistakes(userId);

  const mistakesByNode = new Map<string, { pattern: string; count: number }[]>();
  for (const m of mistakeRows) {
    const arr = mistakesByNode.get(m.nodeKey) ?? [];
    arr.push({ pattern: m.pattern, count: m.count });
    mistakesByNode.set(m.nodeKey, arr);
  }

  const now = new Date();
  const weakNodes = states
    .filter((s) => ["WEAK", "REVIEW_REQUIRED", "DECAYING"].includes(s.state))
    .sort((a, b) => {
      const ma = mistakesByNode.get(a.nodeKey)?.reduce((t, m) => t + m.count, 0) ?? 0;
      const mb = mistakesByNode.get(b.nodeKey)?.reduce((t, m) => t + m.count, 0) ?? 0;
      return mb - ma || a.mastery - b.mastery;
    })
    .map((s) => s.nodeKey);

  const reviewDueNodes = states
    .filter((s) => s.nextReviewAt && s.nextReviewAt <= now)
    .map((s) => s.nodeKey);

  // recent submissions (last 20)
  const recent = await deps.submissions.getRecentSubmissions(userId);

  const activePath = await deps.users.getPath(userId);
  const activePathFiltered = activePath.filter((p) => p.status === "ACTIVE");

  const profile: LearnerProfile = {
    userId,
    languageKey: prefs.languageKey,
    level: user.level,
    totalXp: user.totalXp,
    streak: streak?.currentLength ?? 0,
    dailyMinutes: prefs.dailyMinutes,
    difficultyPref: prefs.difficultyPref,
    todayLocal: today,
    concepts: states.map((s) => ({
      nodeId: s.nodeId,
      nodeKey: s.nodeKey,
      label: s.label,
      state: s.state,
      mastery: s.mastery,
      reviewDue: !!s.nextReviewAt && s.nextReviewAt <= now,
      mistakeCount: mistakesByNode.get(s.nodeKey)?.reduce((t, m) => t + m.count, 0) ?? 0
    })),
    weakNodes,
    reviewDueNodes,
    mistakePatterns: [...new Set(mistakeRows.map((m) => m.pattern))].map((p) => ({
      pattern: p,
      count: mistakeRows.filter((m) => m.pattern === p).reduce((t, m) => t + m.count, 0)
    })),
    recentResults: recent.map((r) => ({ nodeKey: r.nodeKey, passed: r.passed === "PASS", at: r.at.toISOString() })),
    activePathPosition: activePathFiltered[0]?.position ?? null
  };

  return { ...profile, streakRow: streak, prefs };
}

/** State lookups for the decision engine. */
export async function nodeStates(deps: LearnerDeps, userId: string): Promise<Map<string, { state: string; mastery: number }>> {
  return deps.users.getNodeStates(userId);
}

export async function learningPathNodes(deps: LearnerDeps, userId: string): Promise<{ nodeId: string; nodeKey: string; position: number; status: string }[]> {
  return deps.users.getPath(userId);
}

export async function activeOrRecentSessionState(deps: LearnerDeps, userId: string, localDate: string): Promise<"COMPLETED" | "MISSED" | "NONE" | "OPEN"> {
  const s = await deps.sessions.findSessionByUserAndDate(userId, localDate);
  if (!s) return "NONE";
  if (s.status === "COMPLETED" || s.status === "PARTIALLY_COMPLETED") return "COMPLETED";
  if (s.status === "MISSED" || s.status === "EXCUSED") return "MISSED";
  return "OPEN";
}

/** Mistake aggregation used for weakness severity. */
export async function mistakeHeat(deps: LearnerDeps, userId: string): Promise<Map<string, number>> {
  return deps.streaks.getMistakeHeat(userId);
}

export { todayLocal };
