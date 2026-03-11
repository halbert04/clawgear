import { describe, expect, test } from 'bun:test';
import { TelegramAdapter } from './index.js';

describe('TelegramAdapter', () => {
  test('name is telegram', () => {
    const adapter = new TelegramAdapter();
    expect(adapter.name).toBe('telegram');
  });

  test('init requires botToken', async () => {
    const adapter = new TelegramAdapter();
    await expect(adapter.init({})).rejects.toThrow('botToken');
  });

  test('mapTelegramMessage converts to InboundMessage', () => {
    const adapter = new TelegramAdapter();

    const msg = adapter.mapTelegramMessage({
      from: {
        id: 123456789,
        first_name: 'Alice',
        last_name: 'Smith',
        username: 'alice_smith',
      },
      text: 'Hello from Telegram',
      chat: { id: 987654321 },
      message_id: 42,
    });

    expect(msg.channelName).toBe('telegram');
    expect(msg.externalId).toBe('987654321');
    expect(msg.senderId).toBe('123456789');
    expect(msg.senderName).toBe('Alice Smith');
    expect(msg.content).toBe('Hello from Telegram');
    expect(msg.threadId).toBeNull();
    expect((msg.metadata as Record<string, unknown>).message_id).toBe(42);
    expect((msg.metadata as Record<string, unknown>).username).toBe('alice_smith');
  });

  test('mapTelegramMessage with reply_to_message sets threadId', () => {
    const adapter = new TelegramAdapter();

    const msg = adapter.mapTelegramMessage({
      from: {
        id: 123456789,
        first_name: 'Bob',
      },
      text: 'Reply message',
      chat: { id: 987654321 },
      message_id: 43,
      reply_to_message: { message_id: 40 },
    });

    expect(msg.threadId).toBe('40');
  });

  test('mapTelegramMessage builds display name from first_name + last_name', () => {
    const adapter = new TelegramAdapter();

    const msg1 = adapter.mapTelegramMessage({
      from: {
        id: 111,
        first_name: 'John',
        last_name: 'Doe',
      },
      text: 'test',
      chat: { id: 222 },
      message_id: 1,
    });

    expect(msg1.senderName).toBe('John Doe');

    const msg2 = adapter.mapTelegramMessage({
      from: {
        id: 333,
        first_name: 'Jane',
        username: 'jane_user',
      },
      text: 'test',
      chat: { id: 444 },
      message_id: 2,
    });

    expect(msg2.senderName).toBe('Jane');

    const msg3 = adapter.mapTelegramMessage({
      from: {
        id: 555,
        first_name: '',
        username: 'username_only',
      },
      text: 'test',
      chat: { id: 666 },
      message_id: 3,
    });

    expect(msg3.senderName).toBe('username_only');

    const msg4 = adapter.mapTelegramMessage({
      from: {
        id: 777,
        first_name: '',
      },
      text: 'test',
      chat: { id: 888 },
      message_id: 4,
    });

    expect(msg4.senderName).toBe('777');
  });

  test('formatAsMarkdownV2 escapes special chars', () => {
    const adapter = new TelegramAdapter();

    const escaped = adapter.formatAsMarkdownV2('Hello_world *test* [link](url) ~strike~ `code`');
    expect(escaped).toBe('Hello\\_world \\*test\\* \\[link\\]\\(url\\) \\~strike\\~ \\`code\\`');

    const specialChars = adapter.formatAsMarkdownV2('Special: > # + - = | { } . !');
    expect(specialChars).toBe('Special: \\> \\# \\+ \\- \\= \\| \\{ \\} \\. \\!');

    const backslash = adapter.formatAsMarkdownV2('Backslash: \\');
    expect(backslash).toBe('Backslash: \\\\');
  });

  test('send throws if not initialized', async () => {
    const adapter = new TelegramAdapter();
    await expect(
      adapter.send({
        channelName: 'telegram',
        recipientId: '123456789',
        content: 'test',
        threadId: null,
        metadata: {},
      }),
    ).rejects.toThrow('not initialized');
  });
});
