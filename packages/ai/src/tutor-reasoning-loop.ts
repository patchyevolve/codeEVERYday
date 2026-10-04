/**
 * Tutor Reasoning Loop — the core AI tutoring brain.
 *
 * Orchestrates the observe → hypothesize → clarify → decide → intervene →
 * evaluate cycle for each incoming learner message. This is what makes the
 * system an adaptive tutor rather than a content delivery platform.
 *
 * Spec reference: docs/ai-subsystem-design.md §12, §13
 */

import type {
  TutorMessage,
  TutorResponse,
  TutorAction,
  EvidenceEvent,
  Hypothesis,
  ChatMessage,
} from "./contracts.js";
import { classifyDecisionRisk } from "./contracts.js";
import type { OrchestratorImpl } from "./orchestrator.js";
import type { ReasoningRepository } from "./repositories/reasoning-repository.js";
import type { MemoryRepository } from "./repositories/memory-repository.js";
import {
  generateHypothesis,
  updateHypothesis,
  getActiveHypotheses,
  needsClarification,
  generateClarificationQuestion,
  supersedeHypothesis,
  recordDecision,
  recordStrategyOutcome,
  getBestStrategies,
} from "./tutor-reasoning.js";

/* ------------------------------------------------------------------ */
/* Types                                                                */
/* ------------------------------------------------------------------ */

export interface ReasoningLoopDeps {
  reasoningRepo: ReasoningRepository;
  memoryRepo: MemoryRepository;
  orchestrator: OrchestratorImpl;
}

export interface IncomingContext {
  userId: string;
  sessionId: string;
  currentNodeId?: string;
  currentNodeKey?: string;
  currentPhase?: string;
  learnerDimensions?: { dimension: string; value: number; confidence: number }[];
}

/* ------------------------------------------------------------------ */
/* Evidence Extraction                                                  */
/* ------------------------------------------------------------------ */

export function extractEvidenceFromMessage(
  message: TutorMessage,
  context: IncomingContext,
): {
  evidenceType: EvidenceEvent["type"];
  result: EvidenceEvent["result"];
  concept?: string;
  payload: Record<string, unknown>;
} {
  const content = message.content.toLowerCase();
  const meta = message.metadata ?? {};

  if (message.type === "LEARNER_CLAIM") {
    return {
      evidenceType: "LEARNER_CLAIM",
      result: (meta.verdict as EvidenceEvent["result"]) ?? "partial",
      concept: context.currentNodeKey,
      payload: { content: message.content, claimType: meta.claimType },
    };
  }

  if (message.type === "LEARNER_CORRECTION") {
    return {
      evidenceType: "SELF_CORRECTION",
      result: "correct",
      concept: context.currentNodeKey,
      payload: { content: message.content, correctedFrom: meta.previousAnswer },
    };
  }

  if (message.type === "SYSTEM_EVENT") {
    return {
      evidenceType: "SESSION_BEHAVIOR",
      result: undefined,
      concept: context.currentNodeKey,
      payload: { content: message.content, issue: meta.issue },
    };
  }

  if (
    content.includes("i don't understand") ||
    content.includes("confused") ||
    content.includes("what does") ||
    content.includes("how does") ||
    content.includes("why does") ||
    content.includes("can you explain")
  ) {
    return {
      evidenceType: "QUESTION",
      result: undefined,
      concept: context.currentNodeKey,
      payload: { content: message.content },
    };
  }

  if (
    content.includes("hint") ||
    content.includes("help me") ||
    content.includes("stuck") ||
    content.includes("don't know")
  ) {
    return {
      evidenceType: "HINT_REQUEST",
      result: undefined,
      concept: context.currentNodeKey,
      payload: { content: message.content, hintsUsed: 1 },
    };
  }

  if (
    content.includes("i think") ||
    content.includes("i believe") ||
    content.includes("my answer")
  ) {
    const isCorrect =
      content.includes("correct") ||
      content.includes("right") ||
      content.includes("should work");
    return {
      evidenceType: "ANSWER",
      result: isCorrect ? "correct" : "partial",
      concept: context.currentNodeKey,
      payload: { content: message.content },
    };
  }

  return {
    evidenceType: "ANSWER",
    result: "partial",
    concept: context.currentNodeKey,
    payload: { content: message.content },
  };
}

