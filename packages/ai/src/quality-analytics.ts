/**
 * Quality Analytics — aggregate metrics for content quality and tutor effectiveness (§53).
 *
 * Provides dashboard-level views of content lifecycle health and tutor decision accuracy.
 * Used for monitoring, reporting, and identifying areas needing attention.
 */

import { eq, and, sql } from "drizzle-orm";
import { contentItems, tutorDecisions } from "@cpd/core";

export interface ContentQualityMetrics {
  totalContent: number;
  approvedContent: number;
  supersededContent: number;
  averageVersionCount: number;
  approvalRate: number;
}

export interface TutorEffectivenessMetrics {
  totalDecisions: number;
  correctDecisions: number;
  incorrectDecisions: number;
  highRiskDecisions: number;
  averageConfidence: number;
  effectivenessRate: number;
}

export interface QualityDashboard {
  content: ContentQualityMetrics;
  tutor: TutorEffectivenessMetrics;
  periodDays: number;
}

export class QualityAnalytics {
  constructor(private db: any) {}

  async getContentQualityMetrics(): Promise<ContentQualityMetrics> {
    const [total] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(contentItems);

    const [approved] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(contentItems)
      .where(eq(contentItems.status, "VALIDATED"));

    const [superseded] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(contentItems)
      .where(eq(contentItems.status, "RETIRED"));

    const [avgVersions] = await this.db
      .select({ avg: sql<number>`coalesce(avg(version), 1)` })
      .from(contentItems);

    const totalN = total?.count ?? 0;
    const approvedN = approved?.count ?? 0;

    return {
      totalContent: totalN,
      approvedContent: approvedN,
      supersededContent: superseded?.count ?? 0,
      averageVersionCount: Number(avgVersions?.avg ?? 1),
      approvalRate: totalN > 0 ? approvedN / totalN : 0,
    };
  }

  async getTutorEffectivenessMetrics(userId?: string): Promise<TutorEffectivenessMetrics> {
    const conditions = userId ? eq(tutorDecisions.userId, userId) : undefined;

    const [total] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(tutorDecisions)
      .where(conditions);

    const [correct] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(tutorDecisions)
      .where(
        conditions
          ? and(conditions, eq(tutorDecisions.verdict, "correct"))
          : eq(tutorDecisions.verdict, "correct"),
      );

    const [incorrect] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(tutorDecisions)
      .where(
        conditions
          ? and(conditions, eq(tutorDecisions.verdict, "incorrect"))
          : eq(tutorDecisions.verdict, "incorrect"),
      );

    const [highRisk] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(tutorDecisions)
      .where(
        conditions
          ? and(conditions, eq(tutorDecisions.riskLevel, "high"))
          : eq(tutorDecisions.riskLevel, "high"),
      );

    const [avgConf] = await this.db
      .select({ avg: sql<number>`coalesce(avg(confidence), 0)` })
      .from(tutorDecisions)
      .where(conditions);

    const totalN = total?.count ?? 0;
    const correctN = correct?.count ?? 0;

    return {
      totalDecisions: totalN,
      correctDecisions: correctN,
      incorrectDecisions: incorrect?.count ?? 0,
      highRiskDecisions: highRisk?.count ?? 0,
      averageConfidence: Number(avgConf?.avg ?? 0),
      effectivenessRate: totalN > 0 ? correctN / totalN : 0,
    };
  }

  async getDashboard(userId?: string, periodDays: number = 30): Promise<QualityDashboard> {
    const [content, tutor] = await Promise.all([
      this.getContentQualityMetrics(),
      this.getTutorEffectivenessMetrics(userId),
    ]);
    return { content, tutor, periodDays };
  }
}
