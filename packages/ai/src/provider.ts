/**
 * AI provider abstraction.
 *
 * The application must not depend on one specific model. Providers implement
 * a minimal interface; the OpenAI-compatible HTTP provider works with OpenAI,
 * local gateways (vLLM, Ollama), and hosted compatible endpoints.
 *
 * When no provider is configured the system falls back to deterministic
 * TEMPLATE generation so the product remains fully functional offline.
 */

import { z } from "zod";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompletionOptions {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /** Ask the provider for structured JSON output (JSON mode / response_format). */
  jsonMode?: boolean;
}

export interface AIProvider {
  readonly name: string;
  readonly configured: boolean;
  chat(messages: ChatMessage[], opts?: CompletionOptions): Promise<string>;
}

export class ProviderError extends Error {
  constructor(message: string, public readonly retryable: boolean = false) {
    super(message);
    this.name = "ProviderError";
  }
}

const env = {
  baseUrl: process.env.AI_BASE_URL ?? "",
  apiKey: process.env.AI_API_KEY ?? "",
  model: process.env.AI_MODEL ?? "gpt-4o-mini",
  timeoutMs: Number(process.env.AI_TIMEOUT_MS ?? 90_000),
  enabled: (process.env.AI_ENABLED ?? "true") !== "false"
};

export function aiConfig() {
  return { ...env };
}

class OpenAICompatibleProvider implements AIProvider {
  readonly name = `openai-compatible:${env.model}`;
  readonly configured = true;

  async chat(messages: ChatMessage[], opts: CompletionOptions = {}): Promise<string> {
    const url = `${env.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const controller = new AbortController();
    const timeoutMs = opts.timeoutMs ?? env.timeoutMs;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.apiKey}`
        },
        body: JSON.stringify({
          model: env.model,
          messages,
          temperature: opts.temperature ?? 0.4,
          max_tokens: opts.maxTokens ?? 4096,
          ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {})
        }),
        signal: controller.signal
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new ProviderError(`Provider HTTP ${res.status}: ${body.slice(0, 300)}`, res.status >= 500);
      }
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new ProviderError("Empty completion");
      return content;
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new ProviderError(`Provider timeout after ${timeoutMs}ms`, true);
      }
      throw new ProviderError(`Provider request failed: ${err instanceof Error ? err.message : "unknown"}`, true);
    } finally {
      clearTimeout(timeout);
    }
  }
}

class NullProvider implements AIProvider {
  readonly name = "none";
  readonly configured = false;

  chat(): Promise<string> {
    return Promise.reject(new ProviderError("No AI provider configured (set AI_BASE_URL + AI_API_KEY)"));
  }
}

let _provider: AIProvider | null = null;

export function getProvider(): AIProvider {
  if (!_provider) {
    _provider = env.enabled && env.baseUrl && env.apiKey ? new OpenAICompatibleProvider() : new NullProvider();
  }
  return _provider;
}

/** Reset cached provider (used in tests). */
export function resetProvider(): void {
  _provider = null;
}

/**
 * Ask the provider for structured JSON and validate it against a zod schema.
 * Returns null when the provider is not configured or output is invalid.
 */
export async function structured<T>(
  schema: z.ZodType<T>,
  messages: ChatMessage[],
  opts: CompletionOptions = {}
): Promise<T | null> {
  const provider = getProvider();
  if (!provider.configured) return null;
  try {
    const raw = await provider.chat(messages, { ...opts, jsonMode: true });
    const parsed = JSON.parse(raw);
    const result = schema.safeParse(parsed);
    if (!result.success) {
      console.warn(`[ai] structured output failed validation: ${result.error.message.slice(0, 500)}`);
      return null;
    }
    return result.data;
  } catch (err) {
    console.warn(`[ai] provider error: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}