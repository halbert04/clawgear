import type { Database } from '@clawgear/db';
import { channelBindings, conversationMessages, conversations } from '@clawgear/db/pg';
import { EventTypes } from '@clawgear/shared/events';
import type {
  ChannelAdapter,
  EventBus,
  InboundMessage,
  OutboundMessage,
  SystemEvent,
} from '@clawgear/shared/interfaces';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { HeartbeatEngine } from './heartbeat-engine.js';

// ============================================================
// CHANNEL ROUTER
// ============================================================

export interface ChannelRouterConfig {
  db: Database;
  eventBus: EventBus;
  heartbeatEngine: HeartbeatEngine;
}

export class ChannelRouter {
  private adapters = new Map<string, ChannelAdapter>();
  private db: Database;
  private eventBus: EventBus;
  private heartbeatEngine: HeartbeatEngine;

  constructor(config: ChannelRouterConfig) {
    this.db = config.db;
    this.eventBus = config.eventBus;
    this.heartbeatEngine = config.heartbeatEngine;
  }

  // ----------------------------------------------------------
  // ADAPTER REGISTRY
  // ----------------------------------------------------------

  registerAdapter(adapter: ChannelAdapter): void {
    this.adapters.set(adapter.name, adapter);

    // Wire up inbound message handler
    adapter.onMessage((msg: InboundMessage) => {
      this.handleInbound(msg).catch((err) => {
        console.error(`Channel inbound error (${adapter.name}):`, (err as Error).message);
      });
    });
  }

  getAdapter(name: string): ChannelAdapter | undefined {
    return this.adapters.get(name);
  }

  get adapterNames(): string[] {
    return [...this.adapters.keys()];
  }

  // ----------------------------------------------------------
  // INBOUND ROUTING
  // message -> company resolution -> binding lookup -> conversation -> agent wake
  // ----------------------------------------------------------

  async handleInbound(msg: InboundMessage): Promise<{
    conversationId: string;
    agentId: string;
    messageId: string;
  }> {
    // 1. Resolve agent via channel binding (most-specific wins)
    const binding = await this.resolveBinding(msg);
    if (!binding) {
      throw new Error(
        `No channel binding found for channel=${msg.channelName}, ` +
          `sender=${msg.senderId}, thread=${msg.threadId}`,
      );
    }

    const companyId = binding.companyId;
    const agentId = binding.agentId;

    // 2. Find or create conversation
    const conversation = await this.resolveConversation(companyId, agentId, msg);

    // 3. Store the inbound message
    const [message] = await this.db
      .insert(conversationMessages)
      .values({
        companyId,
        conversationId: conversation.id,
        role: 'user',
        content: msg.content,
        senderId: msg.senderId,
        senderName: msg.senderName,
        metadata: msg.metadata,
      })
      .returning();

    // 4. Update conversation last_message_at
    await this.db
      .update(conversations)
      .set({
        lastMessageAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, conversation.id));

    // 5. Emit channel.message_received event
    const event: SystemEvent = {
      type: EventTypes.CHANNEL_MESSAGE_RECEIVED,
      companyId,
      timestamp: new Date(),
      payload: {
        conversationId: conversation.id,
        messageId: message!.id,
        agentId,
        channelName: msg.channelName,
        senderId: msg.senderId,
        senderName: msg.senderName,
        content: msg.content,
      },
    };
    this.eventBus.emit(event);

    // 6. Wake agent (event-driven, bypass scheduler)
    try {
      await this.heartbeatEngine.executeHeartbeat(agentId, 'event');
    } catch (err) {
      // Non-fatal: agent might already be running
      console.error(`Failed to wake agent ${agentId} for channel message:`, (err as Error).message);
    }

    return {
      conversationId: conversation.id,
      agentId,
      messageId: message!.id,
    };
  }

  // ----------------------------------------------------------
  // OUTBOUND ROUTING
  // agent response -> store message -> channel adapter -> delivery
  // ----------------------------------------------------------

