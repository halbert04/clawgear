import { describe, expect, mock, test } from 'bun:test';
import type { InboundMessage, OutboundMessage } from '@clawgear/shared/interfaces';
import { WebChatAdapter } from './index.js';

describe('WebChatAdapter', () => {
  test('name is webchat', () => {
    const adapter = new WebChatAdapter();
    expect(adapter.name).toBe('webchat');
  });

  test('init succeeds without config', async () => {
    const adapter = new WebChatAdapter();
    await adapter.init({});
    // No error = success
  });

  test('handleUserMessage triggers onMessage handlers', () => {
    const adapter = new WebChatAdapter();
    const handler = mock((msg: InboundMessage) => {
      void msg;
    });

    adapter.onMessage(handler);

    adapter.handleUserMessage({
      senderId: 'user-1',
      senderName: 'Alice',
      content: 'Hello agent!',
    });

    expect(handler).toHaveBeenCalledTimes(1);
    const msg = handler.mock.calls[0]![0] as InboundMessage;
    expect(msg.channelName).toBe('webchat');
    expect(msg.senderId).toBe('user-1');
    expect(msg.senderName).toBe('Alice');
    expect(msg.content).toBe('Hello agent!');
    expect(msg.threadId).toBeNull();
  });

  test('handleUserMessage with threadId', () => {
    const adapter = new WebChatAdapter();
    const handler = mock((msg: InboundMessage) => {
      void msg;
    });

    adapter.onMessage(handler);

    adapter.handleUserMessage({
      senderId: 'user-1',
      senderName: 'Bob',
      content: 'Follow-up',
      threadId: 'thread-123',
    });

    const msg = handler.mock.calls[0]![0] as InboundMessage;
    expect(msg.threadId).toBe('thread-123');
  });

  test('send delivers via outbound callback', async () => {
    const adapter = new WebChatAdapter();
    const callback = mock((msg: OutboundMessage) => {
      void msg;
    });

    adapter.onOutbound(callback);

    await adapter.send({
      channelName: 'webchat',
      recipientId: 'user-1',
      content: 'Agent response',
      threadId: null,
      metadata: {},
    });

    expect(callback).toHaveBeenCalledTimes(1);
    const msg = callback.mock.calls[0]![0] as OutboundMessage;
    expect(msg.content).toBe('Agent response');
  });

  test('send without outbound callback does not throw', async () => {
    const adapter = new WebChatAdapter();
    // No callback registered
    await adapter.send({
      channelName: 'webchat',
      recipientId: 'user-1',
      content: 'test',
      threadId: null,
      metadata: {},
    });
    // No error = success
  });

  test('shutdown clears handlers', async () => {
    const adapter = new WebChatAdapter();
    const handler = mock(() => {});
    const callback = mock(() => {});

    adapter.onMessage(handler);
    adapter.onOutbound(callback);
    await adapter.shutdown();

    adapter.handleUserMessage({
      senderId: 'u1',
      senderName: 'test',
      content: 'hi',
    });

    expect(handler).not.toHaveBeenCalled();
  });

  test('multiple onMessage handlers all receive messages', () => {
    const adapter = new WebChatAdapter();
    const h1 = mock(() => {});
    const h2 = mock(() => {});

    adapter.onMessage(h1);
    adapter.onMessage(h2);

    adapter.handleUserMessage({
      senderId: 'u1',
      senderName: 'test',
      content: 'hi',
    });

    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
  });
});
