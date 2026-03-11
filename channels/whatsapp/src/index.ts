import type {
  ChannelAdapter,
  ChannelConfig,
  InboundMessage,
  OutboundMessage,
} from '@clawgear/shared/interfaces';

type MessageHandler = (msg: InboundMessage) => void;

export interface WhatsAppConfig extends ChannelConfig {
  authDir?: string; // Session storage path
  phoneNumber?: string;
}

/**
 * WhatsApp channel adapter skeleton.
 *
 * Full implementation requires @whiskeysockets/baileys dependency.
 * This skeleton implements the ChannelAdapter interface and defines the
 * message mapping patterns. The actual WhatsApp integration (makeWASocket,
 * auth state, message handling) will be added when @whiskeysockets/baileys is installed.
 *
 * WhatsApp concepts -> ClawGear mapping:
 * - WhatsApp account -> company (via channel binding config)
 * - WhatsApp chat/DM -> agent (via channel binding)
 * - WhatsApp quoted message -> conversation thread (threadId)
 * - WhatsApp message -> InboundMessage
 * - Agent response -> WhatsApp message (OutboundMessage)
 */
export class WhatsAppAdapter implements ChannelAdapter {
  readonly name = 'whatsapp';
  private messageHandlers: MessageHandler[] = [];
  private config: WhatsAppConfig | null = null;

  async init(config: ChannelConfig): Promise<void> {
    this.config = config as WhatsAppConfig;

    // TODO: Initialize @whiskeysockets/baileys makeWASocket when dependency is added
    // const { state, saveCreds } = await useMultiFileAuthState(
    //   this.config.authDir ?? './auth_info_baileys'
    // );
    //
    // const sock = makeWASocket({
    //   auth: state,
    //   printQRInTerminal: true,
    // });
    //
    // sock.ev.on('creds.update', saveCreds);
    //
    // sock.ev.on('messages.upsert', async (m) => {
    //   const message = m.messages[0];
    //   if (!message.message) return;
    //   const inbound = this.mapWhatsAppMessage(message);
    //   for (const handler of this.messageHandlers) {
    //     handler(inbound);
    //   }
    // });
  }

  async send(message: OutboundMessage): Promise<void> {
    if (!this.config) {
      throw new Error('WhatsApp adapter not initialized');
    }

    // TODO: Send message via WhatsApp API
    // const formatted = this.formatForWhatsApp(message.content);
    // await sock.sendMessage(message.recipientId, {
    //   text: formatted,
    // });
    void message;
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler);
  }

  async shutdown(): Promise<void> {
    // TODO: Stop WhatsApp socket
    // await sock.end();
    this.messageHandlers = [];
    this.config = null;
  }

  /**
   * Convert a WhatsApp message event to an InboundMessage.
   * Called internally when Baileys receives a message.
   */
  mapWhatsAppMessage(waMessage: {
    key: {
      remoteJid?: string;
      id?: string;
      participant?: string;
    };
    pushName?: string;
    message?: {
      conversation?: string;
      extendedTextMessage?: {
        text?: string;
        contextInfo?: {
          quotedMessage?: Record<string, unknown>;
        };
      };
    };
  }): InboundMessage {
    const remoteJid = waMessage.key.remoteJid ?? 'unknown';
    const isGroup = remoteJid.includes('@g.us');
    const senderId = isGroup ? (waMessage.key.participant ?? 'unknown') : remoteJid;
    const senderName = waMessage.pushName ?? senderId;

    // Extract text content
    const content =
      waMessage.message?.conversation ?? waMessage.message?.extendedTextMessage?.text ?? '';

    // Handle quoted message (reply) as thread
    const threadId = waMessage.message?.extendedTextMessage?.contextInfo?.quotedMessage
      ? (waMessage.key.id ?? null)
      : null;

    return {
      channelName: 'whatsapp',
      externalId: remoteJid,
      senderId,
      senderName,
      content,
      threadId,
      metadata: {
        messageId: waMessage.key.id,
        isGroup,
      },
    };
  }

  /**
   * Convert markdown to WhatsApp formatting.
   * WhatsApp supports: *bold*, _italic_, ~strikethrough~, ```code```
   */
  formatForWhatsApp(content: string): string {
    // WhatsApp uses similar markdown formatting
    // This is a basic pass-through since WhatsApp supports standard markdown
    return content;
  }
}
