import { describe, expect, test } from 'bun:test';
import { WhatsAppAdapter } from './index.js';

describe('WhatsAppAdapter', () => {
  test('name is whatsapp', () => {
    const adapter = new WhatsAppAdapter();
    expect(adapter.name).toBe('whatsapp');
  });

  test('mapWhatsAppMessage converts to InboundMessage (direct message)', () => {
    const adapter = new WhatsAppAdapter();

    const msg = adapter.mapWhatsAppMessage({
      key: {
        remoteJid: '1234567890@s.whatsapp.net',
        id: 'MSG123',
      },
      pushName: 'Alice',
      message: {
        conversation: 'Hello from WhatsApp',
      },
    });

    expect(msg.channelName).toBe('whatsapp');
    expect(msg.externalId).toBe('1234567890@s.whatsapp.net');
    expect(msg.senderId).toBe('1234567890@s.whatsapp.net');
    expect(msg.senderName).toBe('Alice');
    expect(msg.content).toBe('Hello from WhatsApp');
    expect(msg.threadId).toBeNull();
    expect((msg.metadata as Record<string, unknown>).messageId).toBe('MSG123');
    expect((msg.metadata as Record<string, unknown>).isGroup).toBe(false);
  });

  test('mapWhatsAppMessage handles group message (uses participant as senderId)', () => {
    const adapter = new WhatsAppAdapter();

    const msg = adapter.mapWhatsAppMessage({
      key: {
        remoteJid: '120363123456789012@g.us',
        id: 'MSG456',
        participant: '9876543210@s.whatsapp.net',
      },
      pushName: 'Bob',
      message: {
        conversation: 'Group message',
      },
    });

    expect(msg.externalId).toBe('120363123456789012@g.us');
    expect(msg.senderId).toBe('9876543210@s.whatsapp.net');
    expect(msg.senderName).toBe('Bob');
    expect(msg.content).toBe('Group message');
    expect((msg.metadata as Record<string, unknown>).isGroup).toBe(true);
  });

  test('mapWhatsAppMessage handles reply (sets threadId from quoted message)', () => {
    const adapter = new WhatsAppAdapter();

    const msg = adapter.mapWhatsAppMessage({
      key: {
        remoteJid: '1234567890@s.whatsapp.net',
        id: 'MSG789',
      },
      pushName: 'Charlie',
      message: {
        extendedTextMessage: {
          text: 'This is a reply',
          contextInfo: {
            quotedMessage: {
              conversation: 'Original message',
            },
          },
        },
      },
    });

    expect(msg.content).toBe('This is a reply');
    expect(msg.threadId).toBe('MSG789');
  });

  test('mapWhatsAppMessage extracts text from conversation field', () => {
    const adapter = new WhatsAppAdapter();

    const msg = adapter.mapWhatsAppMessage({
      key: {
        remoteJid: '1234567890@s.whatsapp.net',
        id: 'MSG001',
      },
      pushName: 'David',
      message: {
        conversation: 'Simple text message',
      },
    });

    expect(msg.content).toBe('Simple text message');
  });

  test('mapWhatsAppMessage extracts text from extendedTextMessage', () => {
    const adapter = new WhatsAppAdapter();

    const msg = adapter.mapWhatsAppMessage({
      key: {
        remoteJid: '1234567890@s.whatsapp.net',
        id: 'MSG002',
      },
      pushName: 'Eve',
      message: {
        extendedTextMessage: {
          text: 'Extended text message',
        },
      },
    });

    expect(msg.content).toBe('Extended text message');
  });

  test('formatForWhatsApp converts markdown', () => {
    const adapter = new WhatsAppAdapter();
    const formatted = adapter.formatForWhatsApp('*bold* _italic_ ~strikethrough~ ```code```');

    // WhatsApp supports markdown natively, so it should pass through
    expect(formatted).toBe('*bold* _italic_ ~strikethrough~ ```code```');
  });

  test('send throws if not initialized', async () => {
    const adapter = new WhatsAppAdapter();
    // Not initialized - should handle gracefully (config is null)
    await expect(
      adapter.send({
        channelName: 'whatsapp',
        recipientId: '1234567890@s.whatsapp.net',
        content: 'test',
        threadId: null,
        metadata: {},
      }),
    ).rejects.toThrow('not initialized');
  });
});
