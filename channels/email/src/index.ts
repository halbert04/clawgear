import type {
  ChannelAdapter,
  ChannelConfig,
  InboundMessage,
  OutboundMessage,
} from '@clawgear/shared/interfaces';

type MessageHandler = (msg: InboundMessage) => void;

export interface EmailConfig extends ChannelConfig {
  imapHost: string;
  imapPort: number;
  imapUser: string;
  imapPassword: string;
  imapTls?: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword: string;
  smtpTls?: boolean;
  fromAddress: string;
  fromName?: string;
  pollIntervalMs?: number;
}

/**
 * Email channel adapter skeleton.
 *
 * Full implementation requires IMAP and SMTP client dependencies.
 * This skeleton implements the ChannelAdapter interface and defines the
 * message mapping patterns. The actual email integration (IMAP connection,
 * SMTP sending, polling loop) will be added when dependencies are installed.
 *
 * Email concepts -> ClawGear mapping:
 * - Email address -> agent (via channel binding)
 * - Email thread (In-Reply-To/References) -> conversation thread (externalThreadId)
 * - Email message -> InboundMessage
 * - Agent response -> HTML email (OutboundMessage)
 */
export class EmailAdapter implements ChannelAdapter {
  readonly name = 'email';
  private messageHandlers: MessageHandler[] = [];
  private config: EmailConfig | null = null;

  async init(config: ChannelConfig): Promise<void> {
    this.config = config as EmailConfig;

    if (!this.config.imapHost) {
      throw new Error('Email adapter requires imapHost in config');
    }
    if (!this.config.smtpHost) {
      throw new Error('Email adapter requires smtpHost in config');
    }
    if (!this.config.fromAddress) {
      throw new Error('Email adapter requires fromAddress in config');
    }

    // TODO: Initialize IMAP connection when dependency is added
    // const imap = new ImapClient({
    //   host: this.config.imapHost,
    //   port: this.config.imapPort,
    //   user: this.config.imapUser,
    //   password: this.config.imapPassword,
    //   tls: this.config.imapTls ?? true,
    // });
    //
    // await imap.connect();
    //
    // TODO: Start polling loop for new messages
    // this.pollInterval = setInterval(async () => {
    //   const messages = await imap.fetchUnread();
    //   for (const msg of messages) {
    //     this.handleEmailMessage(msg);
    //   }
    // }, this.config.pollIntervalMs ?? 30000);
  }

  async send(message: OutboundMessage): Promise<void> {
    if (!this.config) {
      throw new Error('Email adapter not initialized');
    }

    // TODO: Send message via SMTP
    // const transporter = createTransport({
    //   host: this.config.smtpHost,
    //   port: this.config.smtpPort,
    //   secure: this.config.smtpTls ?? true,
    //   auth: {
    //     user: this.config.smtpUser,
    //     pass: this.config.smtpPassword,
    //   },
    // });
    //
    // await transporter.sendMail({
    //   from: this.config.fromName
    //     ? `"${this.config.fromName}" <${this.config.fromAddress}>`
    //     : this.config.fromAddress,
    //   to: message.recipientId,
    //   subject: message.metadata.subject ?? 'Message from ClawGear',
    //   html: this.formatAsHtmlEmail(message.content),
    //   inReplyTo: message.threadId ?? undefined,
    //   references: message.threadId ?? undefined,
    // });
    void message;
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler);
  }

  async shutdown(): Promise<void> {
    // TODO: Disconnect IMAP and stop polling
    // if (this.pollInterval) {
    //   clearInterval(this.pollInterval);
    // }
    // if (this.imapClient) {
    //   await this.imapClient.disconnect();
    // }
    this.messageHandlers = [];
    this.config = null;
  }

  /**
   * Convert an email message to an InboundMessage.
   * Called internally when polling detects a new email.
   */
  mapEmailMessage(email: {
    from: string;
    fromName?: string;
    subject: string;
    textBody: string;
    htmlBody?: string;
    messageId: string;
    inReplyTo?: string;
    references?: string[];
  }): InboundMessage {
    return {
      channelName: 'email',
      externalId: email.from,
      senderId: email.from,
      senderName: email.fromName ?? email.from,
      content: email.textBody,
      threadId: this.extractThreadId(email.inReplyTo, email.references),
      metadata: {
        messageId: email.messageId,
        subject: email.subject,
        htmlBody: email.htmlBody,
      },
    };
  }

  /**
   * Extract thread ID from email headers.
   * Prefers In-Reply-To, falls back to first References entry.
   */
  extractThreadId(inReplyTo?: string, references?: string[]): string | null {
    if (inReplyTo) {
      return inReplyTo;
    }
    if (references && references.length > 0) {
      return references[0]!;
    }
    return null;
  }

  /**
   * Convert markdown content to simple HTML email.
   */
  formatAsHtmlEmail(content: string): string {
    // Split by code blocks for formatting
    let html = '';
    const parts = content.split(/```(\w*)\n?([\s\S]*?)```/);

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!.trim();
      if (!part) continue;

      if (i % 3 === 2) {
        // Code block content
        html += `<pre style="background: #f5f5f5; padding: 12px; border-radius: 4px; overflow-x: auto;"><code>${this.escapeHtml(part)}</code></pre>`;
      } else if (i % 3 === 0) {
        // Regular text - simple paragraph handling
        const paragraphs = part.split('\n\n');
        for (const p of paragraphs) {
          if (p.trim()) {
            html += `<p style="margin: 0 0 12px 0;">${this.escapeHtml(p.replace(/\n/g, '<br>'))}</p>`;
          }
        }
      }
      // i % 3 === 1 is the language identifier, skip it
    }

    // Wrap in basic HTML template
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0; padding: 20px;">
  ${html}
</body>
</html>`.trim();
  }

  /**
   * Escape HTML special characters.
   */
  private escapeHtml(text: string): string {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };
    return text.replace(/[&<>"']/g, (m) => map[m]!);
  }
}
