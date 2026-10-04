/**
 * Provider-specific streaming adapters.
 * Each provider has a different SSE format for streaming responses.
 */
import type { ChatMessage, StreamChunk, CompletionOptions } from "./contracts.js";

export interface ProviderAdapter {
  readonly name: string;
  buildHeaders(apiKey: string): Record<string, string>;
  buildBody(messages: ChatMessage[], model: string, opts: CompletionOptions): Record<string, unknown>;
  buildUrl(baseUrl: string): string;
  parseSSELine(line: string): StreamChunk | null;
}

/** OpenAI-compatible adapter (works for OpenAI, Ollama, vLLM, etc.) */
export class OpenAIAdapter implements ProviderAdapter {
  readonly name = "openai";

  buildHeaders(apiKey: string): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    };
  }

  buildBody(messages: ChatMessage[], model: string, opts: CompletionOptions): Record<string, unknown> {
    return {
      model,
      messages,
      stream: true,
      temperature: opts.temperature ?? 0.4,
      max_tokens: opts.maxTokens ?? 4096,
      ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
    };
  }

  buildUrl(baseUrl: string): string {
    return `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  }

  parseSSELine(line: string): StreamChunk | null {
    if (!line.startsWith("data: ")) return null;
    const data = line.slice(6).trim();
    if (data === "[DONE]") return { content: "", done: true, usage: undefined };

    try {
      const parsed = JSON.parse(data);
      const delta = parsed.choices?.[0]?.delta?.content;
      const finishReason = parsed.choices?.[0]?.finish_reason;
      return {
        content: delta ?? "",
        done: finishReason === "stop" || finishReason === "length",
        usage: parsed.usage ? { in: parsed.usage.prompt_tokens ?? 0, out: parsed.usage.completion_tokens ?? 0 } : undefined,
      };
    } catch {
      return null;
    }
  }
}

/** Anthropic adapter (different API format) */
export class AnthropicAdapter implements ProviderAdapter {
  readonly name = "anthropic";

  buildHeaders(apiKey: string): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    };
  }

  buildBody(messages: ChatMessage[], model: string, opts: CompletionOptions): Record<string, unknown> {
    const systemMsg = messages.find((m) => m.role === "system");
    const nonSystemMsgs = messages.filter((m) => m.role !== "system");

    return {
      model,
      max_tokens: opts.maxTokens ?? 4096,
      stream: true,
      ...(systemMsg ? { system: systemMsg.content } : {}),
      messages: nonSystemMsgs.map((m) => ({ role: m.role, content: m.content })),
      temperature: opts.temperature ?? 0.4,
    };
  }

  buildUrl(baseUrl: string): string {
    return `${baseUrl.replace(/\/$/, "")}/v1/messages`;
  }

  parseSSELine(line: string): StreamChunk | null {
    if (!line.startsWith("data: ")) return null;
    const data = line.slice(6).trim();

    try {
      const parsed = JSON.parse(data);

      if (parsed.type === "content_block_delta") {
        return { content: parsed.delta?.text ?? "", done: false };
      }
      if (parsed.type === "message_stop") {
        return { content: "", done: true };
      }
      if (parsed.type === "message_delta" && parsed.usage) {
        return { content: "", done: true, usage: { in: parsed.usage.input_tokens ?? 0, out: parsed.usage.output_tokens ?? 0 } };
      }
      return null;
    } catch {
      return null;
    }
  }
}

/** Gemini adapter (Google AI format) */
export class GeminiAdapter implements ProviderAdapter {
  readonly name = "gemini";

  buildHeaders(apiKey: string): Record<string, string> {
    return {
      "Content-Type": "application/json",
    };
  }

  buildBody(messages: ChatMessage[], model: string, opts: CompletionOptions): Record<string, unknown> {
    const contents = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

    const systemInstruction = messages.find((m) => m.role === "system");

    return {
      contents,
      ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction.content }] } } : {}),
      generationConfig: {
        temperature: opts.temperature ?? 0.4,
        maxOutputTokens: opts.maxTokens ?? 4096,
        ...(opts.jsonMode ? { responseMimeType: "application/json" } : {}),
      },
    };
  }

  buildUrl(baseUrl: string): string {
    return `${baseUrl.replace(/\/$/, "")}`;
  }

  parseSSELine(line: string): StreamChunk | null {
    if (!line.startsWith("data: ")) return null;
    const data = line.slice(6).trim();

    try {
      const parsed = JSON.parse(data);
      const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
      const finishReason = parsed.candidates?.[0]?.finishReason;
      return {
        content: text ?? "",
        done: finishReason === "STOP" || finishReason === "MAX_TOKENS",
        usage: parsed.usageMetadata ? { in: parsed.usageMetadata.promptTokenCount ?? 0, out: parsed.usageMetadata.candidatesTokenCount ?? 0 } : undefined,
      };
    } catch {
      return null;
    }
  }
}

/** Ollama adapter (local models) */
export class OllamaAdapter implements ProviderAdapter {
  readonly name = "ollama";

  buildHeaders(apiKey: string): Record<string, string> {
    return { "Content-Type": "application/json" };
  }

  buildBody(messages: ChatMessage[], model: string, opts: CompletionOptions): Record<string, unknown> {
    return {
      model,
      messages,
      stream: true,
      options: {
        temperature: opts.temperature ?? 0.4,
        num_predict: opts.maxTokens ?? 4096,
      },
    };
  }

  buildUrl(baseUrl: string): string {
    return `${baseUrl.replace(/\/$/, "")}/api/chat`;
  }

  parseSSELine(line: string): StreamChunk | null {
    try {
      const parsed = JSON.parse(line);
      return {
        content: parsed.message?.content ?? "",
        done: parsed.done ?? false,
        usage: parsed.eval_count ? { in: parsed.prompt_eval_count ?? 0, out: parsed.eval_count ?? 0 } : undefined,
      };
    } catch {
      return null;
    }
  }
}

/** Custom/OpenAI-compatible adapter */
export class CustomAdapter implements ProviderAdapter {
  readonly name = "custom";

  buildHeaders(apiKey: string): Record<string, string> {
    return new OpenAIAdapter().buildHeaders(apiKey);
  }

  buildBody(messages: ChatMessage[], model: string, opts: CompletionOptions): Record<string, unknown> {
    return new OpenAIAdapter().buildBody(messages, model, opts);
  }

  buildUrl(baseUrl: string): string {
    return new OpenAIAdapter().buildUrl(baseUrl);
  }

  parseSSELine(line: string): StreamChunk | null {
    return new OpenAIAdapter().parseSSELine(line);
  }
}

/** Get adapter for a provider type */
export function getAdapter(providerType: string): ProviderAdapter {
  switch (providerType.toLowerCase()) {
    case "anthropic": return new AnthropicAdapter();
    case "gemini": return new GeminiAdapter();
    case "ollama": return new OllamaAdapter();
    case "openai":
    case "openai-compatible":
    case "custom":
    default: return new OpenAIAdapter();
  }
}
