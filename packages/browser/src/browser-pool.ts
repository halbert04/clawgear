import { type Browser, type BrowserContext, chromium } from 'playwright';
import { BrowserSession } from './browser-session.js';
import { type BrowserPoolConfig, type BrowserSessionConfig, DEFAULT_POOL_CONFIG } from './types.js';

interface PoolEntry {
  browser: Browser;
  contexts: Map<string, BrowserContext>;
  createdAt: number;
}

export class BrowserPool {
  private pool: PoolEntry | null = null;
  private sessions = new Map<string, BrowserSession>();
  private config: BrowserPoolConfig;
  private shutdownRequested = false;

  constructor(config: Partial<BrowserPoolConfig> = {}) {
    this.config = { ...DEFAULT_POOL_CONFIG, ...config };
  }

  /**
   * Acquire a BrowserSession for a specific agent.
   * Reuses existing context if one exists for the agent.
   */
  async acquire(sessionConfig: BrowserSessionConfig): Promise<BrowserSession> {
    if (this.shutdownRequested) {
      throw new Error('BrowserPool is shutting down');
    }

    const { agentId } = sessionConfig;

    // Return existing session if available
    const existing = this.sessions.get(agentId);
    if (existing && !existing.isClosed()) {
      return existing;
    }

    // Ensure browser is running
    if (!this.pool) {
      const launchOptions: Record<string, unknown> = {
        headless: this.config.headless,
      };
      if (this.config.proxy) {
        launchOptions.proxy = { server: this.config.proxy };
      }
      const browser = await chromium.launch(launchOptions);
      this.pool = {
        browser,
        contexts: new Map(),
        createdAt: Date.now(),
      };
    }

    // Check context limit
    if (this.pool.contexts.size >= this.config.maxBrowsers) {
      throw new Error(
        `Browser pool exhausted: ${this.pool.contexts.size}/${this.config.maxBrowsers} contexts in use`,
      );
    }

    // Create isolated context for this agent
    const contextOptions: Record<string, unknown> = {};
    if (this.config.userAgent) {
      contextOptions.userAgent = this.config.userAgent;
    }
    const context = await this.pool.browser.newContext(contextOptions);
    this.pool.contexts.set(agentId, context);

    const session = new BrowserSession(context, {
      ...sessionConfig,
      navigationTimeout: sessionConfig.navigationTimeout ?? this.config.navigationTimeout,
      jsExecutionTimeout: sessionConfig.jsExecutionTimeout ?? this.config.jsExecutionTimeout,
    });
    this.sessions.set(agentId, session);
    return session;
  }

  /**
   * Release a session for a specific agent, closing its browser context.
   */
  async release(agentId: string): Promise<void> {
    const session = this.sessions.get(agentId);
    if (session) {
      await session.close();
      this.sessions.delete(agentId);
    }
    if (this.pool) {
      const context = this.pool.contexts.get(agentId);
      if (context) {
        await context.close();
        this.pool.contexts.delete(agentId);
      }
    }
  }

  /**
   * Get a list of active agent IDs with sessions.
   */
  activeSessions(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Shut down the entire pool, closing all browsers.
   */
  async shutdown(): Promise<void> {
    this.shutdownRequested = true;

    // Close all sessions
    for (const [agentId, session] of this.sessions) {
      await session.close();
      this.sessions.delete(agentId);
    }

    // Close browser
    if (this.pool) {
      for (const [, context] of this.pool.contexts) {
        await context.close();
      }
      this.pool.contexts.clear();
      await this.pool.browser.close();
      this.pool = null;
    }
  }

  /**
   * Get pool stats for monitoring.
   */
  stats(): { activeSessions: number; maxBrowsers: number; isRunning: boolean } {
    return {
      activeSessions: this.sessions.size,
      maxBrowsers: this.config.maxBrowsers,
      isRunning: this.pool !== null && !this.shutdownRequested,
    };
  }
}
