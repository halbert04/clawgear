import type {
  ChannelAdapter,
  ChannelConfig,
  InboundMessage,
  OutboundMessage,
} from '@clawgear/shared/interfaces';

type MessageHandler = (msg: InboundMessage) => void;

/**
 * WebChat channel adapter — built-in web chat for the ClawGear dashboard.
 *
 * Unlike external adapters (Slack, Discord), WebChat doesn't connect to an
 * external service. Instead, it receives messages from the HTTP API and
 * delivers responses via the WebSocket event bridge.
 *
 * Inbound: HTTP POST -> handleUserMessage() -> onMessage handler -> ChannelRouter
 * Outbound: ChannelRouter -> send() -> emits via callback (picked up by WS bridge)
 */
export class WebChatAdapter implements ChannelAdapter {
  readonly name = 'webchat';
  private messageHandlers: MessageHandler[] = [];
  private outboundCallback: ((msg: OutboundMessage) => void) | null = null;

  async init(_config: ChannelConfig): Promise<void> {
    // WebChat has no external connection to initialize
  }

  async send(message: OutboundMessage): Promise<void> {
    // Deliver to any registered outbound callback (e.g., WebSocket bridge)
    if (this.outboundCallback) {
      this.outboundCallback(message);
    }
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler);
  }

  /**
   * Register a callback for outbound messages (agent -> user).
   * Used by the API layer to stream responses via WebSocket/SSE.
   */
  onOutbound(callback: (msg: OutboundMessage) => void): void {
    this.outboundCallback = callback;
  }

  /**
   * Called by the HTTP API when a user sends a chat message.
   * This triggers the inbound routing pipeline.
   */
  handleUserMessage(params: {
    senderId: string;
    senderName: string;
    content: string;
    threadId?: string;
    metadata?: Record<string, unknown>;
  }): void {
    const msg: InboundMessage = {
      channelName: 'webchat',
      externalId: '',
      senderId: params.senderId,
      senderName: params.senderName,
      content: params.content,
      threadId: params.threadId ?? null,
      metadata: params.metadata ?? {},
    };

    for (const handler of this.messageHandlers) {
      handler(msg);
    }
  }

  async shutdown(): Promise<void> {
    this.messageHandlers = [];
    this.outboundCallback = null;
  }
}
