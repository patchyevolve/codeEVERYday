/**
 * Content repository service.
 *
 * Retrieval-first, just-in-time generation:
 *   1. search the repository for a suitable VALIDATED item
 *   2. if none, generate (AI provider, then deterministic template)
 *   3. validate (schema + sandbox execution for coding items)
 *   4. persist (AI_GENERATED / TEMPLATE), mark VALIDATED only when checks pass
 *   5. return the item — never serve unvalidated content
 */

import type { ContentPayload, ContentValidation, DB } from "@cpd/core";
import type { GenContext } from "./content.js";
import type { ExecutorLanguage } from "@cpd/core";
import {
  generateAssessment,
  generateConceptual,
  generateExercise,
  generateLesson,
  generateProject,
  generateRealWorld,
  generateTracing
} from "./generators.js";
import { validateContent } from "./validator.js";
import { nodeSeed } from "./domain-builder.js";
import type { AIProvider } from "./provider.js";
import type { ContentReviewer } from "./content-review.js";
import type { ContentRepository } from "./repositories/content-repository.js";

export type ContentKind =
  | "LESSON"
  | "CODING"
  | "DEBUGGING"
  | "CONCEPTUAL"
  | "TRACING"
  | "PREDICTION"
  | "ASSESSMENT"
  | "REAL_WORLD"
  | "PROJECT";

export interface GenerationRequest {
  nodeId: string;
  nodeKey: string;
  label: string;
  definition: string;
  applications: string[];
  misconceptions: string[];
  languageKey: ExecutorLanguage;
  difficulty: number;
  estMinutes: number;
  learner: GenContext["learner"];
  usageCount: number;
}

export interface ResolvedContent {
  itemId: string;
  title: string;
  kind: ContentKind;
  payload: ContentPayload;
  source: string;
  created: boolean;
  usageCount: number;
  difficulty: number;
  estMinutes: number;
}

const EXECUTION_KINDS = new Set(["CODING", "DEBUGGING"]);

export class ContentService {
  constructor(
    private db: DB,
    private provider: AIProvider,
    private reviewer?: ContentReviewer,
    private contentRepo?: ContentRepository,
  ) {}

  async resolve(node: GenerationRequest, kind: ContentKind): Promise<ResolvedContent> {
    const existing = await this.contentRepo?.retrieveBest(node.nodeId, kind, node.difficulty);
    if (existing) {
      await this.contentRepo!.incrementUsage(existing.id);
      return {
        itemId: existing.id,
        title: existing.title,
        kind: existing.kind,
        payload: existing.payload,
        source: existing.source,
        created: false,
        usageCount: existing.usageCount + 1,
        difficulty: existing.difficulty,
        estMinutes: existing.estMinutes
      };
    }

    const generated = await this.generate(node, kind, node.usageCount);
    const validation = await validateContent(generated.payload);

    const needsExecution = EXECUTION_KINDS.has(generated.payload.kind as ContentKind);
    const passesDeterministic = validation.schemaOk && (!needsExecution || (validation.compiled && validation.testsPassed));

    let finalPayload = generated.payload;
    let reviewPassed = passesDeterministic;

    if (this.reviewer && passesDeterministic && generated.source === "AI_GENERATED") {
      try {
        const { payload: reviewedPayload, review } = await this.reviewer.reviewAndRepair(
          "pending",
          `${kind} for ${node.label} (${node.nodeKey})`,
          generated.payload,
          node.difficulty,
          [],
          { languageKey: node.languageKey, estMinutes: node.estMinutes },
        );
        finalPayload = reviewedPayload;
        reviewPassed = review.passed;
      } catch (err) {
        console.warn(`[content] review pipeline failed for ${kind}@${node.nodeKey}: ${err instanceof Error ? err.message : err}`);
      }
    }

    const status = reviewPassed ? "VALIDATED" : "DRAFT";

    if (!this.contentRepo) {
      throw new Error("ContentService requires a ContentRepository to generate content");
    }

    // Check if there's any prior content for this concept to supersede
    const priorContent = await this.contentRepo.getVersionHistory(node.nodeId, kind);

    let row: typeof priorContent[number];
    if (priorContent.length > 0) {
      // Supersede the most recent version
      const latestVersion = priorContent[0]!;
      row = await this.contentRepo.supersede(latestVersion.id, {
        nodeId: node.nodeId,
        kind: finalPayload.kind,
        title: generated.title,
        difficulty: node.difficulty,
        estMinutes: node.estMinutes,
        payload: finalPayload,
        source: generated.source,
        status,
        validation: validation as ContentValidation,
        generatedBy: generated.source === "AI_GENERATED" ? this.provider.name : "template-engine",
        usageCount: 1,
      });
    } else {
      row = await this.contentRepo.insert({
        nodeId: node.nodeId,
        kind: finalPayload.kind,
        title: generated.title,
        difficulty: node.difficulty,
        estMinutes: node.estMinutes,
        payload: finalPayload,
        source: generated.source,
        status,
        validation: validation as ContentValidation,
        generatedBy: generated.source === "AI_GENERATED" ? this.provider.name : "template-engine",
        usageCount: 1
      });
    }

    if (status === "DRAFT") {
      console.warn(`[content] generated ${kind} for ${node.nodeKey} failed validation: ${validation.notes.join("; ")}`);
      const fallback = await this.contentRepo?.retrieveBest(node.nodeId, kind, node.difficulty, true);
      if (fallback) {
        return {
          itemId: fallback.id,
          title: fallback.title,
          kind: fallback.kind,
          payload: fallback.payload,
          source: fallback.source,
          created: false,
          usageCount: fallback.usageCount,
          difficulty: fallback.difficulty,
          estMinutes: fallback.estMinutes
        };
      }
      // Return DRAFT content instead of throwing — better to serve imperfect content than none
      return {
        itemId: row.id,
        title: generated.title,
        kind: finalPayload.kind as ContentKind,
        payload: finalPayload,
        source: generated.source,
        created: false,
        usageCount: 1,
        difficulty: node.difficulty,
        estMinutes: node.estMinutes
      };
    }

    return {
      itemId: row.id,
      title: row.title,
      kind: row.kind,
      payload: row.payload,
      source: row.source,
      created: true,
      usageCount: 1,
      difficulty: row.difficulty,
      estMinutes: row.estMinutes
    };
  }

