import type {
  ChannelAdapter,
  ChannelConfig,
  InboundMessage,
  OutboundMessage,
} from '@clawgear/shared/interfaces';

type MessageHandler = (msg: InboundMessage) => void;

export interface TeamsConfig extends ChannelConfig {
  appId: string;
  appPassword: string;
  tenantId?: string;
}

/**
 * Microsoft Teams channel adapter skeleton.
 *
 * Full implementation requires botbuilder dependency.
 * This skeleton implements the ChannelAdapter interface and defines the
 * message mapping patterns. The actual Teams Bot Framework integration
 * (BotFrameworkAdapter, turnContext) will be added when botbuilder is installed.
 *
 * Teams concepts -> ClawGear mapping:
 * - Teams tenant -> company (via channel binding config)
 * - Teams channel/chat -> agent (via channel binding)
 * - Teams thread -> conversation thread (replyToId)
 * - Teams activity -> InboundMessage
 * - Agent response -> Teams adaptive card (OutboundMessage)
 */
export class TeamsAdapter implements ChannelAdapter {
  readonly name = 'teams';
  private messageHandlers: MessageHandler[] = [];
  private config: TeamsConfig | null = null;

  async init(config: ChannelConfig): Promise<void> {
    this.config = config as TeamsConfig;

    if (!this.config.appId) {
      throw new Error('Teams adapter requires appId in config');
    }
    if (!this.config.appPassword) {
      throw new Error('Teams adapter requires appPassword in config');
    }

    // TODO: Initialize BotFrameworkAdapter when dependency is added
    // const adapter = new BotFrameworkAdapter({
    //   appId: this.config.appId,
    //   appPassword: this.config.appPassword,
    // });
    //
    // const server = restify.createServer();
    // server.post('/api/messages', async (req, res) => {
    //   await adapter.processActivity(req, res, async (turnContext) => {
    //     if (turnContext.activity.type === 'message') {
    //       this.handleTeamsMessage(turnContext.activity);
    //     }
    //   });
    // });
    //
    // await server.listen(process.env.PORT || 3978);
  }

  async send(message: OutboundMessage): Promise<void> {
    if (!this.config) {
      throw new Error('Teams adapter not initialized');
    }

    // TODO: Send message via Teams Bot Framework
    // await turnContext.sendActivity({
    //   type: 'message',
    //   attachments: [{
    //     contentType: 'application/vnd.microsoft.card.adaptive',
    //     content: this.formatAsAdaptiveCard(message.content),
    //   }],
    //   replyToId: message.threadId ?? undefined,
    // });
    void message;
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler);
  }

  async shutdown(): Promise<void> {
    // TODO: Stop Bot Framework server
    this.messageHandlers = [];
    this.config = null;
  }

  /**
   * Convert a Teams activity to an InboundMessage.
   * Called internally when BotFrameworkAdapter receives a message.
   */
  mapTeamsMessage(teamsActivity: {
    from: { id: string; name?: string };
    text: string;
    channelId: string;
    id: string;
    conversation: { id: string };
    replyToId?: string;
    channelData?: { teamsChannelId?: string };
  }): InboundMessage {
    return {
      channelName: 'teams',
      externalId: teamsActivity.channelData?.teamsChannelId ?? teamsActivity.conversation.id,
      senderId: teamsActivity.from.id,
      senderName: teamsActivity.from.name ?? teamsActivity.from.id,
      content: teamsActivity.text,
      threadId: teamsActivity.replyToId ?? null,
      metadata: {
        activityId: teamsActivity.id,
        conversationId: teamsActivity.conversation.id,
        channelId: teamsActivity.channelId,
      },
    };
  }

  /**
   * Convert plain text to Adaptive Card format.
   */
  formatAsAdaptiveCard(content: string): Record<string, unknown> {
    return {
      type: 'AdaptiveCard',
      version: '1.4',
      body: [
        {
          type: 'TextBlock',
          text: content,
          wrap: true,
        },
      ],
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    };
  }
}