/* ------------------------------------------------------------------ */
/* Hypothesis Generation from Evidence                                  */
/* ------------------------------------------------------------------ */

export async function generateHypothesesFromEvidence(
  deps: ReasoningLoopDeps,
  context: IncomingContext,
  evidenceType: EvidenceEvent["type"],
  messageContent: string,
): Promise<Hypothesis[]> {
  const existing = await getActiveHypotheses(deps.reasoningRepo, context.userId);

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `You are a tutoring hypothesis engine. Given a learner's message and existing hypotheses, generate 1-3 hypotheses about what the learner is struggling with. Return JSON: { "hypotheses": [{ "statement": "...", "confidence": 0.0-1.0, "alternatives": ["..."] }] }`,
    },
    {
      role: "user",
      content: JSON.stringify({
        message: messageContent,
        evidenceType,
        existingHypotheses: existing.slice(0, 5).map((h) => ({
          statement: h.statement,
          confidence: h.confidence,
        })),
        currentNode: context.currentNodeKey,
      }),
    },
  ];

  const result = await deps.orchestrator.request({
    requestId: crypto.randomUUID(),
    taskType: "HYPOTHESIS_GENERATION",
    priority: "P1",
    userId: context.userId,
    sessionId: context.sessionId,
    messages,
  });

  const generated: Hypothesis[] = [];

  if (result.ok && result.content) {
    try {
      const parsed = JSON.parse(result.content) as { hypotheses?: { statement: string; confidence: number; alternatives: string[] }[] };
      const items = parsed.hypotheses ?? [];
      for (const item of items.slice(0, 3)) {
        const h = await generateHypothesis(
          deps.reasoningRepo,
          context.userId,
          context.currentNodeKey ?? "unknown",
          item.statement,
          Math.max(0.01, Math.min(0.99, item.confidence)),
          item.alternatives ?? [],
        );
        generated.push(h);
      }
    } catch {
      // JSON parse failure — fall through to fallback
    }
  }

  if (generated.length === 0) {
    const fallbackHypothesis = await generateHypothesis(
      deps.reasoningRepo,
      context.userId,
      context.currentNodeKey ?? "unknown",
      `Learner is uncertain about ${context.currentNodeKey ?? "current topic"} based on their message`,
      0.4,
      [],
    );
    generated.push(fallbackHypothesis);
  }

  return generated;
}

/* ------------------------------------------------------------------ */
/* Action Decision                                                     */
/* ------------------------------------------------------------------ */

export function decideAction(
  hypotheses: Hypothesis[],
  context: IncomingContext,
  clarificationNeeded: boolean,
): { action: TutorAction; reason: string; confidence: number } {
  if (clarificationNeeded && hypotheses.length >= 2) {
    return {
      action: "ASK",
      reason: "Hypotheses are ambiguous — need clarification from learner",
      confidence: 0.5,
    };
  }

  const top = hypotheses[0];
  if (!top) {
    return {
      action: "CONTINUE",
      reason: "No strong hypothesis — continue with current activity",
      confidence: 0.3,
    };
  }

  const stmt = top.statement.toLowerCase();

  if (top.confidence >= 0.7) {
    if (stmt.includes("misconception") || stmt.includes("wrong mental model")) {
      return { action: "REEXPLAIN", reason: `Strong hypothesis: ${top.statement}`, confidence: top.confidence };
    }
    if (stmt.includes("prerequisite") || stmt.includes("missing foundation")) {
      return { action: "REVIEW_PREREQUISITE", reason: `Strong hypothesis: ${top.statement}`, confidence: top.confidence };
    }
    if (stmt.includes("debugging") || stmt.includes("error") || stmt.includes("bug")) {
      return { action: "GIVE_HINT", reason: `Strong hypothesis: ${top.statement}`, confidence: top.confidence };
    }
    if (stmt.includes("confused") || stmt.includes("unclear") || stmt.includes("doesn't understand")) {
      return { action: "REPEAT", reason: `Learner is confused: ${top.statement}`, confidence: top.confidence };
    }
    if (stmt.includes("bored") || stmt.includes("too easy") || stmt.includes("already knows")) {
      return { action: "ADVANCE", reason: `Learner is ahead: ${top.statement}`, confidence: top.confidence };
    }
    if (stmt.includes("struggling") || stmt.includes("repeated mistake") || stmt.includes("persistent error")) {
      return { action: "REMEDIATE", reason: `Persistent struggle: ${top.statement}`, confidence: top.confidence };
    }
    if (stmt.includes("different approach") || stmt.includes("not working") || stmt.includes("try something else")) {
      return { action: "CHANGE_TEACHING_METHOD", reason: `Current method ineffective: ${top.statement}`, confidence: top.confidence };
    }
    if (stmt.includes("step by step") || stmt.includes("walk through") || stmt.includes("show solution")) {
      return { action: "GUIDED_SOLUTION", reason: `Learner needs walkthrough: ${top.statement}`, confidence: top.confidence };
    }
    return { action: "EXPLAIN", reason: `Strong hypothesis: ${top.statement}`, confidence: top.confidence };
  }

  if (top.confidence >= 0.4) {
    return { action: "DIAGNOSE", reason: `Moderate confidence hypothesis: ${top.statement}`, confidence: top.confidence };
  }

  return { action: "CONTINUE", reason: `Weak hypothesis — gather more evidence: ${top.statement}`, confidence: top.confidence };
}