  async handleOutbound(
    conversationId: string,
    agentId: string,
    content: string,
    runId?: string,
    metadata?: Record<string, unknown>,
  ): Promise<{ messageId: string }> {
    // 1. Look up conversation
    const [conversation] = await this.db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId));

    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    // 2. Store agent message
    const [message] = await this.db
      .insert(conversationMessages)
      .values({
        companyId: conversation.companyId,
        conversationId,
        role: 'agent',
        content,
        agentId,
        runId: runId ?? null,
        metadata: metadata ?? {},
      })
      .returning();

    // 3. Update conversation last_message_at
    await this.db
      .update(conversations)
      .set({
        lastMessageAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, conversationId));

    // 4. Deliver via channel adapter
    const adapter = this.adapters.get(conversation.channelName);
    if (adapter) {
      const outbound: OutboundMessage = {
        channelName: conversation.channelName,
        recipientId: conversation.participantId ?? '',
        content,
        threadId: conversation.externalThreadId,
        metadata: metadata ?? {},
      };
      try {
        await adapter.send(outbound);
      } catch (err) {
        console.error(
          `Failed to send outbound message via ${conversation.channelName}:`,
          (err as Error).message,
        );
      }
    }

    // 5. Emit channel.message_sent event
    const event: SystemEvent = {
      type: EventTypes.CHANNEL_MESSAGE_SENT,
      companyId: conversation.companyId,
      timestamp: new Date(),
      payload: {
        conversationId,
        messageId: message!.id,
        agentId,
        channelName: conversation.channelName,
        content,
      },
    };
    this.eventBus.emit(event);

    return { messageId: message!.id };
  }

  // ----------------------------------------------------------
  // BINDING RESOLUTION (most-specific wins)
  // ----------------------------------------------------------

  private async resolveBinding(msg: InboundMessage) {
    // Find all active bindings for this channel
    // Priority order: thread > dm > channel > default (higher priority number wins)
    const bindings = await this.db
      .select()
      .from(channelBindings)
      .where(
        and(eq(channelBindings.channelName, msg.channelName), eq(channelBindings.isActive, true)),
      )
      .orderBy(desc(channelBindings.priority));

    if (bindings.length === 0) return null;

    // Try most specific first
    // 1. Thread-level binding (if threadId matches)
    if (msg.threadId) {
      const threadBinding = bindings.find(
        (b) => b.bindingType === 'thread' && b.externalChannelId === msg.threadId,
      );
      if (threadBinding) return threadBinding;
    }

    // 2. DM-level binding (if senderId matches)
    const dmBinding = bindings.find(
      (b) => b.bindingType === 'dm' && b.externalChannelId === msg.senderId,
    );
    if (dmBinding) return dmBinding;

    // 3. Channel-level binding (if externalId matches)
    if (msg.externalId) {
      const channelBinding = bindings.find(
        (b) => b.bindingType === 'channel' && b.externalChannelId === msg.externalId,
      );
      if (channelBinding) return channelBinding;
    }

    // 4. Default binding (first by highest priority)
    const defaultBinding = bindings.find((b) => b.bindingType === 'default');
    return defaultBinding ?? bindings[0] ?? null;
  }

  // ----------------------------------------------------------
  // CONVERSATION RESOLUTION
  // ----------------------------------------------------------

  private async resolveConversation(companyId: string, agentId: string, msg: InboundMessage) {
    // Try to find existing active conversation for this agent + participant + channel
    const existing = await this.db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.companyId, companyId),
          eq(conversations.agentId, agentId),
          eq(conversations.channelName, msg.channelName),
          eq(conversations.status, 'active'),
          msg.senderId
            ? eq(conversations.participantId, msg.senderId)
            : sql`${conversations.participantId} IS NULL`,
          msg.threadId
            ? eq(conversations.externalThreadId, msg.threadId)
            : sql`${conversations.externalThreadId} IS NULL`,
        ),
      )
      .orderBy(desc(conversations.lastMessageAt))
      .limit(1);

    if (existing.length > 0) {
      return existing[0]!;
    }

    // Create new conversation
    const [conversation] = await this.db
      .insert(conversations)
      .values({
        companyId,
        agentId,
        channelName: msg.channelName,
        externalThreadId: msg.threadId,
        participantId: msg.senderId,
        participantName: msg.senderName,
        lastMessageAt: new Date(),
      })
      .returning();

    // Emit conversation.created event
    const event: SystemEvent = {
      type: EventTypes.CONVERSATION_CREATED,
      companyId,
      timestamp: new Date(),
      payload: {
        conversationId: conversation!.id,
        agentId,
        channelName: msg.channelName,
        participantId: msg.senderId,
        participantName: msg.senderName,
      },
    };
    this.eventBus.emit(event);

    return conversation!;
  }

  // ----------------------------------------------------------
  // LIFECYCLE
  // ----------------------------------------------------------

  async initAll(): Promise<void> {
    for (const [name, adapter] of this.adapters) {
      try {
        await adapter.init({});
      } catch (err) {
        console.error(`Failed to init channel adapter ${name}:`, (err as Error).message);
      }
    }
  }

  async shutdownAll(): Promise<void> {
    for (const [name, adapter] of this.adapters) {
      try {
        await adapter.shutdown();
      } catch (err) {
        console.error(`Failed to shutdown channel adapter ${name}:`, (err as Error).message);
      }
    }
    this.adapters.clear();
  }
}
