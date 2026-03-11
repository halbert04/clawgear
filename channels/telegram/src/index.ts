import type {
  ChannelAdapter,
  ChannelConfig,
  InboundMessage,
  OutboundMessage,
} from '@clawgear/shared/interfaces';

type MessageHandler = (msg: InboundMessage) => void;

export interface TelegramConfig extends ChannelConfig {
  botToken: string;
  webhookUrl?: string;
  allowedChatIds?: string[];
}

/**
 * Telegram channel adapter skeleton.
 *
 * Full implementation requires grammY dependency.
 * This skeleton implements the ChannelAdapter interface and defines the
 * message mapping patterns. The actual Telegram Bot API integration (grammY Bot,
 * webhook or polling mode) will be added when grammY is installed.
 *
 * Telegram concepts -> ClawGear mapping:
 * - Telegram bot -> agent (via channel binding config)
 * - Telegram chat (user/group/channel) -> conversation (externalId)
 * - Telegram message thread -> conversation thread (threadId)
 * - Telegram message -> InboundMessage
 * - Agent response -> Telegram message with MarkdownV2 formatting (OutboundMessage)
 */
export class TelegramAdapter implements ChannelAdapter {
  readonly name = 'telegram';
  private messageHandlers: MessageHandler[] = [];
  private config: TelegramConfig | null = null;

  async init(config: ChannelConfig): Promise<void> {
    this.config = config as TelegramConfig;

    if (!this.config.botToken) {
      throw new Error('Telegram adapter requires botToken in config');
    }

    // TODO: Initialize grammY Bot when dependency is added
    // const bot = new Bot(this.config.botToken);
    //
    // bot.on('message:text', async (ctx) => {
    //   const inbound = this.mapTelegramMessage({
    //     from: ctx.from,
    //     text: ctx.message.text,
    //     chat: ctx.chat,
    //     message_id: ctx.message.message_id,
    //     reply_to_message: ctx.message.reply_to_message,
    //   });
    //
    //   // Filter by allowed chat IDs if configured
    //   if (this.config.allowedChatIds &&
    //       !this.config.allowedChatIds.includes(String(ctx.chat.id))) {
    //     return;
    //   }
    //
    //   for (const handler of this.messageHandlers) {
    //     handler(inbound);
    //   }
    // });
    //
    // if (this.config.webhookUrl) {
    //   await bot.api.setWebhook(this.config.webhookUrl);
    // } else {
    //   bot.start();
    // }
  }

  async send(message: OutboundMessage): Promise<void> {
    if (!this.config) {
      throw new Error('Telegram adapter not initialized');
    }

    // TODO: Send message via Telegram Bot API
    // await bot.api.sendMessage(message.recipientId,
    //   this.formatAsMarkdownV2(message.content), {
    //   parse_mode: 'MarkdownV2',
    //   reply_to_message_id: message.threadId ? Number(message.threadId) : undefined,
    // });
    void message;
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler);
  }

  async shutdown(): Promise<void> {
    // TODO: Stop grammY bot
    // await bot.stop();
    this.messageHandlers = [];
    this.config = null;
  }

  /**
   * Convert a Telegram message to an InboundMessage.
   * Called internally when grammY receives a message.
   */
  mapTelegramMessage(telegramMessage: {
    from: {
      id: number;
      first_name: string;
      last_name?: string;
      username?: string;
    };
    text: string;
    chat: { id: number };
    message_id: number;
    reply_to_message?: { message_id: number };
  }): InboundMessage {
    const displayName =
      [telegramMessage.from.first_name, telegramMessage.from.last_name]
        .filter(Boolean)
        .join(' ')
        .trim() ||
      telegramMessage.from.username ||
      String(telegramMessage.from.id);

    return {
      channelName: 'telegram',
      externalId: String(telegramMessage.chat.id),
      senderId: String(telegramMessage.from.id),
      senderName: displayName,
      content: telegramMessage.text,
      threadId: telegramMessage.reply_to_message?.message_id
        ? String(telegramMessage.reply_to_message.message_id)
        : null,
      metadata: {
        message_id: telegramMessage.message_id,
        chat_id: telegramMessage.chat.id,
        username: telegramMessage.from.username,
      },
    };
  }

  /**
   * Escape special characters for Telegram MarkdownV2 format.
   * MarkdownV2 requires escaping: _ * [ ] ( ) ~ ` > # + - = | { } . !
   */
  formatAsMarkdownV2(content: string): string {
    // Characters that need escaping in MarkdownV2
    const specialChars = /([_*[\]()~`>#+\-=|{}.!\\])/g;
    return content.replace(specialChars, '\\$1');
  }
}
