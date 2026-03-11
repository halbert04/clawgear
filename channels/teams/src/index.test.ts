import { describe, expect, test } from 'bun:test';
import { TeamsAdapter } from './index.js';

describe('TeamsAdapter', () => {
  test('name is teams', () => {
    const adapter = new TeamsAdapter();
    expect(adapter.name).toBe('teams');
  });

  test('init requires appId', async () => {
    const adapter = new TeamsAdapter();
    await expect(adapter.init({ appPassword: 'secret' })).rejects.toThrow('appId');
  });

  test('init requires appPassword', async () => {
    const adapter = new TeamsAdapter();
    await expect(adapter.init({ appId: 'app-id-123' })).rejects.toThrow('appPassword');
  });

  test('mapTeamsMessage converts to InboundMessage', () => {
    const adapter = new TeamsAdapter();

    const msg = adapter.mapTeamsMessage({
      from: { id: 'user-123', name: 'Alice Smith' },
      text: 'Hello from Teams',
      channelId: 'msteams',
      id: 'activity-456',
      conversation: { id: 'conv-789' },
      replyToId: 'thread-001',
      channelData: { teamsChannelId: 'channel-abc' },
    });

    expect(msg.channelName).toBe('teams');
    expect(msg.externalId).toBe('channel-abc');
    expect(msg.senderId).toBe('user-123');
    expect(msg.senderName).toBe('Alice Smith');
    expect(msg.content).toBe('Hello from Teams');
    expect(msg.threadId).toBe('thread-001');
    expect((msg.metadata as Record<string, unknown>).activityId).toBe('activity-456');
  });

  test('mapTeamsMessage handles thread reply', () => {
    const adapter = new TeamsAdapter();

    const msg = adapter.mapTeamsMessage({
      from: { id: 'user-456', name: 'Bob' },
      text: 'Reply in thread',
      channelId: 'msteams',
      id: 'activity-789',
      conversation: { id: 'conv-123' },
      replyToId: 'parent-msg-001',
    });

    expect(msg.threadId).toBe('parent-msg-001');
  });

  test('mapTeamsMessage without replyToId has null threadId', () => {
    const adapter = new TeamsAdapter();

    const msg = adapter.mapTeamsMessage({
      from: { id: 'user-789' },
      text: 'New message',
      channelId: 'msteams',
      id: 'activity-001',
      conversation: { id: 'conv-456' },
    });

    expect(msg.senderName).toBe('user-789');
    expect(msg.threadId).toBeNull();
  });

  test('formatAsAdaptiveCard wraps content in TextBlock', () => {
    const adapter = new TeamsAdapter();
    const card = adapter.formatAsAdaptiveCard('Hello world');

    expect(card.type).toBe('AdaptiveCard');
    expect(card.version).toBe('1.4');
    expect(Array.isArray(card.body)).toBe(true);
    const body = card.body as Array<Record<string, unknown>>;
    expect(body.length).toBe(1);
    expect(body[0]!.type).toBe('TextBlock');
    expect(body[0]!.text).toBe('Hello world');
    expect(body[0]!.wrap).toBe(true);
  });

  test('formatAsAdaptiveCard creates valid adaptive card structure', () => {
    const adapter = new TeamsAdapter();
    const card = adapter.formatAsAdaptiveCard('Test message with markdown');

    expect(card.type).toBe('AdaptiveCard');
    expect(card.version).toBe('1.4');
    expect(card.$schema).toBe('http://adaptivecards.io/schemas/adaptive-card.json');
    expect(Array.isArray(card.body)).toBe(true);
  });

  test('send throws if not initialized', async () => {
    const adapter = new TeamsAdapter();
    await expect(
      adapter.send({
        channelName: 'teams',
        recipientId: 'channel-123',
        content: 'test',
        threadId: null,
        metadata: {},
      }),
    ).rejects.toThrow('not initialized');
  });
});
