/**
 * Embedding generation for semantic search.
 * Supports OpenAI embeddings API and local fallback.
 */

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  readonly dimensions: number;
}

export interface EmbeddingConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  dimensions?: number;
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions: number;

  constructor(private config: EmbeddingConfig) {
    this.dimensions = config.dimensions ?? 1536;
  }

  async embed(text: string): Promise<number[]> {
    const vectors = await this.embedBatch([text]);
    return vectors[0] ?? [];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const url = `${this.config.baseUrl.replace(/\/$/, "")}/embeddings`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        input: texts,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Embedding API error ${res.status}: ${body.slice(0, 300)}`);
    }

    const data = (await res.json()) as { data?: { embedding?: number[] }[] };
    return data.data?.map((d) => d.embedding ?? []) ?? [];
  }
}

/** Deterministic hash-based embedding for offline/local mode */
export class HashEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 384;

  async embed(text: string): Promise<number[]> {
    return this.hashToVector(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.hashToVector(t));
  }

  private hashToVector(text: string): number[] {
    const vector = new Array<number>(this.dimensions).fill(0);
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      const idx1 = i % this.dimensions;
      const idx2 = (i * 7 + 13) % this.dimensions;
      vector[idx1] = (vector[idx1] ?? 0) + char;
      vector[idx2] = (vector[idx2] ?? 0) ^ char;
    }
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    return norm > 0 ? vector.map((v) => v / norm) : vector;
  }
}

let _embeddingProvider: EmbeddingProvider | null = null;

export function getEmbeddingProvider(): EmbeddingProvider {
  if (!_embeddingProvider) {
    const baseUrl = process.env.AI_EMBEDDING_URL ?? process.env.AI_BASE_URL ?? "";
    const apiKey = process.env.AI_EMBEDDING_API_KEY ?? process.env.AI_API_KEY ?? "";
    const model = process.env.AI_EMBEDDING_MODEL ?? "text-embedding-3-small";

    if (baseUrl && apiKey) {
      _embeddingProvider = new OpenAIEmbeddingProvider({ baseUrl, apiKey, model });
    } else {
      _embeddingProvider = new HashEmbeddingProvider();
    }
  }
  return _embeddingProvider;
}

export function resetEmbeddingProvider(): void {
  _embeddingProvider = null;
}

/** Cosine similarity between two vectors */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dotProduct += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  const norm = Math.sqrt(normA) * Math.sqrt(normB);
  return norm > 0 ? dotProduct / norm : 0;
}
