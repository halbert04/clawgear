import type { Database } from '@clawgear/db';
import { agents } from '@clawgear/db/pg';
import type { EventBus, SystemEvent } from '@clawgear/shared/interfaces';
import { eq } from 'drizzle-orm';

export interface AgentMessage {
  fromAgentId: string;
  toAgentId: string;
  companyId: string;
  body: string;
  metadata?: Record<string, unknown>;
}

export interface AgentMessagingConfig {
  db: Database;
  eventBus: EventBus;
}

export class AgentMessaging {
  private db: Database;
  private eventBus: EventBus;

  constructor(config: AgentMessagingConfig) {
    this.db = config.db;
    this.eventBus = config.eventBus;
  }

  async sendMessage(message: AgentMessage): Promise<void> {
    // Validate both agents exist and are in the same company
    const [fromAgent] = await this.db
      .select()
      .from(agents)
      .where(eq(agents.id, message.fromAgentId));

    const [toAgent] = await this.db.select().from(agents).where(eq(agents.id, message.toAgentId));

    if (!fromAgent) throw new Error(`Sender agent not found: ${message.fromAgentId}`);
    if (!toAgent) throw new Error(`Recipient agent not found: ${message.toAgentId}`);
    if (fromAgent.companyId !== toAgent.companyId) {
      throw new Error('Agents must be in the same company');
    }

    // Check org chart permission: agent can message their manager or reports
    const isManager = toAgent.reportsTo === message.fromAgentId;
    const isReport = fromAgent.reportsTo === message.toAgentId;
    const isSameTeam = fromAgent.reportsTo === toAgent.reportsTo;

    if (!isManager && !isReport && !isSameTeam) {
      throw new Error(
        `Agent ${message.fromAgentId} cannot message agent ${message.toAgentId}: no org chart relationship`,
      );
    }

    // Emit wake event for the recipient
    const event: SystemEvent = {
      type: 'agent.message_received',
      companyId: message.companyId,
      timestamp: new Date(),
      payload: {
        fromAgentId: message.fromAgentId,
        toAgentId: message.toAgentId,
        body: message.body,
        metadata: message.metadata ?? {},
      },
    };
    this.eventBus.emit(event);
  }
}
