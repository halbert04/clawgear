import type {
  ChannelAdapter,
  ChannelConfig,
  InboundMessage,
  OutboundMessage,
} from '@clawgear/shared/interfaces';

type MessageHandler = (msg: InboundMessage) => void;

export interface SlackConfig extends ChannelConfig {
  botToken: string;
  signingSecret: string;
  appToken?: string; // Socket mode
}

/**
 * Slack channel adapter skeleton.
 *
 * Full implementation requires @slack/bolt dependency.
 * This skeleton implements the ChannelAdapter interface and defines the
 * message mapping patterns. The actual Slack API integration (bolt app,
 * event subscriptions, socket mode) will be added when @slack/bolt is installed.
 *
 * Slack concepts -> ClawGear mapping:
 * - Slack workspace -> company (via channel binding config)
 * - Slack channel/DM -> agent (via channel binding)
 * - Slack thread -> conversation thread (externalThreadId)
 * - Slack message -> InboundMessage
 * - Agent response -> Slack blocks (OutboundMessage)
 */
export class SlackAdapter implements ChannelAdapter {
  readonly name = 'slack';
  private messageHandlers: MessageHandler[] = [];
  private config: SlackConfig | null = null;

  async init(config: ChannelConfig): Promise<void> {
    this.config = config as SlackConfig;

    if (!this.config.botToken) {
      throw new Error('Slack adapter requires botToken in config');
    }
    if (!this.config.signingSecret) {
      throw new Error('Slack adapter requires signingSecret in config');
    }

    // TODO: Initialize @slack/bolt App when dependency is added
    // const app = new App({
    //   token: this.config.botToken,
    //   signingSecret: this.config.signingSecret,
    //   socketMode: !!this.config.appToken,
    //   appToken: this.config.appToken,
    // });
    //
    // app.message(async ({ message, say }) => {
    //   this.handleSlackMessage(message);
    // });
    //
    // await app.start();
  }

  async send(message: OutboundMessage): Promise<void> {
    if (!this.config) {
      throw new Error('Slack adapter not initialized');
    }

    // TODO: Send message via Slack API
    // await slackClient.chat.postMessage({
    //   channel: message.recipientId,
    //   thread_ts: message.threadId ?? undefined,
    //   blocks: this.formatAsBlocks(message.content),
    //   text: message.content, // fallback for notifications
    // });
    void message;
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler);
  }

  async shutdown(): Promise<void> {
    // TODO: Stop @slack/bolt app
    this.messageHandlers = [];
    this.config = null;
  }

  /**
   * Convert a Slack message event to an InboundMessage.
   * Called internally when @slack/bolt receives a message.
   */
  mapSlackMessage(slackEvent: {
    user: string;
    text: string;
    channel: string;
    ts: string;
    thread_ts?: string;
    user_profile?: { display_name?: string; real_name?: string };
  }): InboundMessage {
    return {
      channelName: 'slack',
      externalId: slackEvent.channel,
      senderId: slackEvent.user,
      senderName:
        slackEvent.user_profile?.display_name ??
        slackEvent.user_profile?.real_name ??
        slackEvent.user,
      content: slackEvent.text,
      threadId: slackEvent.thread_ts ?? null,
      metadata: {
        ts: slackEvent.ts,
        channel: slackEvent.channel,
      },
    };
  }

  /**
   * Convert plain text to Slack blocks format.
   */
  formatAsBlocks(content: string): Array<Record<string, unknown>> {
    // Split by code blocks for formatting
    const blocks: Array<Record<string, unknown>> = [];
    const parts = content.split(/```(\w*)\n?([\s\S]*?)```/);

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!.trim();
      if (!part) continue;

      if (i % 3 === 2) {
        // Code block content
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `\`\`\`${part}\`\`\``,
          },
        });
      } else if (i % 3 === 0) {
        // Regular text
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: part,
          },
        });
      }
      // i % 3 === 1 is the language identifier, skip it
    }

    return blocks.length > 0
      ? blocks
      : [{ type: 'section', text: { type: 'mrkdwn', text: content } }];
  }
}
