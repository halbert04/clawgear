import type { EventBus, SystemEvent } from '@clawgear/shared';
import type { WSContext } from 'hono/ws';

type WSClient = WSContext<unknown>;

export class EventBridge {
  private clients = new Set<WSClient>();

  constructor(eventBus: EventBus) {
    // Subscribe to all events and forward to connected WebSocket clients
    eventBus.on('*', (event: SystemEvent) => {
      this.broadcast(event);
    });
  }

  addClient(ws: WSClient): void {
    this.clients.add(ws);
  }

  removeClient(ws: WSClient): void {
    this.clients.delete(ws);
  }

  get clientCount(): number {
    return this.clients.size;
  }

  private broadcast(event: SystemEvent): void {
    const message = JSON.stringify({
      type: event.type,
      companyId: event.companyId,
      timestamp: event.timestamp.toISOString(),
      payload: event.payload,
    });

    for (const client of this.clients) {
      try {
        client.send(message);
      } catch {
        // Client disconnected, remove it
        this.clients.delete(client);
      }
    }
  }
}
