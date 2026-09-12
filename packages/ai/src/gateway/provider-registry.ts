import type {
  ModelCapabilities,
  ProviderConfig,
  ProviderModel,
} from "../contracts.js";

function loadDefaultCapabilities(): ModelCapabilities {
  return {
    structuredOutput: false,
    streaming: false,
    toolCalling: false,
    code: false,
    fastLatency: false,
    vision: false,
  };
}

function buildDefaultModel(
  providerId: string,
  modelId: string,
): ProviderModel {
  return {
    providerId,
    modelId,
    displayName: modelId,
    capabilities: loadDefaultCapabilities(),
    contextWindow: 128_000,
    outputLimit: 4_096,
    costPer1kIn: 0,
    costPer1kOut: 0,
    avgLatencyMs: 0,
    rateLimits: { rpm: 60, tpm: 100_000, rpd: 10_000, tpd: 10_000_000 },
    enabled: true,
  };
}

function loadFromEnv(): ProviderConfig[] {
  const raw = process.env.AI_PROVIDERS;
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed as ProviderConfig[];
      }
    } catch {
      console.warn("[provider-registry] AI_PROVIDERS JSON parse failed, falling back to legacy env");
    }
  }

  const baseUrl = process.env.AI_BASE_URL;
  const apiKey = process.env.AI_API_KEY;
  const model = process.env.AI_MODEL ?? "gpt-4o-mini";
  const enabled = (process.env.AI_ENABLED ?? "true") !== "false";

  if (!baseUrl || !apiKey) return [];

  const providerId = "default";
  const providerModel = buildDefaultModel(providerId, model);

  return [
    {
      providerId,
      displayName: "Default Provider",
      baseUrl,
      apiKey,
      models: [providerModel],
      enabled,
    },
  ];
}

export class ProviderRegistry {
  private providers = new Map<string, ProviderConfig>();

  constructor() {
    const defaults = loadFromEnv();
    for (const config of defaults) {
      this.providers.set(config.providerId, config);
    }
  }

  registerProvider(config: ProviderConfig): void {
    this.providers.set(config.providerId, config);
  }

  getProvider(providerId: string): ProviderConfig | undefined {
    return this.providers.get(providerId);
  }

  listProviders(): ProviderConfig[] {
    return Array.from(this.providers.values()).filter((p) => p.enabled);
  }

  listModels(providerId?: string): ProviderModel[] {
    const providers = providerId
      ? this.providers.get(providerId)
        ? [this.providers.get(providerId)!]
        : []
      : Array.from(this.providers.values());

    return providers
      .filter((p) => p.enabled)
      .flatMap((p) => p.models.filter((m) => m.enabled));
  }

  findModelsByCapabilities(
    capabilities: Partial<ModelCapabilities>,
  ): ProviderModel[] {
    return this.listModels().filter((m) => {
      for (const [key, required] of Object.entries(capabilities)) {
        if (required && !m.capabilities[key as keyof ModelCapabilities]) {
          return false;
        }
      }
      return true;
    });
  }

  getModel(providerId: string, modelId: string): ProviderModel | undefined {
    const provider = this.providers.get(providerId);
    return provider?.models.find((m) => m.modelId === modelId);
  }

  isModelAvailable(providerId: string, modelId: string): boolean {
    const provider = this.providers.get(providerId);
    if (!provider?.enabled) return false;
    const model = provider.models.find((m) => m.modelId === modelId);
    return model?.enabled === true;
  }
}
