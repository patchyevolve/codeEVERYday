/**
 * Seed loader v2.
 *
 * Seed JSON is OPTIONAL provider content: a small amount of canonical
 * material that the AI tutor can reuse and expand upon. The loader
 * converts seed bundles (v1 agent-authored and v2 formats) into domain
 * nodes + content items. Coding items are sandbox-executed before being
 * marked VALIDATED; the system never serves unvalidated content.
 */

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { contentItems, domainEdges, domainNodes, languages, type ContentPayload, type DB } from "@cpd/core";
import { validateContent } from "@cpd/ai";
import { seedBundleSchema, type SeedBundle } from "./content-schema.js";
import { loadSeedBundles } from "./loader.js";

const v2ContentSchema = z.object({
  lesson: z.any().optional(),
  exercises: z.array(z.any()).optional(),
  assessment: z.any().optional()
});

const v2NodeSchema = z.object({
  nodeKey: z.string().regex(/^[a-z0-9-]+$/),
  label: z.string().min(1),
  definition: z.string().min(10),
  difficulty: z.number().int().min(1).max(5),
  estMinutes: z.number().int().positive(),
  prerequisites: z.array(z.string()).default([]),
  related: z.array(z.string()).default([]),
  applications: z.array(z.string()).default([]),
  misconceptions: z.array(z.string()).default([]),
  content: v2ContentSchema.optional()
});

const v2BundleSchema = z.object({
  version: z.number().int().positive().default(1),
  languageKey: z.enum(["cpp", "python", "java", "javascript", "typescript", "go", "rust", "c"]),
  languageName: z.string().min(1),
  nodes: z.array(v2NodeSchema).min(1)
});

function codeFromPrompt(promptMd: string | undefined): string {
  const m = promptMd?.match(/```[a-zA-Z0-9]*\n([\s\S]*?)```/);
  return m?.[1] ?? "";
}

export interface SeedNodeContent {
  nodeKey: string;
  label: string;
  definition: string;
  difficulty: number;
  estMinutes: number;
  prerequisites: string[];
  related: string[];
  applications: string[];
  misconceptions: string[];
  items: { kind: ContentPayload["kind"]; title: string; payload: ContentPayload }[];
}

/** Convert a v1 seed bundle (agent-authored JSON) into v2 node list. */
export function convertV1(bundle: SeedBundle): { languageKey: string; languageName: string; nodes: SeedNodeContent[] }[] {
  return bundle.tracks.map((track) => {
    const nodes: SeedNodeContent[] = [];
    for (const mod of track.modules) {
      for (const topic of mod.topics) {
        for (const concept of topic.concepts) {
          const items: SeedNodeContent["items"] = [];

          items.push({
            kind: "LESSON",
            title: concept.lesson.title,
            payload: { kind: "LESSON", sections: concept.lesson.content }
          });

          for (const ex of concept.exercises) {
            const harness = ex.harness ? { ...ex.harness } : null;
            const testCases = (harness && "testCases" in harness && Array.isArray((harness as { testCases?: unknown[] }).testCases)
              ? (harness as { testCases?: unknown[] }).testCases
              : undefined) as { input: unknown; expected: unknown; description?: string }[] | undefined;
            if (harness && testCases) delete (harness as { testCases?: unknown }).testCases;

            if (ex.kind === "CODING" || ex.kind === "DEBUGGING") {
              items.push({
                kind: ex.kind,
                title: ex.title,
                payload: {
                  kind: ex.kind,
                  hints: ex.hints,
                  harness,
                  testCases: testCases ?? [],
                  scaffold: ex.scaffold ?? "",
                  referenceSolution: ex.referenceSolution ?? "",
                  explanationMd: ex.explanationMd ?? "",
                  mistakePattern: ex.mistakePattern,
                  tags: ex.tags
                }
              });
            } else if (ex.kind === "CONCEPTUAL" && ex.answer?.kind === "mcq") {
              items.push({
                kind: "CONCEPTUAL",
                title: ex.title,
                payload: {
                  kind: "CONCEPTUAL",
                  options: ex.answer.options ?? [],
                  answerIndex: ex.answer.answerIndex ?? 0,
                  hints: ex.hints,
                  explanationMd: ex.explanationMd ?? ""
                }
              });
            } else if (ex.kind === "TRACING" || ex.kind === "PREDICTION") {
              items.push({
                kind: ex.kind,
                title: ex.title,
                payload: {
                  kind: ex.kind,
                  codeSnippet: ex.scaffold || codeFromPrompt(ex.promptMd),
                  acceptedAnswers: ex.answer?.kind === "text" ? ex.answer.accepted ?? [] : [],
                  explanationMd: ex.explanationMd ?? "",
                  hints: ex.hints
                }
              });
            } else {
              // CONCEPTUAL with text answer or unknown: keep as CONCEPTUAL MCQ-less is invalid — skip
              console.warn(`[seed] skipping unsupported exercise "${ex.title}" (kind=${ex.kind}, answer=${JSON.stringify(ex.answer)})`);
            }
          }

          items.push({
            kind: "ASSESSMENT",
            title: concept.assessment.title,
            payload: {
              kind: "ASSESSMENT",
              questions: concept.assessment.questions,
              passThreshold: concept.assessment.passThreshold
            }
          });

          nodes.push({
            nodeKey: concept.slug,
            label: concept.title,
            definition: concept.description,
            difficulty: concept.difficulty,
            estMinutes: concept.estMinutes,
            prerequisites: concept.prerequisites,
            related: [],
            applications: [],
            misconceptions: [],
            items
          });
        }
      }
    }
    return { languageKey: track.languageKey, languageName: track.languageName, nodes };
  });
}

