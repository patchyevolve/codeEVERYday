/**
 * Node Repository — encapsulates all domain_nodes and domain_edges queries.
 *
 * Every query that touches these tables goes through here. This gives us:
 *   1. Single place to add caching, logging, or index hints
 *   2. Test seam: mock one interface instead of 15 raw queries
 *   3. Keeps TutorEngine focused on decision logic, not SQL
 */

import { and, eq, inArray } from "drizzle-orm";
import { domainNodes, domainEdges, type DB } from "@cpd/core";
import { expandDomainModel, insertExpansion, type DomainExpansion } from "../domain-builder.js";

export interface NodeLite {
  id: string;
  nodeKey: string;
  label: string;
  definition: string;
  applications: string[];
  misconceptions: string[];
  difficulty: number;
  estMinutes: number;
}

export class NodeRepository {
  constructor(private readonly db: DB) {}

  async findById(nodeId: string): Promise<NodeLite> {
    const [node] = await this.db.select().from(domainNodes).where(eq(domainNodes.id, nodeId));
    if (!node) throw new Error(`node ${nodeId} not found`);
    return {
      id: node.id,
      nodeKey: node.nodeKey,
      label: node.label,
      definition: node.definition,
      applications: node.applications,
      misconceptions: node.misconceptions,
      difficulty: node.difficulty,
      estMinutes: node.estMinutes,
    };
  }

  async findByIds(nodeIds: string[]): Promise<NodeLite[]> {
    if (nodeIds.length === 0) return [];
    return this.db.select().from(domainNodes).where(inArray(domainNodes.id, nodeIds));
  }

  async findByLanguageKey(languageKey: string): Promise<{ id: string; nodeKey: string; depth: number; createdAt: Date }[]> {
    return this.db
      .select({ id: domainNodes.id, nodeKey: domainNodes.nodeKey, depth: domainNodes.depth, createdAt: domainNodes.createdAt })
      .from(domainNodes)
      .where(eq(domainNodes.languageKey, languageKey))
      .orderBy(domainNodes.depth, domainNodes.createdAt);
  }

  async findKeysByLanguageKey(languageKey: string): Promise<{ id: string; nodeKey: string }[]> {
    return this.db
      .select({ id: domainNodes.id, nodeKey: domainNodes.nodeKey })
      .from(domainNodes)
      .where(eq(domainNodes.languageKey, languageKey));
  }

  async findIdByKey(nodeKey: string): Promise<string | null> {
    const [row] = await this.db
      .select({ id: domainNodes.id })
      .from(domainNodes)
      .where(eq(domainNodes.nodeKey, nodeKey));
    return row?.id ?? null;
  }

  async findKeysByIds(nodeIds: string[]): Promise<Map<string, string>> {
    if (nodeIds.length === 0) return new Map();
    const rows = await this.db
      .select({ id: domainNodes.id, nodeKey: domainNodes.nodeKey })
      .from(domainNodes)
      .where(inArray(domainNodes.id, nodeIds));
    return new Map(rows.map((r) => [r.id, r.nodeKey]));
  }

  /** Map nodeId -> list of prerequisite nodeKeys. */
  async prereqsForNodes(nodeIds: string[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (nodeIds.length === 0) return map;
    const rows = await this.db
      .select({ fromId: domainEdges.fromId, key: domainNodes.nodeKey })
      .from(domainEdges)
      .innerJoin(domainNodes, eq(domainNodes.id, domainEdges.toId))
      .where(and(eq(domainEdges.kind, "PREREQUISITE"), inArray(domainEdges.fromId, nodeIds)));
    for (const r of rows) {
      const arr = map.get(r.fromId) ?? [];
      arr.push(r.key);
      map.set(r.fromId, arr);
    }
    return map;
  }

  async findLabelsByIds(
    nodeIds: string[],
  ): Promise<{ id: string; label: string; nodeKey: string }[]> {
    if (nodeIds.length === 0) return [];
    return this.db
      .select({ id: domainNodes.id, label: domainNodes.label, nodeKey: domainNodes.nodeKey })
      .from(domainNodes)
      .where(inArray(domainNodes.id, nodeIds));
  }

  async findByKeyInLanguage(nodeKeys: string[], languageKey: string): Promise<{ nodeKey: string }[]> {
    return this.db
      .select({ nodeKey: domainNodes.nodeKey })
      .from(domainNodes)
      .where(
        and(
          eq(domainNodes.languageKey, languageKey),
          inArray(domainNodes.nodeKey, nodeKeys)
        )
      );
  }

  /** Expand the domain model for a language (delegates to domain-builder). */
  async expandDomainModel(
    languageKey: string,
    masteredNodeKeys: string[],
    domains: string[],
    learnerNodeKeys: string[]
  ): Promise<DomainExpansion> {
    return expandDomainModel(this.db, languageKey, masteredNodeKeys, domains, learnerNodeKeys);
  }

  /** Insert expanded nodes into the graph (delegates to domain-builder). */
  async insertExpansion(languageKey: string, expansion: DomainExpansion): Promise<string[]> {
    return insertExpansion(this.db, languageKey, expansion);
  }
}
