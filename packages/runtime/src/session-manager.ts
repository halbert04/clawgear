import type { Database } from '@clawgear/db';
import { agentRuntimeState } from '@clawgear/db/pg';
import { eq } from 'drizzle-orm';

export interface SessionManagerConfig {
  db: Database;
  ttlMs?: number;
}

export class SessionManager {
  private db: Database;
  private ttlMs: number;

  constructor(config: SessionManagerConfig) {
    this.db = config.db;
    this.ttlMs = config.ttlMs ?? 24 * 60 * 60 * 1000; // 24 hours default
  }

  async getSessionId(agentId: string): Promise<string | null> {
    const [state] = await this.db
      .select({ sessionId: agentRuntimeState.sessionId, updatedAt: agentRuntimeState.updatedAt })
      .from(agentRuntimeState)
      .where(eq(agentRuntimeState.agentId, agentId));

    if (!state?.sessionId) return null;

    // Check TTL
    const age = Date.now() - state.updatedAt.getTime();
    if (age > this.ttlMs) {
      await this.clearSession(agentId);
      return null;
    }

    return state.sessionId;
  }

  async saveSessionId(agentId: string, companyId: string, sessionId: string): Promise<void> {
    await this.db
      .insert(agentRuntimeState)
      .values({
        agentId,
        companyId,
        sessionId,
        cumulativeTokens: 0n,
        cumulativeCostCents: 0n,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: agentRuntimeState.agentId,
        set: {
          sessionId,
          updatedAt: new Date(),
        },
      });
  }

  async clearSession(agentId: string): Promise<void> {
    await this.db
      .update(agentRuntimeState)
      .set({ sessionId: null, updatedAt: new Date() })
      .where(eq(agentRuntimeState.agentId, agentId));
  }
}
