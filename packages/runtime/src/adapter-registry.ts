import type { Adapter, EnvironmentTestResult } from '@clawgear/shared/interfaces';

export class AdapterRegistry {
  private adapters = new Map<string, Adapter>();

  register(adapter: Adapter): void {
    if (this.adapters.has(adapter.name)) {
      throw new Error(`Adapter already registered: ${adapter.name}`);
    }
    this.adapters.set(adapter.name, adapter);
  }

  get(name: string): Adapter {
    const adapter = this.adapters.get(name);
    if (!adapter) {
      throw new Error(
        `Adapter not found: ${name}. Available: ${[...this.adapters.keys()].join(', ')}`,
      );
    }
    return adapter;
  }

  list(): string[] {
    return [...this.adapters.keys()];
  }

  async testAll(): Promise<EnvironmentTestResult[]> {
    const results: EnvironmentTestResult[] = [];
    for (const adapter of this.adapters.values()) {
      results.push(await adapter.testEnvironment());
    }
    return results;
  }
}
