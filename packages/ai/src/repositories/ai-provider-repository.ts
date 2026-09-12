import { eq, asc, desc, sql } from "drizzle-orm";
import { aiProviders, aiProviderModels, type DB } from "@cpd/core";

export interface AIProviderConfig {
  id: string;
  providerType: string;
  displayName: string;
  baseUrl: string;
  apiKeyEncrypted: string | null;
  enabled: boolean;
  priority: number;
  config: Record<string, unknown>;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AIProviderModelConfig {
  id: string;
  providerId: string;
  modelId: string;
  displayName: string;
  capabilities: Record<string, unknown>;
  contextWindow: number;
  outputLimit: number;
  costPer1kIn: number;
  costPer1kOut: number;
  enabled: boolean;
  createdAt: Date;
}

export interface CreateProviderInput {
  providerType: string;
  displayName: string;
  baseUrl: string;
  apiKeyEncrypted?: string | null;
  enabled?: boolean;
  priority?: number;
  config?: Record<string, unknown>;
  createdBy: string;
}

export interface UpdateProviderInput {
  displayName?: string;
  baseUrl?: string;
  apiKeyEncrypted?: string | null;
  enabled?: boolean;
  priority?: number;
  config?: Record<string, unknown>;
}

export interface UpsertModelInput {
  modelId: string;
  displayName: string;
  capabilities?: Record<string, unknown>;
  contextWindow?: number;
  outputLimit?: number;
  costPer1kIn?: number;
  costPer1kOut?: number;
  enabled?: boolean;
}

export class AIProviderRepository {
  constructor(private readonly db: DB) {}

  async findAll(): Promise<AIProviderConfig[]> {
    return this.db
      .select()
      .from(aiProviders)
      .orderBy(asc(aiProviders.priority), desc(aiProviders.createdAt)) as Promise<AIProviderConfig[]>;
  }

  async findById(id: string): Promise<AIProviderConfig | null> {
    const [row] = await this.db
      .select()
      .from(aiProviders)
      .where(eq(aiProviders.id, id))
      .limit(1);
    return (row as AIProviderConfig) ?? null;
  }

  async findEnabled(): Promise<AIProviderConfig[]> {
    return this.db
      .select()
      .from(aiProviders)
      .where(eq(aiProviders.enabled, true))
      .orderBy(asc(aiProviders.priority)) as Promise<AIProviderConfig[]>;
  }

  async create(input: CreateProviderInput): Promise<AIProviderConfig> {
    const [row] = await this.db
      .insert(aiProviders)
      .values({
        providerType: input.providerType,
        displayName: input.displayName,
        baseUrl: input.baseUrl,
        apiKeyEncrypted: input.apiKeyEncrypted ?? null,
        enabled: input.enabled ?? true,
        priority: input.priority ?? 0,
        config: input.config ?? {},
        createdBy: input.createdBy,
      })
      .returning();
    return row as AIProviderConfig;
  }

  async update(id: string, input: UpdateProviderInput): Promise<AIProviderConfig | null> {
    const [row] = await this.db
      .update(aiProviders)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(aiProviders.id, id))
      .returning();
    return (row as AIProviderConfig) ?? null;
  }

  async delete(id: string): Promise<boolean> {
    const [row] = await this.db
      .delete(aiProviders)
      .where(eq(aiProviders.id, id))
      .returning();
    return !!row;
  }

  async upsertModels(providerId: string, models: UpsertModelInput[]): Promise<void> {
    for (const m of models) {
      await this.db
        .insert(aiProviderModels)
        .values({
          providerId,
          modelId: m.modelId,
          displayName: m.displayName,
          capabilities: m.capabilities ?? {},
          contextWindow: m.contextWindow ?? 4096,
          outputLimit: m.outputLimit ?? 4096,
          costPer1kIn: m.costPer1kIn ?? 0,
          costPer1kOut: m.costPer1kOut ?? 0,
          enabled: m.enabled ?? true,
        })
        .onConflictDoUpdate({
          target: [aiProviderModels.providerId, aiProviderModels.modelId],
          set: {
            displayName: m.displayName,
            capabilities: m.capabilities ?? {},
            contextWindow: m.contextWindow ?? 4096,
            outputLimit: m.outputLimit ?? 4096,
            costPer1kIn: m.costPer1kIn ?? 0,
            costPer1kOut: m.costPer1kOut ?? 0,
            enabled: m.enabled ?? true,
          },
        });
    }
  }

  async findModelsByProviderId(providerId: string): Promise<AIProviderModelConfig[]> {
    return this.db
      .select()
      .from(aiProviderModels)
      .where(eq(aiProviderModels.providerId, providerId))
      .orderBy(asc(aiProviderModels.modelId)) as Promise<AIProviderModelConfig[]>;
  }

  async deleteModelsByProviderId(providerId: string): Promise<void> {
    await this.db
      .delete(aiProviderModels)
      .where(eq(aiProviderModels.providerId, providerId));
  }
}
