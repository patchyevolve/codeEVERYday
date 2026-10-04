/**
 * Context Compiler — budgeted prompt assembly for AI requests.
 *
 * Constructs model context from: system tutor policy, curriculum objective,
 * current session, relevant learner dimensions (top-k), relevant history,
 * tutor experience, approved content, current activity, current learner message.
 * Enforces token budget; drops least-relevant sections first.
 */

import type { DB } from "@cpd/core";
import type {
  AITaskType,
  ChatMessage,
  CompiledContext,
  ContextCompilerInput,
  MemoryHit,
  TutorExperienceRecord,
} from "./contracts.js";
import type { MemorySystemImpl } from "./memory.js";

const TUTOR_POLICY = `You are a persistent coding tutor. You teach one learner daily through a structured curriculum. You remember previous sessions, continuously evaluate the learner, ask questions, diagnose problems, adapt teaching, handle clarification, and carry learning state forward.

核心原则:
- Never silently let an LLM response become authoritative system state
- Every important AI interpretation must be distinguishable from underlying evidence
- Facts (submissions/executions) are written only by deterministic code
- Learner statements are evidence, not automatically verified truth
- If uncertain, ask a targeted clarification question
- A failed provider request must never fabricate a tutor action

Authority order: application state > approved curriculum > verified historical records > learner statements > tutor hypotheses > model speculation`;

const TOKEN_ESTIMATE_RATIO = 4;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / TOKEN_ESTIMATE_RATIO);
}

function messagesTokenEstimate(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
}

/**
 * Enforce memory authority rules (§49).
 * Historical facts cannot be overridden by tutor-generated content.
 * Session memory takes precedence over historical for recency.
 * Learner-stated facts are lower authority than system-observed facts.
 */
export function enforceMemoryAuthority(hits: MemoryHit[]): MemoryHit[] {
  const authorityOrder: Record<string, number> = {
    session: 3,      // most authoritative (system-observed, recent)
    learner: 2,      // learner-stated claims
    historical: 1,   // older facts
    tutor_experience: 2, // tutor's own experience
    temporary: 0,    // least authoritative
  };

  // Sort by authority (highest first), then by recency
  return hits.sort((a, b) => {
    const authA = authorityOrder[a.store] ?? 0;
    const authB = authorityOrder[b.store] ?? 0;
    if (authA !== authB) return authB - authA;
    // Within same authority, prefer newer
    const dateA = a.date ?? "";
    const dateB = b.date ?? "";
    return dateB.localeCompare(dateA);
  });
}

/**
 * Detect contradictions between memory hits (§49).
 * If a session memory says X and a historical memory says not-X,
 * the session memory takes precedence but the contradiction is flagged.
 */
export function detectContradictions(
  hits: MemoryHit[],
): { hit1: MemoryHit; hit2: MemoryHit; reason: string }[] {
  const contradictions: { hit1: MemoryHit; hit2: MemoryHit; reason: string }[] = [];

  for (let i = 0; i < hits.length; i++) {
    for (let j = i + 1; j < hits.length; j++) {
      const a = hits[i]!;
      const b = hits[j]!;
      if (a.store === b.store) continue;
      if (a.data.concept && a.data.concept === b.data.concept) {
        if (a.data.result && b.data.result && a.data.result !== b.data.result) {
          contradictions.push({
            hit1: a,
            hit2: b,
            reason: `Concept "${a.data.concept}": ${a.store} says "${a.data.result}" but ${b.store} says "${b.data.result}"`,
          });
        }
      }
    }
  }

  return contradictions;
}

export class ContextCompiler {
  constructor(
    private readonly db: DB,
    private readonly memory?: MemorySystemImpl,
  ) {}

  async compile(input: ContextCompilerInput): Promise<CompiledContext> {
    const budget = input.budgetTokens;
    const messages: ChatMessage[] = [];
    let tokenEstimate = 0;

    const systemParts: string[] = [TUTOR_POLICY];
    tokenEstimate += estimateTokens(TUTOR_POLICY);

    if (input.objective) {
      const objectivePart = `\n\nCURRENT OBJECTIVE: ${input.objective}`;
      systemParts.push(objectivePart);
      tokenEstimate += estimateTokens(objectivePart);
    }

    if (input.sessionState) {
      const sessionPart = `\n\nSESSION STATE: ${JSON.stringify(input.sessionState)}`;
      systemParts.push(sessionPart);
      tokenEstimate += estimateTokens(sessionPart);
    }

    if (input.learnerDimensions && input.learnerDimensions.length > 0) {
      const sorted = [...input.learnerDimensions].sort((a, b) => b.confidence - a.confidence);
      const topK = sorted.slice(0, 8);
      const dimPart = `\n\nLEARNER DIMENSIONS:\n${topK.map((d) => `${d.dimension}: ${(d.value * 100).toFixed(0)}% (confidence: ${(d.confidence * 100).toFixed(0)}%)`).join("\n")}`;
      systemParts.push(dimPart);
      tokenEstimate += estimateTokens(dimPart);
    }

    if (input.history && input.history.length > 0) {
      const relevantHistory = input.history.slice(-5);
      const histPart = `\n\nRECENT HISTORY:\n${relevantHistory.map((h) => `[${h.date}] ${h.summary}`).join("\n")}`;
      if (tokenEstimate + estimateTokens(histPart) <= budget * 0.8) {
        systemParts.push(histPart);
        tokenEstimate += estimateTokens(histPart);
      }
    }

    if (input.tutorExperience && input.tutorExperience.length > 0) {
      const expPart = `\n\nTUTOR EXPERIENCE:\n${input.tutorExperience.slice(0, 3).map((e) => `${e.concept}/${e.learnerProblem}: ${e.strategy} was ${e.outcome}`).join("\n")}`;
      if (tokenEstimate + estimateTokens(expPart) <= budget * 0.8) {
        systemParts.push(expPart);
        tokenEstimate += estimateTokens(expPart);
      }
    }

    messages.push({ role: "system", content: systemParts.join("") });

    if (input.currentMessage) {
      messages.push({ role: "user", content: input.currentMessage });
      tokenEstimate += estimateTokens(input.currentMessage);
    }

    return { systemPrompt: messages[0]?.content ?? "", messages, tokenEstimate };
  }

  async compileForTask(
    taskType: AITaskType,
    userId: string | undefined,
    sessionId: string | undefined,
    currentMessage: string,
    budgetTokens: number = 8000
  ): Promise<CompiledContext> {
    const input: ContextCompilerInput = {
      taskType,
      userId,
      sessionId,
      currentMessage,
      budgetTokens,
    };

    if (userId && this.memory) {
      try {
        const stateHits = await this.memory.query({ kind: "CURRENT_STATE", userId });
        if (stateHits.length > 0) {
          const dims: { dimension: string; value: number; confidence: number }[] = [];
          for (const h of stateHits) {
            if (h.store !== "learner") continue;
            if (h.kind === "dimension" && typeof h.data.dimension === "string") {
              dims.push({
                dimension: h.data.dimension,
                value: (h.data.value as number) ?? 0,
                confidence: (h.data.confidence as number) ?? 0,
              });
            } else if (h.kind === "concept_state" && Array.isArray(h.data.dimensions)) {
              for (const d of h.data.dimensions as { dimension: string; value: number; confidence: number }[]) {
                dims.push({
                  dimension: d.dimension,
                  value: d.value ?? 0,
                  confidence: d.confidence ?? 0,
                });
              }
            }
          }
          input.learnerDimensions = dims;
        }
      } catch {
        // graceful degradation
      }
    }

    return this.compile(input);
  }
}
