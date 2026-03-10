export interface EmbeddingClientConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export class EmbeddingClient {
  private apiKey: string | null;
  private baseUrl: string;
  private model: string;

  constructor(config: EmbeddingClientConfig = {}) {
    this.apiKey = config.apiKey ?? process.env.OPENAI_API_KEY ?? null;
    this.baseUrl = config.baseUrl ?? 'https://api.openai.com/v1';
    this.model = config.model ?? 'text-embedding-3-small';
  }

  async embed(text: string): Promise<number[] | null> {
    if (!this.apiKey) return null;

    try {
      const response = await fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: text,
          model: this.model,
        }),
      });

      if (!response.ok) {
        console.error(`Embedding API error: ${response.status}`);
        return null;
      }

      const result = (await response.json()) as {
        data: { embedding: number[] }[];
      };

      return result.data[0]?.embedding ?? null;
    } catch (err) {
      console.error('Embedding failed:', (err as Error).message);
      return null;
    }
  }

  async embedBatch(texts: string[]): Promise<(number[] | null)[]> {
    if (!this.apiKey || texts.length === 0) return texts.map(() => null);

    try {
      const response = await fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: texts,
          model: this.model,
        }),
      });

      if (!response.ok) {
        console.error(`Embedding batch API error: ${response.status}`);
        return texts.map(() => null);
      }

      const result = (await response.json()) as {
        data: { embedding: number[]; index: number }[];
      };

      const embeddings: (number[] | null)[] = texts.map(() => null);
      for (const item of result.data) {
        embeddings[item.index] = item.embedding;
      }
      return embeddings;
    } catch (err) {
      console.error('Embedding batch failed:', (err as Error).message);
      return texts.map(() => null);
    }
  }

  get modelName(): string {
    return this.model;
  }

  get isConfigured(): boolean {
    return this.apiKey !== null;
  }
}
