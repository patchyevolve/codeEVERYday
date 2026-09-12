/**
 * Evidence helpers — thin wrappers that delegate to EvidenceRepository.
 *
 * Preserves backward compatibility for any code that imports these
 * standalone functions directly.
 */

import { EvidenceRepository } from "./repositories/evidence-repository.js";
import type { DB } from "@cpd/core";
import type { EvidenceEvent, EvidenceType } from "./contracts.js";

type EvidenceInsert = Omit<EvidenceEvent, "id" | "observedAt">;

export async function recordEvidence(db: DB, event: EvidenceInsert): Promise<EvidenceEvent> {
  return new EvidenceRepository(db).record(event);
}

export async function recordBulk(db: DB, events: EvidenceInsert[]): Promise<EvidenceEvent[]> {
  return new EvidenceRepository(db).recordBulk(events);
}

export async function getEvidenceForSession(db: DB, sessionId: string): Promise<EvidenceEvent[]> {
  return new EvidenceRepository(db).findBySession(sessionId);
}

export async function getEvidenceForUser(
  db: DB,
  userId: string,
  opts?: { concept?: string; since?: Date; limit?: number },
): Promise<EvidenceEvent[]> {
  return new EvidenceRepository(db).findByUser(userId, opts);
}

export async function getEvidenceByType(
  db: DB,
  userId: string,
  type: EvidenceType,
  opts?: { since?: Date; limit?: number },
): Promise<EvidenceEvent[]> {
  return new EvidenceRepository(db).findByType(userId, type, opts);
}

export async function getConceptEvidence(db: DB, userId: string, concept: string): Promise<EvidenceEvent[]> {
  return new EvidenceRepository(db).findByConcept(userId, concept);
}
