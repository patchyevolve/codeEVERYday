/**
 * Provider State Repository — persists circuit breaker and quota state
 * across process restarts using the `provider_state` table.
 */

import { eq } from "drizzle-orm";
import { providerState, type DB } from "@cpd/core";

export interface ProviderStateRecord {
  providerId: string;
  breakerState: string;
  breakerOpenedAt: Date | null;
  consecutiveFailures: number;
  lastFailureAt: Date | null;
  lastSuccessAt: Date | null;
  requestsToday: number;
  tokensToday: number;
  lastResetAt: Date;
}

export class ProviderStateRepository {
  constructor(private readonly db: DB) {}

  async findAll(): Promise<ProviderStateRecord[]> {
    const rows = await this.db.select().from(providerState);
    return rows.map((r) => ({
      providerId: r.providerId,
      breakerState: r.breakerState,
      breakerOpenedAt: r.breakerOpenedAt,
      consecutiveFailures: r.consecutiveFailures,
      lastFailureAt: r.lastFailureAt,
      lastSuccessAt: r.lastSuccessAt,
      requestsToday: r.requestsToday,
      tokensToday: r.tokensToday,
      lastResetAt: r.lastResetAt,
    }));
  }

  async upsert(record: {
    providerId: string;
    breakerState?: string;
    breakerOpenedAt?: Date | null;
    consecutiveFailures?: number;
    lastFailureAt?: Date | null;
    lastSuccessAt?: Date | null;
    requestsToday?: number;
    tokensToday?: number;
  }): Promise<void> {
    await this.db
      .insert(providerState)
      .values({
        providerId: record.providerId,
        breakerState: record.breakerState ?? "CLOSED",
        breakerOpenedAt: record.breakerOpenedAt ?? null,
        consecutiveFailures: record.consecutiveFailures ?? 0,
        lastFailureAt: record.lastFailureAt ?? null,
        lastSuccessAt: record.lastSuccessAt ?? null,
        requestsToday: record.requestsToday ?? 0,
        tokensToday: record.tokensToday ?? 0,
        lastResetAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: providerState.providerId,
        set: {
          breakerState: record.breakerState,
          breakerOpenedAt: record.breakerOpenedAt,
          consecutiveFailures: record.consecutiveFailures,
          lastFailureAt: record.lastFailureAt,
          lastSuccessAt: record.lastSuccessAt,
          requestsToday: record.requestsToday,
          tokensToday: record.tokensToday,
          updatedAt: new Date(),
        },
      });
  }

  async loadBreakerStates(): Promise<{
    providerId: string;
    breakerState: string;
    consecutiveFailures: number;
    breakerOpenedAt: Date | null;
  }[]> {
    const rows = await this.db.select().from(providerState);
    return rows.map((r) => ({
      providerId: r.providerId,
      breakerState: r.breakerState,
      consecutiveFailures: r.consecutiveFailures,
      breakerOpenedAt: r.breakerOpenedAt,
    }));
  }

  async loadQuotaStates(): Promise<{
    requestsToday: number;
    tokensToday: number;
  }[]> {
    const rows = await this.db.select().from(providerState);
    return rows.map((r) => ({
      requestsToday: r.requestsToday,
      tokensToday: r.tokensToday,
    }));
  }
}
