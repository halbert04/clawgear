import { describe, expect, test } from 'bun:test';
import { EmailAdapter } from './index.js';

describe('EmailAdapter', () => {
  test('name is email', () => {
    const adapter = new EmailAdapter();
    expect(adapter.name).toBe('email');
  });

  test('init requires imapHost', async () => {
    const adapter = new EmailAdapter();
    await expect(
      adapter.init({
        smtpHost: 'smtp.example.com',
        fromAddress: 'bot@example.com',
      }),
    ).rejects.toThrow('imapHost');
  });

  test('init requires smtpHost', async () => {
    const adapter = new EmailAdapter();
    await expect(
      adapter.init({
        imapHost: 'imap.example.com',
        fromAddress: 'bot@example.com',
      }),
    ).rejects.toThrow('smtpHost');
  });

  test('init requires fromAddress', async () => {
    const adapter = new EmailAdapter();
    await expect(
      adapter.init({
        imapHost: 'imap.example.com',
        smtpHost: 'smtp.example.com',
      }),
    ).rejects.toThrow('fromAddress');
  });

  test('mapEmailMessage converts to InboundMessage', () => {
    const adapter = new EmailAdapter();

    const msg = adapter.mapEmailMessage({
      from: 'user@example.com',
      fromName: 'Alice Smith',
      subject: 'Test Email',
      textBody: 'Hello from email',
      messageId: '<msg123@example.com>',
      inReplyTo: '<thread456@example.com>',
    });

    expect(msg.channelName).toBe('email');
    expect(msg.externalId).toBe('user@example.com');
    expect(msg.senderId).toBe('user@example.com');
    expect(msg.senderName).toBe('Alice Smith');
    expect(msg.content).toBe('Hello from email');
    expect(msg.threadId).toBe('<thread456@example.com>');
    expect((msg.metadata as Record<string, unknown>).messageId).toBe('<msg123@example.com>');
    expect((msg.metadata as Record<string, unknown>).subject).toBe('Test Email');
  });

  test('mapEmailMessage uses inReplyTo as threadId', () => {
    const adapter = new EmailAdapter();

    const msg = adapter.mapEmailMessage({
      from: 'user@example.com',
      subject: 'Re: Test',
      textBody: 'Reply',
      messageId: '<msg2@example.com>',
      inReplyTo: '<msg1@example.com>',
      references: ['<msg0@example.com>', '<msg1@example.com>'],
    });

    expect(msg.threadId).toBe('<msg1@example.com>');
  });

  test('mapEmailMessage falls back to references for threadId', () => {
    const adapter = new EmailAdapter();

    const msg = adapter.mapEmailMessage({
      from: 'user@example.com',
      subject: 'Re: Test',
      textBody: 'Reply',
      messageId: '<msg2@example.com>',
      references: ['<msg0@example.com>', '<msg1@example.com>'],
    });

    expect(msg.threadId).toBe('<msg0@example.com>');
  });

  test('mapEmailMessage with no reply has null threadId', () => {
    const adapter = new EmailAdapter();

    const msg = adapter.mapEmailMessage({
      from: 'user@example.com',
      subject: 'New Thread',
      textBody: 'Starting new conversation',
      messageId: '<msg1@example.com>',
    });

    expect(msg.threadId).toBeNull();
  });

  test('formatAsHtmlEmail wraps content in HTML', () => {
    const adapter = new EmailAdapter();
    const html = adapter.formatAsHtmlEmail('Hello world');

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<body');
    expect(html).toContain('Hello world');
    expect(html).toContain('</body>');
  });

  test('formatAsHtmlEmail handles code blocks', () => {
    const adapter = new EmailAdapter();
    const html = adapter.formatAsHtmlEmail(
      'Before code\n```js\nconsole.log("hi")\n```\nAfter code',
    );

    expect(html).toContain('<pre');
    expect(html).toContain('<code>');
    expect(html).toContain('console.log');
    expect(html).toContain('Before code');
    expect(html).toContain('After code');
  });

  test('extractThreadId returns from inReplyTo', () => {
    const adapter = new EmailAdapter();
    const threadId = adapter.extractThreadId('<msg1@example.com>', ['<msg0@example.com>']);

    expect(threadId).toBe('<msg1@example.com>');
  });

  test('extractThreadId returns from references array', () => {
    const adapter = new EmailAdapter();
    const threadId = adapter.extractThreadId(undefined, [
      '<msg0@example.com>',
      '<msg1@example.com>',
    ]);

    expect(threadId).toBe('<msg0@example.com>');
  });

  test('send throws if not initialized', async () => {
    const adapter = new EmailAdapter();
    await expect(
      adapter.send({
        channelName: 'email',
        recipientId: 'user@example.com',
        content: 'test',
        threadId: null,
        metadata: {},
      }),
    ).rejects.toThrow('not initialized');
  });
});