/* ------------------------------------------------------------------ */
/* Intervention Generation                                             */
/* ------------------------------------------------------------------ */

export async function generateIntervention(
  deps: ReasoningLoopDeps,
  action: TutorAction,
  hypotheses: Hypothesis[],
  context: IncomingContext,
  originalMessage: string,
): Promise<string> {
  const topHypothesis = hypotheses[0];
  const hypothesisContext = topHypothesis
    ? `Primary hypothesis: "${topHypothesis.statement}" (${Math.round(topHypothesis.confidence * 100)}% confidence)`
    : "No strong hypothesis";

  const strategies = await getBestStrategies(
    deps.reasoningRepo,
    context.currentNodeKey ?? "unknown",
  );
  const strategyContext = strategies.length > 0
    ? `Past strategies that worked: ${strategies.slice(0, 3).map((s) => `${s.strategy} (${Math.round(s.effectiveness * 100)}% effective)`).join(", ")}`
    : "No past strategy data";

  const systemPrompt = buildInterventionSystemPrompt(action, hypothesisContext, strategyContext);

  try {
    const result = await deps.orchestrator.request({
      requestId: crypto.randomUUID(),
      taskType: mapActionToTaskType(action),
      priority: "P0",
      userId: context.userId,
      sessionId: context.sessionId,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: originalMessage },
      ],
    });

    if (result.ok && result.content) {
      try {
        const parsed = JSON.parse(result.content) as { content?: string };
        if (parsed.content) return parsed.content;
      } catch {
        return result.content;
      }
    }
  } catch {
    // Provider failed — fall through to deterministic fallback
  }

  return generateFallbackIntervention(action, topHypothesis);
}

function buildInterventionSystemPrompt(
  action: TutorAction,
  hypothesisContext: string,
  strategyContext: string,
): string {
  const base = `You are an expert coding tutor. ${hypothesisContext}. ${strategyContext}.`;

  switch (action) {
    case "EXPLAIN":
      return `${base} Provide a clear, concise explanation. Use examples if helpful. Keep it under 3 paragraphs.`;
    case "REEXPLAIN":
      return `${base} The learner didn't understand the previous explanation. Re-explain using a different approach — try an analogy, a simpler example, or a different angle. Keep it under 3 paragraphs.`;
    case "ASK":
      return `${base} Ask the learner a specific, focused question to disambiguate their confusion. One question only.`;
    case "DIAGNOSE":
      return `${base} Ask a diagnostic question to understand the learner's specific confusion. Focus on distinguishing between possible root causes.`;
    case "GIVE_HINT":
      return `${base} Give a focused hint that nudges the learner toward the solution without giving it away. One hint only.`;
    case "GUIDED_SOLUTION":
      return `${base} Walk the learner through the solution step by step, explaining each step.`;
    case "REVIEW_PREREQUISITE":
      return `${base} Briefly review the prerequisite concept the learner is missing, then connect it to the current problem.`;
    case "CHANGE_TEACHING_METHOD":
      return `${base} Try a completely different teaching approach — if we were explaining conceptually, try a concrete example; if we were using examples, try a visual metaphor.`;
    case "REPEAT":
      return `${base} Repeat the key point concisely. The learner may need to hear it again.`;
    case "ADVANCE":
      return `${base} Acknowledge the learner's progress and introduce the next concept or challenge.`;
    case "REMEDIATE":
      return `${base} Address the specific mistake or misconception directly. Show the correct approach.`;
    case "PAUSE":
      return `${base} Give the learner a moment. Suggest they take a break or review what they've learned so far.`;
    case "END_SESSION":
      return `${base} Summarize what was learned and suggest what to review next.`;
    default:
      return `${base} Respond appropriately to the learner's message.`;
  }
}