export interface SeedResultV2 {
  languages: string[];
  nodes: number;
  items: number;
  validated: number;
  drafts: number;
}

export async function seedV2(db: DB, bundles: SeedBundle[] = loadSeedBundles(), v2Files: string[] = []): Promise<SeedResultV2> {
  const result: SeedResultV2 = { languages: [], nodes: 0, items: 0, validated: 0, drafts: 0 };

  const groups: { languageKey: string; languageName: string; nodes: SeedNodeContent[] }[] = [];

  for (const bundle of bundles) {
    const conv = convertV1(bundle);
    groups.push(...conv);
  }

  for (const file of v2Files) {
    const raw = JSON.parse(await import("node:fs/promises").then((fs) => fs.readFile(file, "utf8")));
    const parsed = v2BundleSchema.parse(raw);
    const nodes: SeedNodeContent[] = parsed.nodes.map((n) => {
      const items: SeedNodeContent["items"] = [];
      if (n.content?.lesson) {
        items.push({ kind: "LESSON", title: n.content.lesson.title, payload: { kind: "LESSON", sections: n.content.lesson.content } });
      }
      for (const ex of n.content?.exercises ?? []) {
        const harness = ex.harness ? { ...ex.harness } : null;
        const testCases = harness && "testCases" in harness && Array.isArray((harness as { testCases?: unknown[] }).testCases)
          ? ((harness as { testCases?: unknown[] }).testCases as { input: unknown; expected: unknown; description?: string }[])
          : [];
        if (harness) delete (harness as { testCases?: unknown }).testCases;
        if (ex.kind === "CODING" || ex.kind === "DEBUGGING") {
          items.push({
            kind: ex.kind,
            title: ex.title,
            payload: {
              kind: ex.kind,
              hints: ex.hints ?? [],
              harness,
              testCases,
              scaffold: ex.scaffold ?? "",
              referenceSolution: ex.referenceSolution ?? "",
              explanationMd: ex.explanationMd ?? "",
              mistakePattern: ex.mistakePattern,
              tags: ex.tags ?? []
            }
          });
        } else if (ex.kind === "CONCEPTUAL") {
          items.push({
            kind: "CONCEPTUAL",
            title: ex.title,
            payload: {
              kind: "CONCEPTUAL",
              options: ex.answer?.options ?? [],
              answerIndex: ex.answer?.answerIndex ?? 0,
              hints: ex.hints ?? [],
              explanationMd: ex.explanationMd ?? ""
            }
          });
        } else if (ex.kind === "TRACING" || ex.kind === "PREDICTION") {
          items.push({
            kind: ex.kind,
            title: ex.title,
            payload: {
              kind: ex.kind,
              codeSnippet: ex.scaffold || codeFromPrompt(ex.promptMd ?? ""),
              acceptedAnswers: ex.answer?.accepted ?? [],
              explanationMd: ex.explanationMd ?? "",
              hints: ex.hints ?? []
            }
          });
        }
      }
      if (n.content?.assessment) {
        items.push({
          kind: "ASSESSMENT",
          title: n.content.assessment.title,
          payload: {
            kind: "ASSESSMENT",
            questions: n.content.assessment.questions,
            passThreshold: n.content.assessment.passThreshold ?? 0.7
          }
        });
      }
      return {
        nodeKey: n.nodeKey,
        label: n.label,
        definition: n.definition,
        difficulty: n.difficulty,
        estMinutes: n.estMinutes,
        prerequisites: n.prerequisites,
        related: n.related,
        applications: n.applications,
        misconceptions: n.misconceptions,
        items
      };
    });
    groups.push({ languageKey: parsed.languageKey, languageName: parsed.languageName, nodes });
  }

  for (const group of groups) {
    const [lang] = await db
      .insert(languages)
      .values({ key: group.languageKey, name: group.languageName })
      .onConflictDoUpdate({ target: languages.key, set: { name: group.languageName } })
      .returning({ id: languages.id });

    const existingNodes = await db
      .select({ id: domainNodes.id, nodeKey: domainNodes.nodeKey })
      .from(domainNodes)
      .where(eq(domainNodes.languageKey, group.languageKey));
    const byKey = new Map(existingNodes.map((n) => [n.nodeKey, n.id]));

    // delete existing PROVIDER_SEED content for nodes being re-seeded
    for (const node of group.nodes) {
      const existingId = byKey.get(node.nodeKey);
      if (existingId) {
        await db.delete(contentItems).where(and(eq(contentItems.nodeId, existingId), eq(contentItems.source, "PROVIDER_SEED")));
      }
    }

    for (const node of group.nodes) {
      let nodeId = byKey.get(node.nodeKey);
      if (!nodeId) {
        const [row] = await db
          .insert(domainNodes)
          .values({
            languageKey: group.languageKey,
            nodeKey: node.nodeKey,
            label: node.label,
            definition: node.definition,
            difficulty: node.difficulty,
            estMinutes: node.estMinutes,
            status: "MODELED",
            source: "PROVIDER_SEED",
            applications: node.applications,
            misconceptions: node.misconceptions
          })
          .returning({ id: domainNodes.id });
        nodeId = row!.id;
        byKey.set(node.nodeKey, nodeId);
      }
      result.nodes++;

      for (const item of node.items) {
        const validation = await validateContent(item.payload, { minTestCases: 1 });
        const needsExecution = item.kind === "CODING" || item.kind === "DEBUGGING";
        const status = validation.schemaOk && (!needsExecution || (validation.compiled && validation.testsPassed))
          ? "VALIDATED"
          : "DRAFT";
        await db.insert(contentItems).values({
          nodeId,
          kind: item.kind,
          title: item.title,
          difficulty: node.difficulty,
          estMinutes: node.estMinutes,
          payload: item.payload,
          source: "PROVIDER_SEED",
          status,
          validation,
          generatedBy: "seed-v2"
        });
        result.items++;
        if (status === "VALIDATED") result.validated++;
        else {
          result.drafts++;
          console.warn(`[seed] ${item.kind} "${item.title}" @ ${node.nodeKey} → DRAFT: ${validation.notes.join("; ").slice(0, 200)}`);
        }
      }

      for (const prereq of node.prerequisites) {
        const pid = byKey.get(prereq);
        if (pid && pid !== nodeId) {
          await db.insert(domainEdges).values({ fromId: pid, toId: nodeId, kind: "PREREQUISITE" }).onConflictDoNothing();
        }
      }
      for (const rel of node.related) {
        const rid = byKey.get(rel);
        if (rid && rid !== nodeId) {
          await db.insert(domainEdges).values({ fromId: nodeId, toId: rid, kind: "RELATED" }).onConflictDoNothing();
        }
      }
    }

    result.languages.push(group.languageKey);
  }

  return result;
}