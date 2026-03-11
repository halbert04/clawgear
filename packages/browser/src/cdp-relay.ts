import { type Browser, type BrowserContext, chromium } from 'playwright';
import { BrowserSession } from './browser-session.js';
import type { BrowserSessionConfig } from './types.js';

export interface CdpRelayConfig {
  /** WebSocket endpoint URL for CDP connection (e.g., ws://localhost:9222) */
  cdpEndpoint: string;
  /** Navigation timeout in ms */
  navigationTimeout?: number;
  /** JS execution timeout in ms */
  jsExecutionTimeout?: number;
}

/**
 * Connects to an existing Chrome instance via CDP for Extension Relay mode.
 * This allows agents to use the user's authenticated browser sessions.
 */
export class CdpRelay {
  private browser: Browser | null = null;
  private sessions = new Map<string, BrowserSession>();
  private config: CdpRelayConfig;

  constructor(config: CdpRelayConfig) {
    this.config = config;
  }

  /**
   * Connect to the Chrome instance via CDP.
   */
  async connect(): Promise<void> {
    if (this.browser) return;
    this.browser = await chromium.connectOverCDP(this.config.cdpEndpoint);
  }

  /**
   * Check if connected to a Chrome instance.
   */
  isConnected(): boolean {
    return this.browser?.isConnected() ?? false;
  }

  /**
   * Create a session on the connected browser for a specific agent.
   * Uses the default browser context (user's actual session).
   */
  async createSession(sessionConfig: BrowserSessionConfig): Promise<BrowserSession> {
    if (!this.browser || !this.browser.isConnected()) {
      throw new Error('CdpRelay not connected. Call connect() first.');
    }

    const { agentId } = sessionConfig;
    const existing = this.sessions.get(agentId);
    if (existing && !existing.isClosed()) {
      return existing;
    }

    // Use default context (the user's existing browser context)
    const contexts = this.browser.contexts();
    const context: BrowserContext = contexts[0] ?? (await this.browser.newContext());

    const session = new BrowserSession(context, {
      ...sessionConfig,
      navigationTimeout: sessionConfig.navigationTimeout ?? this.config.navigationTimeout ?? 30_000,
      jsExecutionTimeout:
        sessionConfig.jsExecutionTimeout ?? this.config.jsExecutionTimeout ?? 10_000,
    });
    this.sessions.set(agentId, session);
    return session;
  }

  /**
   * Release a specific agent's session.
   */
  async releaseSession(agentId: string): Promise<void> {
    const session = this.sessions.get(agentId);
    if (session) {
      await session.close();
      this.sessions.delete(agentId);
    }
  }

  /**
   * Disconnect from the Chrome instance.
   * Note: This does NOT close the user's Chrome - just disconnects.
   */
  async disconnect(): Promise<void> {
    for (const [, session] of this.sessions) {
      await session.close();
    }
    this.sessions.clear();

    if (this.browser) {
      // disconnect() not close() - we don't own this browser
      this.browser.close();
      this.browser = null;
    }
  }
}