function mapActionToTaskType(action: TutorAction): "TUTOR_EXPLANATION" | "TUTOR_CLARIFICATION" | "TUTOR_HINT" | "TUTOR_EXAMPLE" | "TUTOR_DEBUGGING" | "CONTENT_GENERATION" {
  switch (action) {
    case "EXPLAIN":
    case "REEXPLAIN":
    case "REPEAT":
      return "TUTOR_EXPLANATION";
    case "ASK":
    case "DIAGNOSE":
      return "TUTOR_CLARIFICATION";
    case "GIVE_HINT":
      return "TUTOR_HINT";
    case "GUIDED_SOLUTION":
    case "REMEDIATE":
      return "TUTOR_EXAMPLE";
    case "REVIEW_PREREQUISITE":
    case "CHANGE_TEACHING_METHOD":
      return "TUTOR_DEBUGGING";
    default:
      return "CONTENT_GENERATION";
  }
}

function generateFallbackIntervention(
  action: TutorAction,
  hypothesis: Hypothesis | undefined,
): string {
  const subject = hypothesis?.subject ?? "this topic";

  switch (action) {
    case "EXPLAIN":
      return `Let me explain ${subject} more clearly. The key idea is to break it down into smaller parts.`;
    case "REEXPLAIN":
      return `Let me try explaining ${subject} differently. Sometimes a fresh perspective helps.`;
    case "ASK":
      return `Can you tell me specifically what part of ${subject} is confusing you?`;
    case "DIAGNOSE":
      return `Let me ask: when you look at ${subject}, what do you think is happening vs. what you expected?`;
    case "GIVE_HINT":
      return `Here's a hint: try thinking about what happens step by step, rather than all at once.`;
    case "REVIEW_PREREQUISITE":
      return `Before we continue, let's quickly review the foundation that ${subject} builds on.`;
    case "CHANGE_TEACHING_METHOD":
      return `Let me try a different approach to explain ${subject}.`;
    default:
      return `Let's continue working on ${subject}. What would you like to focus on?`;
  }
}

/* ------------------------------------------------------------------ */
/* Main Reasoning Loop                                                  */
/* ------------------------------------------------------------------ */

export async function handleIncoming(
  deps: ReasoningLoopDeps,
  message: TutorMessage,
  context: IncomingContext,
): Promise<TutorResponse> {
  const evidence = extractEvidenceFromMessage(message, context);

  const hypotheses = await generateHypothesesFromEvidence(
    deps,
    context,
    evidence.evidenceType,
    message.content,
  );

  const clarification = await needsClarification(deps.reasoningRepo, context.userId);

  const { action, reason, confidence } = decideAction(
    hypotheses,
    context,
    clarification.needed,
  );

  let content: string;
  if (clarification.needed && clarification.topHypothesis && clarification.alternative) {
    content = generateClarificationQuestion(clarification.topHypothesis, clarification.alternative);
  } else {
    content = await generateIntervention(deps, action, hypotheses, context, message.content);
  }

  const evidenceId = crypto.randomUUID();
  const evidenceEvent: EvidenceEvent = {
    id: evidenceId,
    userId: context.userId,
    sessionId: context.sessionId,
    type: evidence.evidenceType,
    concept: evidence.concept,
    result: evidence.result,
    source: "tutor",
    payload: evidence.payload,
    observedAt: new Date(),
  };

  for (const h of hypotheses) {
    const supported = evidence.result === "correct";
    await updateHypothesis(deps.reasoningRepo, h.id, evidenceId, supported);
  }

  const selectedHypothesis = hypotheses[0];
  if (selectedHypothesis) {
    const riskLevel = classifyDecisionRisk(action);
    await recordDecision(deps.reasoningRepo, {
      userId: context.userId,
      sessionId: context.sessionId,
      selectedHypothesis: selectedHypothesis.statement,
      observations: [`Learner message: ${message.content.slice(0, 200)}`],
      hypotheses: hypotheses.map((h) => h.statement),
      action,
      confidence,
      expectedOutcome: reason,
      verdict: "unknown",
      riskLevel,
    });
  }

  return {
    action,
    content,
    hypothesis: selectedHypothesis,
    evidence: [evidenceEvent],
  };
}

