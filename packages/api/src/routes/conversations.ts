import { conversationMessages, conversations } from '@clawgear/db/pg';
import type { ChannelRouter } from '@clawgear/kernel';
import type { SystemEvent } from '@clawgear/shared/interfaces';
import { EventTypes } from '@clawgear/shared/events';
import {
  createConversationMessageSchema,
  createConversationSchema,
  paginationSchema,
  updateConversationSchema,
} from '@clawgear/shared/validators';
import { and, desc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { AppDeps } from '../app.js';
import { badRequest, notFound } from '../lib/errors.js';
import { serializeRow, serializeRows } from '../lib/serialize.js';

export function conversationRoutes(deps: AppDeps & { channelRouter?: ChannelRouter }) {
  const { db, eventBus, channelRouter } = deps;
  const app = new Hono();

  // POST / — Create a new conversation
  app.post('/', async (c) => {
    const companyId = c.req.param('companyId')!;
    const body = createConversationSchema.parse(await c.req.json());

    const [conversation] = await db
      .insert(conversations)
      .values({
        companyId,
        agentId: body.agentId,
        channelName: body.channelName,
        title: body.title ?? null,
        participantId: body.participantId ?? null,
        participantName: body.participantName ?? null,
        metadata: body.metadata,
        lastMessageAt: new Date(),
      })
      .returning();

    const event: SystemEvent = {
      type: EventTypes.CONVERSATION_CREATED,
      companyId,
      timestamp: new Date(),
      payload: {
        conversationId: conversation!.id,
        agentId: body.agentId,
        channelName: body.channelName,
        participantId: body.participantId ?? null,
        participantName: body.participantName ?? null,
      },
    };
    eventBus.emit(event);

    return c.json(serializeRow(conversation!), 201);
  });

  // GET / — List conversations
  app.get('/', async (c) => {
    const companyId = c.req.param('companyId')!;
    const { limit, offset } = paginationSchema.parse(c.req.query());
    const agentId = c.req.query('agentId');
    const status = c.req.query('status');

    const conditions = [eq(conversations.companyId, companyId)];
    if (agentId) conditions.push(eq(conversations.agentId, agentId));
    if (status) conditions.push(eq(conversations.status, status));

    const rows = await db
      .select()
      .from(conversations)
      .where(and(...conditions))
      .orderBy(desc(conversations.lastMessageAt))
      .limit(limit)
      .offset(offset);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(conversations)
      .where(and(...conditions));

    return c.json({
      data: serializeRows(rows),
      total: Number(countResult!.count),
      limit,
      offset,
    });
  });

  // GET /:id — Get conversation detail
  app.get('/:id', async (c) => {
    const companyId = c.req.param('companyId')!;
    const id = c.req.param('id');

    const [conversation] = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.companyId, companyId)));

    if (!conversation) throw notFound('Conversation', id);
    return c.json(serializeRow(conversation));
  });

  // PATCH /:id — Update conversation (title, status)
  app.patch('/:id', async (c) => {
    const companyId = c.req.param('companyId')!;
    const id = c.req.param('id');
    const body = updateConversationSchema.parse(await c.req.json());

    const values: Record<string, unknown> = { updatedAt: new Date() };
    if (body.title !== undefined) values.title = body.title;
    if (body.status !== undefined) values.status = body.status;

    const [updated] = await db
      .update(conversations)
      .set(values)
      .where(and(eq(conversations.id, id), eq(conversations.companyId, companyId)))
      .returning();

    if (!updated) throw notFound('Conversation', id);

    if (body.status === 'closed') {
      const event: SystemEvent = {
        type: EventTypes.CONVERSATION_CLOSED,
        companyId,
        timestamp: new Date(),
        payload: { conversationId: id, agentId: updated.agentId },
      };
      eventBus.emit(event);
    }

    return c.json(serializeRow(updated));
  });

  // GET /:id/messages — List messages in a conversation
  app.get('/:id/messages', async (c) => {
    const companyId = c.req.param('companyId')!;
    const id = c.req.param('id');
    const { limit, offset } = paginationSchema.parse(c.req.query());

    // Verify conversation exists and belongs to company
    const [conversation] = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.companyId, companyId)));

    if (!conversation) throw notFound('Conversation', id);

    const rows = await db
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, id))
      .orderBy(conversationMessages.createdAt)
      .limit(limit)
      .offset(offset);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, id));

    return c.json({
      data: serializeRows(rows),
      total: Number(countResult!.count),
      limit,
      offset,
    });
  });

  // POST /:id/messages — Send a message to a conversation (triggers agent wake)
  app.post('/:id/messages', async (c) => {
    const companyId = c.req.param('companyId')!;
    const id = c.req.param('id');
    const body = createConversationMessageSchema.parse(await c.req.json());

    // Verify conversation exists and is active
    const [conversation] = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.companyId, companyId)));

    if (!conversation) throw notFound('Conversation', id);
    if (conversation.status !== 'active') {
      throw badRequest('Cannot send message to a non-active conversation');
    }

    // Store user message
    const [message] = await db
      .insert(conversationMessages)
      .values({
        companyId,
        conversationId: id,
        role: 'user',
        content: body.content,
        senderId: body.senderId ?? conversation.participantId,
        senderName: body.senderName ?? conversation.participantName,
      })
      .returning();

    // Update conversation last_message_at
    await db
      .update(conversations)
      .set({ lastMessageAt: new Date(), updatedAt: new Date() })
      .where(eq(conversations.id, id));

    // Emit event for WebSocket bridge + agent wake
    const event: SystemEvent = {
      type: EventTypes.CHANNEL_MESSAGE_RECEIVED,
      companyId,
      timestamp: new Date(),
      payload: {
        conversationId: id,
        messageId: message!.id,
        agentId: conversation.agentId,
        channelName: conversation.channelName,
        senderId: body.senderId ?? conversation.participantId ?? '',
        senderName: body.senderName ?? conversation.participantName ?? '',
        content: body.content,
      },
    };
    eventBus.emit(event);

    // If channel router is available, trigger agent wake
    if (channelRouter) {
      try {
        // Use the channel router's heartbeat engine to wake the agent
        // The event above will be picked up by the wake handler
      } catch {
        // Non-fatal; agent might already be running
      }
    }

    return c.json(serializeRow(message!), 201);
  });

  // POST /:id/messages/stream — SSE streaming endpoint for agent responses
  app.post('/:id/messages/stream', async (c) => {
    const companyId = c.req.param('companyId')!;
    const id = c.req.param('id');
    const body = createConversationMessageSchema.parse(await c.req.json());

    // Verify conversation exists and is active
    const [conversation] = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.companyId, companyId)));

    if (!conversation) throw notFound('Conversation', id);
    if (conversation.status !== 'active') {
      throw badRequest('Cannot send message to a non-active conversation');
    }

    // Store user message
    const [userMessage] = await db
      .insert(conversationMessages)
      .values({
        companyId,
        conversationId: id,
        role: 'user',
        content: body.content,
        senderId: body.senderId ?? conversation.participantId,
        senderName: body.senderName ?? conversation.participantName,
      })
      .returning();

    // Update conversation last_message_at
    await db
      .update(conversations)
      .set({ lastMessageAt: new Date(), updatedAt: new Date() })
      .where(eq(conversations.id, id));

    // Emit channel event
    const msgEvent: SystemEvent = {
      type: EventTypes.CHANNEL_MESSAGE_RECEIVED,
      companyId,
      timestamp: new Date(),
      payload: {
        conversationId: id,
        messageId: userMessage!.id,
        agentId: conversation.agentId,
        channelName: conversation.channelName,
        senderId: body.senderId ?? conversation.participantId ?? '',
        senderName: body.senderName ?? conversation.participantName ?? '',
        content: body.content,
      },
    };
    eventBus.emit(msgEvent);

    // Stream SSE response
    return streamSSE(c, async (stream) => {
      let resolved = false;

      // Listen for agent response events on this conversation
      const sub = eventBus.on(EventTypes.CHANNEL_MESSAGE_SENT, (event: SystemEvent) => {
        const payload = event.payload as Record<string, unknown>;
        if (payload.conversationId !== id) return;

        stream
          .writeSSE({
            event: 'chunk',
            data: JSON.stringify({
              conversationId: id,
              messageId: payload.messageId,
              content: payload.content,
              agentId: payload.agentId,
            }),
          })
          .catch(() => {
            // Stream closed
          });
      });

      // Listen for heartbeat progress events
      const progressSub = eventBus.on('agent.progress', (event: SystemEvent) => {
        const payload = event.payload as Record<string, unknown>;
        if (payload.agentId !== conversation.agentId) return;

        stream
          .writeSSE({
            event: 'progress',
            data: JSON.stringify(payload),
          })
          .catch(() => {
            // Stream closed
          });
      });

      // Listen for heartbeat completion to close the stream
      const completeSub = eventBus.on(EventTypes.HEARTBEAT_COMPLETED, (event: SystemEvent) => {
        const payload = event.payload as Record<string, unknown>;
        if (payload.agentId !== conversation.agentId) return;

        stream
          .writeSSE({
            event: 'done',
            data: JSON.stringify({ conversationId: id, runId: payload.runId }),
          })
          .then(() => {
            resolved = true;
          })
          .catch(() => {
            // Stream closed
          });
      });

      const failSub = eventBus.on(EventTypes.HEARTBEAT_FAILED, (event: SystemEvent) => {
        const payload = event.payload as Record<string, unknown>;
        if (payload.agentId !== conversation.agentId) return;

        stream
          .writeSSE({
            event: 'error',
            data: JSON.stringify({
              conversationId: id,
              error: payload.error ?? 'Heartbeat failed',
            }),
          })
          .then(() => {
            resolved = true;
          })
          .catch(() => {
            // Stream closed
          });
      });

      // Send initial ack
      await stream.writeSSE({
        event: 'ack',
        data: JSON.stringify({
          conversationId: id,
          messageId: userMessage!.id,
          agentId: conversation.agentId,
        }),
      });

      // Wait for resolution or timeout (5 minutes)
      const timeoutMs = 5 * 60 * 1000;
      const start = Date.now();
      while (!resolved && Date.now() - start < timeoutMs) {
        await stream.sleep(500);
      }

      // Cleanup subscriptions
      sub.unsubscribe();
      progressSub.unsubscribe();
      completeSub.unsubscribe();
      failSub.unsubscribe();
    });
  });

  return app;
}
