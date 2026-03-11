import { describe, expect, test } from 'bun:test';
import { DiscordAdapter } from './index.js';

describe('DiscordAdapter', () => {
  test('name is discord', () => {
    const adapter = new DiscordAdapter();
    expect(adapter.name).toBe('discord');
  });

  test('init requires botToken', async () => {
    const adapter = new DiscordAdapter();
    await expect(adapter.init({ guildId: '123' })).rejects.toThrow('botToken');
  });

  test('mapDiscordMessage converts to InboundMessage', () => {
    const adapter = new DiscordAdapter();

    const msg = adapter.mapDiscordMessage({
      author: { id: '123456789', username: 'alice', displayName: 'Alice' },
      content: 'Hello from Discord',
      channelId: '987654321',
      id: '111222333',
      reference: { messageId: '444555666' },
    });

    expect(msg.channelName).toBe('discord');
    expect(msg.externalId).toBe('987654321');
    expect(msg.senderId).toBe('123456789');
    expect(msg.senderName).toBe('Alice');
    expect(msg.content).toBe('Hello from Discord');
    expect(msg.threadId).toBe('444555666');
    expect((msg.metadata as Record<string, unknown>).messageId).toBe('111222333');
  });

  test('mapDiscordMessage fallback to username when no display name', () => {
    const adapter = new DiscordAdapter();

    const msg = adapter.mapDiscordMessage({
      author: { id: '789', username: 'bob' },
      content: 'test',
      channelId: '001',
      id: '222',
    });

    expect(msg.senderName).toBe('bob');
    expect(msg.threadId).toBeNull();
  });

  test('formatAsEmbed wraps content', () => {
    const adapter = new DiscordAdapter();
    const embed = adapter.formatAsEmbed('Hello world');

    expect(embed.title).toBe('Hello world');
    expect(embed.description).toBe('Hello world');
    expect(embed.color).toBe(0x5865f2);
  });

  test('formatAsEmbed handles multiline content', () => {
    const adapter = new DiscordAdapter();
    const embed = adapter.formatAsEmbed('Title line\nBody line 1\nBody line 2');

    expect(embed.title).toBe('Title line');
    expect(embed.description).toBe('Body line 1\nBody line 2');
  });

  test('send throws if not initialized', async () => {
    const adapter = new DiscordAdapter();
    // Not initialized - should handle gracefully (config is null)
    await expect(
      adapter.send({
        channelName: 'discord',
        recipientId: 'C123',
        content: 'test',
        threadId: null,
        metadata: {},
      }),
    ).rejects.toThrow('not initialized');
  });
});
