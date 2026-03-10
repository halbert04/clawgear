import { describe, expect, test } from 'bun:test';
import { SlackAdapter } from './index.js';

describe('SlackAdapter', () => {
  test('name is slack', () => {
    const adapter = new SlackAdapter();
    expect(adapter.name).toBe('slack');
  });

  test('init requires botToken', async () => {
    const adapter = new SlackAdapter();
    await expect(adapter.init({ signingSecret: 'secret' })).rejects.toThrow('botToken');
  });

  test('init requires signingSecret', async () => {
    const adapter = new SlackAdapter();
    await expect(adapter.init({ botToken: 'xoxb-...' })).rejects.toThrow('signingSecret');
  });

  test('mapSlackMessage converts to InboundMessage', () => {
    const adapter = new SlackAdapter();

    const msg = adapter.mapSlackMessage({
      user: 'U123',
      text: 'Hello from Slack',
      channel: 'C456',
      ts: '1234567890.123456',
      thread_ts: '1234567890.000000',
      user_profile: { display_name: 'Alice', real_name: 'Alice Smith' },
    });

    expect(msg.channelName).toBe('slack');
    expect(msg.externalId).toBe('C456');
    expect(msg.senderId).toBe('U123');
    expect(msg.senderName).toBe('Alice');
    expect(msg.content).toBe('Hello from Slack');
    expect(msg.threadId).toBe('1234567890.000000');
    expect((msg.metadata as Record<string, unknown>).ts).toBe('1234567890.123456');
  });

  test('mapSlackMessage fallback to user ID when no profile', () => {
    const adapter = new SlackAdapter();

    const msg = adapter.mapSlackMessage({
      user: 'U789',
      text: 'test',
      channel: 'C001',
      ts: '111.222',
    });

    expect(msg.senderName).toBe('U789');
    expect(msg.threadId).toBeNull();
  });

  test('formatAsBlocks wraps plain text', () => {
    const adapter = new SlackAdapter();
    const blocks = adapter.formatAsBlocks('Hello world');

    expect(blocks.length).toBe(1);
    expect(blocks[0]!.type).toBe('section');
    expect((blocks[0]!.text as Record<string, unknown>).text).toBe('Hello world');
    expect((blocks[0]!.text as Record<string, unknown>).type).toBe('mrkdwn');
  });

  test('formatAsBlocks handles code blocks', () => {
    const adapter = new SlackAdapter();
    const blocks = adapter.formatAsBlocks('Before code\n```js\nconsole.log("hi")\n```\nAfter code');

    // Should have: before text, code block, after text
    expect(blocks.length).toBeGreaterThanOrEqual(2);
  });

  test('send throws if not initialized', async () => {
    const adapter = new SlackAdapter();
    // Not initialized - should handle gracefully (config is null)
    await expect(
      adapter.send({
        channelName: 'slack',
        recipientId: 'C123',
        content: 'test',
        threadId: null,
        metadata: {},
      }),
    ).rejects.toThrow('not initialized');
  });
});