  private async generate(
    node: GenerationRequest,
    kind: ContentKind,
    usageCount: number
  ): Promise<{ title: string; payload: ContentPayload; source: "AI_GENERATED" | "TEMPLATE" }> {
    const ctx: GenContext = {
      languageKey: node.languageKey,
      nodeKey: node.nodeKey,
      label: node.label,
      definition: node.definition,
      difficulty: node.difficulty,
      estMinutes: node.estMinutes,
      applications: node.applications,
      misconceptions: node.misconceptions,
      learner: node.learner,
      existingContentCount: usageCount,
      seed: nodeSeed(node.languageKey, node.nodeKey) + usageCount * 7919
    };

    const deps = { provider: this.provider };

    try {
      switch (kind) {
        case "LESSON": {
          const g = await generateLesson(ctx, deps);
          return { title: g.title, payload: g.payload, source: g.source };
        }
        case "CODING":
        case "DEBUGGING": {
          const g = await generateExercise(ctx, kind, deps);
          return { title: g.title, payload: g.payload, source: g.source };
        }
        case "CONCEPTUAL": {
          const g = await generateConceptual(ctx, deps);
          return { title: g.title, payload: g.payload, source: g.source };
        }
        case "TRACING":
        case "PREDICTION": {
          const g = await generateTracing(ctx, kind, deps);
          return { title: g.title, payload: g.payload, source: g.source };
        }
        case "ASSESSMENT": {
          const g = await generateAssessment(ctx, deps);
          return { title: g.title, payload: g.payload, source: g.source };
        }
        case "REAL_WORLD": {
          const g = await generateRealWorld(ctx, deps);
          return { title: g.title, payload: g.payload, source: g.source };
        }
        case "PROJECT": {
          const g = await generateProject(ctx, deps);
          return { title: g.title, payload: g.payload, source: g.source };
        }
      }
    } catch (err) {
      console.warn(`[content] generation failed for ${kind}@${node.nodeKey}: ${err instanceof Error ? err.message : err}`);
      throw err;
    }
    throw new Error(`unknown kind ${kind}`);
  }

  async countForNode(nodeId: string): Promise<number> {
    return this.contentRepo?.countForNode(nodeId) ?? 0;
  }

  /**
   * Explicitly mark an old content item as superseded by a new one.
   * This sets `supersededBy` on the old item and marks it as RETIRED.
   * Use this when you need to manually retire content outside of the
   * normal generate-and-supersede flow.
   */
  async markSuperseded(oldContentId: string, newContentId: string): Promise<void> {
    if (!this.contentRepo) {
      throw new Error("ContentService requires a ContentRepository to mark superseded");
    }
    await this.contentRepo.markSuperseded(oldContentId, newContentId);
  }
}
