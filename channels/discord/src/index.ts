import type {
  ChannelAdapter,
  ChannelConfig,
  InboundMessage,
  OutboundMessage,
} from '@clawgear/shared/interfaces';

type MessageHandler = (msg: InboundMessage) => void;

export interface DiscordConfig extends ChannelConfig {
  botToken: string;
  guildId?: string;
}

/**
 * Discord channel adapter skeleton.
 *
 * Full implementation requires discord.js dependency.
 * This skeleton implements the ChannelAdapter interface and defines the
 * message mapping patterns. The actual Discord API integration (Client,
 * event subscriptions, gateway) will be added when discord.js is installed.
 *
 * Discord concepts -> ClawGear mapping:
 * - Discord guild -> company (via channel binding config)
 * - Discord channel/DM -> agent (via channel binding)
 * - Discord thread -> conversation thread (externalThreadId)
 * - Discord message -> InboundMessage
 * - Agent response -> Discord embeds (OutboundMessage)
 */
export class DiscordAdapter implements ChannelAdapter {
  readonly name = 'discord';
  private messageHandlers: MessageHandler[] = [];
  private config: DiscordConfig | null = null;

  async init(config: ChannelConfig): Promise<void> {
    this.config = config as DiscordConfig;

    if (!this.config.botToken) {
      throw new Error('Discord adapter requires botToken in config');
    }

    // TODO: Initialize discord.js Client when dependency is added
    // const client = new Client({
    //   intents: [
    //     GatewayIntentBits.Guilds,
    //     GatewayIntentBits.GuildMessages,
    //     GatewayIntentBits.MessageContent,
    //     GatewayIntentBits.DirectMessages,
    //   ],
    // });
    //
    // client.on('messageCreate', async (message) => {
    //   if (message.author.bot) return;
    //   const inbound = this.mapDiscordMessage(message);
    //   for (const handler of this.messageHandlers) {
    //     handler(inbound);
    //   }
    // });
    //
    // await client.login(this.config.botToken);
  }

  async send(message: OutboundMessage): Promise<void> {
    if (!this.config) {
      throw new Error('Discord adapter not initialized');
    }

    // TODO: Send message via Discord API
    // const channel = await client.channels.fetch(message.recipientId);
    // if (channel?.isTextBased()) {
    //   await channel.send({
    //     embeds: [this.formatAsEmbed(message.content)],
    //     reply: message.threadId ? { messageReference: message.threadId } : undefined,
    //   });
    // }
    void message;
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler);
  }

  async shutdown(): Promise<void> {
    // TODO: Destroy discord.js client
    // await client.destroy();
    this.messageHandlers = [];
    this.config = null;
  }

  /**
   * Convert a Discord message to an InboundMessage.
   * Called internally when discord.js receives a message.
   */
  mapDiscordMessage(discordMessage: {
    author: { id: string; username: string; displayName?: string };
    content: string;
    channelId: string;
    id: string;
    reference?: { messageId?: string };
  }): InboundMessage {
    return {
      channelName: 'discord',
      externalId: discordMessage.channelId,
      senderId: discordMessage.author.id,
      senderName: discordMessage.author.displayName ?? discordMessage.author.username,
      content: discordMessage.content,
      threadId: discordMessage.reference?.messageId ?? null,
      metadata: {
        messageId: discordMessage.id,
        channelId: discordMessage.channelId,
      },
    };
  }

  /**
   * Convert plain text to Discord embed format.
   */
  formatAsEmbed(content: string): Record<string, unknown> {
    // Split content into title and description if needed
    const lines = content.split('\n');
    const title = lines[0]!.length > 256 ? `${lines[0]!.substring(0, 253)}...` : lines[0]!;
    const description = lines.slice(1).join('\n') || content;

    return {
      title: title || 'Message',
      description: description.length > 4096 ? `${description.substring(0, 4093)}...` : description,
      color: 0x5865f2, // Discord blurple color
    };
  }
}
