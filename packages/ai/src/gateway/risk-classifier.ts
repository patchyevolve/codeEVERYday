/**
 * Risk Classifier — classifies tutor decisions as low/medium/high risk.
 * High-risk actions require additional verification before execution.
 *
 * Spec reference: usethisforAIsubsystem.txt §55
 */

import { classifyDecisionRisk, type DecisionRiskLevel, type TutorAction, type TutorDecisionRecord } from "../contracts.js";

export interface RiskAssessment {
  level: DecisionRiskLevel;
  requiresConfirmation: boolean;
  reason: string;
}

export class RiskClassifier {
  /** Classify a decision's risk level. */
  classify(action: TutorAction, confidence: number, context?: { consecutiveFailures?: number; hypothesisConfidence?: number }): RiskAssessment {
    const level = classifyDecisionRisk(action);
    const requiresConfirmation = level === "high" || (level === "medium" && confidence < 0.6);
    const reasons: string[] = [];
    if (level === "high") reasons.push(`action "${action}" is high-risk`);
    if (level === "medium" && confidence < 0.6) reasons.push("medium-risk with low confidence");
    if (context?.consecutiveFailures && context.consecutiveFailures >= 3) reasons.push("multiple recent failures");
    if (context?.hypothesisConfidence && context.hypothesisConfidence < 0.3) reasons.push("low hypothesis confidence");
    return { level, requiresConfirmation, reason: reasons.join("; ") || "low-risk action" };
  }

  /** Should this decision be logged for review? */
  shouldReview(assessment: RiskAssessment): boolean {
    return assessment.level === "high" || assessment.requiresConfirmation;
  }
}
