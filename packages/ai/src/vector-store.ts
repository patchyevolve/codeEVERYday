/**
 * Vector store for semantic memory search.
 * Stores embeddings in-memory with cosine similarity search.
 * Can be extended to use pgvector for persistent storage.
 */
import { getEmbeddingProvider, cosineSimilarity, type EmbeddingProvider } from "./embeddings.js";

export interface VectorDocument {
  id: string;
  store: string;
  kind: string;
  content: string;
  metadata: Record<string, unknown>;
  embedding?: number[];
  createdAt: Date;
}

export interface VectorSearchResult {
  document: VectorDocument;
  score: number;
}

export interface VectorStoreConfig {
  embeddingProvider?: EmbeddingProvider;
}

export class VectorStore {
  private documents: VectorDocument[] = [];
  private embeddingProvider: EmbeddingProvider;

  constructor(config?: VectorStoreConfig) {
    this.embeddingProvider = config?.embeddingProvider ?? getEmbeddingProvider();
  }

  async addDocument(doc: Omit<VectorDocument, "embedding" | "createdAt">): Promise<void> {
    const embedding = await this.embeddingProvider.embed(doc.content);
    this.documents.push({
      ...doc,
      embedding,
      createdAt: new Date(),
    });
  }

  async addDocuments(docs: Omit<VectorDocument, "embedding" | "createdAt">[]): Promise<void> {
    const embeddings = await this.embeddingProvider.embedBatch(docs.map((d) => d.content));
    for (let i = 0; i < docs.length; i++) {
      this.documents.push({
        ...docs[i]!,
        embedding: embeddings[i],
        createdAt: new Date(),
      });
    }
  }

  async search(query: string, options: { limit?: number; store?: string; minScore?: number } = {}): Promise<VectorSearchResult[]> {
    const { limit = 10, store, minScore = 0.3 } = options;
    const queryEmbedding = await this.embeddingProvider.embed(query);

    let candidates = this.documents;
    if (store) {
      candidates = candidates.filter((d) => d.store === store);
    }

    const results: VectorSearchResult[] = [];
    for (const doc of candidates) {
      if (!doc.embedding) continue;
      const score = cosineSimilarity(queryEmbedding, doc.embedding);
      if (score >= minScore) {
        results.push({ document: doc, score });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  async deleteDocument(id: string): Promise<void> {
    this.documents = this.documents.filter((d) => d.id !== id);
  }

  async deleteByStore(store: string): Promise<void> {
    this.documents = this.documents.filter((d) => d.store !== store);
  }

  get size(): number {
    return this.documents.length;
  }
}
