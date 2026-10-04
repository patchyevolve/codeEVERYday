/**
 * Streaming AI provider that supports SSE-based streaming from multiple providers.
 * Falls back to non-streaming if the provider doesn't support streaming.
 */
import type { ChatMessage, StreamChunk, CompletionOptions } from "./contracts.js";
import { ProviderError } from "./provider.js";
import { getAdapter, type ProviderAdapter } from "./provider-adapters.js";

export interface StreamingProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  providerType?: string;
  timeoutMs?: number;
}

export class StreamingProvider {
  private readonly adapter: ProviderAdapter;
  private readonly config: StreamingProviderConfig;

  constructor(config: StreamingProviderConfig) {
    this.config = config;
    this.adapter = getAdapter(config.providerType ?? "openai");
  }

  /** Create a streaming iterable for the given messages. */
  stream(messages: ChatMessage[], opts?: CompletionOptions): AsyncIterable<StreamChunk> {
    const adapter = this.adapter;
    const config = this.config;
    const resolvedOpts = opts ?? {};

    return {
      async *[Symbol.asyncIterator](): AsyncGenerator<StreamChunk> {
        const url = adapter.buildUrl(config.baseUrl);
        const headers = adapter.buildHeaders(config.apiKey);
        const body = adapter.buildBody(messages, config.model, resolvedOpts);

        const controller = new AbortController();
        const timeoutMs = config.timeoutMs ?? 120_000;
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        try {
          let finalUrl = url;
          if (adapter.name === "anthropic") {
            finalUrl = `${url}?key=${config.apiKey}`;
          }
          if (adapter.name === "gemini") {
            finalUrl = `${url}?key=${config.apiKey}`;
          }

          const res = await fetch(finalUrl, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: controller.signal,
          });

          if (!res.ok) {
            const text = await res.text().catch(() => "");
            throw new ProviderError(`Streaming provider HTTP ${res.status}: ${text.slice(0, 300)}`, res.status >= 500);
          }

          if (!res.body) {
            throw new ProviderError("No response body for streaming");
          }

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;

              const chunk = adapter.parseSSELine(trimmed);
              if (chunk) {
                if (chunk.done) {
                  yield { content: "", done: true, usage: chunk.usage };
                  return;
                }
                if (chunk.content) {
                  yield chunk;
                }
              }
            }
          }

          if (buffer.trim()) {
            const chunk = adapter.parseSSELine(buffer.trim());
            if (chunk) {
              yield chunk;
            }
          }
        } finally {
          clearTimeout(timeout);
        }
      },
    };
  }

  /** Collect all chunks into a single string (non-streaming fallback). */
  async collect(messages: ChatMessage[], opts?: CompletionOptions): Promise<string> {
    let result = "";

    const url = this.adapter.buildUrl(this.config.baseUrl);
    const headers = this.adapter.buildHeaders(this.config.apiKey);
    const body = this.adapter.buildBody(messages, this.config.model, opts ?? {});

    const controller = new AbortController();
    const timeoutMs = this.config.timeoutMs ?? 120_000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      let finalUrl = url;
      if (this.adapter.name === "anthropic") {
        finalUrl = `${url}?key=${this.config.apiKey}`;
      }
      if (this.adapter.name === "gemini") {
        finalUrl = `${url}?key=${this.config.apiKey}`;
      }

      const res = await fetch(finalUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new ProviderError(`Streaming provider HTTP ${res.status}: ${text.slice(0, 300)}`, res.status >= 500);
      }

      if (!res.body) {
        throw new ProviderError("No response body for streaming");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          const chunk = this.adapter.parseSSELine(trimmed);
          if (chunk) {
            if (chunk.content) result += chunk.content;
            if (chunk.done) return result;
          }
        }
      }

      return result;
    } finally {
      clearTimeout(timeout);
    }
  }
}
