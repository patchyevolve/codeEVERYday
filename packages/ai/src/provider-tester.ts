/**
 * AI Provider connection tester.
 * Tests connectivity and optionally lists available models.
 */

export interface ProviderTestResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
  models?: ProviderModelInfo[];
}

export interface ProviderModelInfo {
  id: string;
  name: string;
  contextWindow?: number;
  outputLimit?: number;
}

interface ProviderDefaults {
  baseUrl: string;
  authHeader: string;
  authFormat: (apiKey: string) => Record<string, string>;
  modelsPath: string;
  parseModels: (data: unknown) => ProviderModelInfo[];
}

const PROVIDER_DEFAULTS: Record<string, ProviderDefaults> = {
  openai: {
    baseUrl: "https://api.openai.com/v1",
    authHeader: "Authorization",
    authFormat: (key) => ({ Authorization: `Bearer ${key}` }),
    modelsPath: "/models",
    parseModels: (data: unknown) => {
      const d = data as { data?: { id: string; owned_by?: string }[] };
      return (d.data ?? []).map((m) => ({ id: m.id, name: m.id }));
    },
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com",
    authHeader: "x-api-key",
    authFormat: (key) => ({ "x-api-key": key, "anthropic-version": "2023-06-01" }),
    modelsPath: "/v1/models",
    parseModels: (data: unknown) => {
      const d = data as { data?: { id: string; display_name?: string; max_tokens?: number }[] };
      return (d.data ?? []).map((m) => ({
        id: m.id,
        name: m.display_name ?? m.id,
        outputLimit: m.max_tokens,
      }));
    },
  },
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com",
    authHeader: "x-goog-api-key",
    authFormat: (key) => ({ "x-goog-api-key": key }),
    modelsPath: "/v1beta/models",
    parseModels: (data: unknown) => {
      const d = data as { models?: { name: string; displayName?: string; inputTokenLimit?: number; outputTokenLimit?: number }[] };
      return (d.models ?? []).map((m) => ({
        id: m.name.replace("models/", ""),
        name: m.displayName ?? m.name,
        contextWindow: m.inputTokenLimit,
        outputLimit: m.outputTokenLimit,
      }));
    },
  },
  ollama: {
    baseUrl: "http://localhost:11434",
    authHeader: "",
    authFormat: () => ({}),
    modelsPath: "/api/tags",
    parseModels: (data: unknown) => {
      const d = data as { models?: { name: string; model?: string; size?: number }[] };
      return (d.models ?? []).map((m) => ({ id: m.name, name: m.name }));
    },
  },
  openai_compatible: {
    baseUrl: "",
    authHeader: "Authorization",
    authFormat: (key) => ({ Authorization: `Bearer ${key}` }),
    modelsPath: "/models",
    parseModels: (data: unknown) => {
      const d = data as { data?: { id: string }[] };
      return (d.data ?? []).map((m) => ({ id: m.id, name: m.id }));
    },
  },
  custom: {
    baseUrl: "",
    authHeader: "Authorization",
    authFormat: (key) => ({ Authorization: `Bearer ${key}` }),
    modelsPath: "/models",
    parseModels: (data: unknown) => {
      const d = data as { data?: { id: string }[] };
      return (d.data ?? []).map((m) => ({ id: m.id, name: m.id }));
    },
  },
};

const CUSTOM_DEFAULTS: ProviderDefaults = {
  baseUrl: "",
  authHeader: "Authorization",
  authFormat: (key) => ({ Authorization: `Bearer ${key}` }),
  modelsPath: "/models",
  parseModels: (data: unknown) => {
    const d = data as { data?: { id: string }[] };
    return (d.data ?? []).map((m) => ({ id: m.id, name: m.id }));
  },
};

export function getProviderDefaults(type: string): ProviderDefaults {
  const defaults = PROVIDER_DEFAULTS as Record<string, ProviderDefaults | undefined>;
  return defaults[type] ?? CUSTOM_DEFAULTS;
}

/**
 * Test connection to a provider. Makes a lightweight request to verify
 * the endpoint is reachable and credentials are valid.
 */
export async function testProviderConnection(
  type: string,
  baseUrl: string,
  apiKey: string | null,
  timeoutMs = 10_000,
): Promise<ProviderTestResult> {
  const defaults = getProviderDefaults(type);
  const url = baseUrl.replace(/\/$/, "") + defaults.modelsPath;
  const headers: Record<string, string> = { ...defaults.authFormat(apiKey ?? "") };

  // Ollama doesn't need auth — test with /api/tags
  if (type === "ollama") {
    const ollamaUrl = baseUrl.replace(/\/$/, "") + "/api/tags";
    return measureLatency(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(ollamaUrl, {
          method: "GET",
          signal: controller.signal,
          headers: { "Content-Type": "application/json" },
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          return { ok: false, latencyMs: 0, error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
        }
        const data = await res.json();
        const models = defaults.parseModels(data);
        return { ok: true, latencyMs: 0, models };
      } catch (err) {
        return { ok: false, latencyMs: 0, error: err instanceof Error ? err.message : "Connection failed" };
      } finally {
        clearTimeout(timeout);
      }
    });
  }

  // For providers that need an API key
  if (!apiKey) {
    return { ok: false, latencyMs: 0, error: "API key is required" };
  }

  return measureLatency(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        headers: { ...headers, "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return { ok: false, latencyMs: 0, error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
      }
      const data = await res.json();
      const models = defaults.parseModels(data);
      return { ok: true, latencyMs: 0, models };
    } catch (err) {
      return { ok: false, latencyMs: 0, error: err instanceof Error ? err.message : "Connection failed" };
    } finally {
      clearTimeout(timeout);
    }
  });
}

/**
 * Fetch available models from a provider.
 */
export async function fetchProviderModels(
  type: string,
  baseUrl: string,
  apiKey: string | null,
  timeoutMs = 15_000,
): Promise<ProviderModelInfo[]> {
  const result = await testProviderConnection(type, baseUrl, apiKey, timeoutMs);
  if (!result.ok) {
    throw new Error(result.error ?? "Failed to fetch models");
  }
  return result.models ?? [];
}

async function measureLatency<T>(fn: () => Promise<T>): Promise<T & { latencyMs: number }> {
  const start = Date.now();
  const result = await fn();
  const latencyMs = Date.now() - start;
  return { ...result, latencyMs } as T & { latencyMs: number };
}