/* ------------------------------------------------------------------ */
/* Root-Cause Reasoning (§33)                                           */
/* ------------------------------------------------------------------ */

/**
 * Detect shared prerequisites across failing concepts (§33).
 * When multiple concepts share a prerequisite and all are failing,
 * the root cause is likely the prerequisite, not the individual concepts.
 */
export function detectSharedPrerequisites(
  failingConcepts: string[],
  dependencyGraph: Map<string, string[]>
): { prerequisite: string; dependentConcepts: string[] }[] {
  const prereqCounts = new Map<string, string[]>();
  
  for (const concept of failingConcepts) {
    const prereqs = dependencyGraph.get(concept) ?? [];
    for (const prereq of prereqs) {
      if (!failingConcepts.includes(prereq)) {
        const existing = prereqCounts.get(prereq) ?? [];
        existing.push(concept);
        prereqCounts.set(prereq, existing);
      }
    }
  }
  
  const results: { prerequisite: string; dependentConcepts: string[] }[] = [];
  for (const [prereq, dependents] of prereqCounts) {
    if (dependents.length >= 2) {
      results.push({ prerequisite: prereq, dependentConcepts: dependents });
    }
  }
  
  results.sort((a, b) => b.dependentConcepts.length - a.dependentConcepts.length);
  return results;
}

/* ------------------------------------------------------------------ */
/* Claim Verification (§38)                                             */
/* ------------------------------------------------------------------ */

/**
 * Generate a diagnostic question to verify a learner's knowledge claim (§38).
 * When a learner claims to understand something, we verify with a targeted question.
 */
export function generateDiagnosticQuestion(
  claim: string,
  concept: string,
  learnerLevel: number
): { question: string; expectedAnswer: string; purpose: "VERIFY_RECALL" | "TEST_TRANSFER" | "PROBE_DEPTH" } {
  if (learnerLevel < 0.3) {
    return {
      question: `Can you explain ${concept} in your own words?`,
      expectedAnswer: "explanation demonstrating understanding",
      purpose: "VERIFY_RECALL",
    };
  }
  if (learnerLevel < 0.6) {
    return {
      question: `How would you use ${concept} to solve a different problem than the one we just did?`,
      expectedAnswer: "application to new context",
      purpose: "TEST_TRANSFER",
    };
  }
  return {
    question: `What are the limitations or edge cases of ${concept}?`,
      expectedAnswer: "awareness of limitations",
      purpose: "PROBE_DEPTH",
  };
}

/* ------------------------------------------------------------------ */
/* Verdict Evaluation (post-hoc)                                        */
/* ------------------------------------------------------------------ */

export async function evaluateDecisionOutcome(
  deps: ReasoningLoopDeps,
  sessionId: string,
  decisionId: string,
  actualOutcome: string,
  evidenceId: string,
): Promise<void> {
  const allDecisions = await deps.reasoningRepo.findDecisionsBySession(sessionId);
  const decision = allDecisions.find((d) => d.id === decisionId);
  if (!decision) return;

  const isEffective =
    actualOutcome.toLowerCase().includes("correct") ||
    actualOutcome.toLowerCase().includes("understood") ||
    actualOutcome.toLowerCase().includes("got it");

  const verdict = isEffective ? "correct" : "incorrect";

  const { updateVerdict } = await import("./tutor-reasoning.js");
  await updateVerdict(deps.reasoningRepo, decisionId, verdict, actualOutcome);

  if (decision.selectedHypothesis) {
    const activeHypotheses = await getActiveHypotheses(deps.reasoningRepo, decision.userId);
    const matching = activeHypotheses.find((h) => h.statement === decision.selectedHypothesis);
    if (matching) {
      await updateHypothesis(deps.reasoningRepo, matching.id, evidenceId, isEffective);
    }
  }

  await recordStrategyOutcome(deps.reasoningRepo, {
    concept: decision.hypotheses[0] ?? "unknown",
    learnerProblem: decision.observations[0] ?? "unknown",
    strategy: decision.action,
    outcome: isEffective ? "effective" : "ineffective",
    context: {},
    evidenceRefs: [evidenceId],
  });
}
