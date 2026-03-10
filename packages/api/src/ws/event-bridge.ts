import type { EventBus, SystemEvent } from '@clawgear/shared';
import type { WSContext } from 'hono/ws';

type WSClient = WSContext<unknown>;

// ============================================================
// JSON-RPC PROTOCOL TYPES
// ============================================================

export interface WsRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface WsRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface WsRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params: Record<string, unknown>;
}

// ============================================================
// CLIENT SESSION
// ============================================================

export interface ClientSession {
  ws: WSClient;
  companyId: string | null;
  role: 'operator' | 'agent';
  agentId: string | null;
  subscribedEvents: Set<string>; // event type filters, '*' = all
  connectedAt: Date;
  lastPingAt: Date;
}

// ============================================================
// EVENT BRIDGE (WebSocket Gateway)
// ============================================================

const PING_INTERVAL_MS = 30_000;
const PONG_TIMEOUT_MS = 10_000;

export class EventBridge {
  private clients = new Map<WSClient, ClientSession>();
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  constructor(eventBus: EventBus) {
    eventBus.on('*', (event: SystemEvent) => {
      this.broadcastEvent(event);
    });

    this.startPingLoop();
  }

  addClient(ws: WSClient): void {
    const session: ClientSession = {
      ws,
      companyId: null,
      role: 'operator',
      agentId: null,
      subscribedEvents: new Set(['*']),
      connectedAt: new Date(),
      lastPingAt: new Date(),
    };
    this.clients.set(ws, session);
  }

  removeClient(ws: WSClient): void {
    this.clients.delete(ws);
  }

  handleMessage(ws: WSClient, data: string): void {
    const session = this.clients.get(ws);
    if (!session) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      this.sendError(ws, null, -32700, 'Parse error');
      return;
    }

    const msg = parsed as Record<string, unknown>;

    // Handle pong responses (update lastPingAt)
    if (msg.method === 'pong') {
      session.lastPingAt = new Date();
      return;
    }

    // JSON-RPC must have method
    if (typeof msg.method !== 'string') {
      this.sendError(ws, (msg.id as string | number) ?? null, -32600, 'Invalid request');
      return;
    }

    const id = (msg.id as string | number) ?? null;
    const params = (msg.params as Record<string, unknown>) ?? {};

    switch (msg.method) {
      case 'authenticate':
        this.handleAuthenticate(ws, session, id, params);
        break;
      case 'subscribe':
        this.handleSubscribe(ws, session, id, params);
        break;
      case 'unsubscribe':
        this.handleUnsubscribe(ws, session, id, params);
        break;
      case 'presence':
        this.handlePresence(ws, session, id);
        break;
      case 'ping':
        this.sendResult(ws, id, { pong: true, timestamp: new Date().toISOString() });
        session.lastPingAt = new Date();
        break;
      default:
        this.sendError(ws, id, -32601, `Method not found: ${msg.method}`);
    }
  }

  get clientCount(): number {
    return this.clients.size;
  }

  getPresence(companyId?: string): {
    total: number;
    operators: number;
    agents: number;
    clients: Array<{ role: string; agentId: string | null; connectedAt: string }>;
  } {
    const sessions = companyId
      ? [...this.clients.values()].filter((s) => s.companyId === companyId)
      : [...this.clients.values()];

    return {
      total: sessions.length,
      operators: sessions.filter((s) => s.role === 'operator').length,
      agents: sessions.filter((s) => s.role === 'agent').length,
      clients: sessions.map((s) => ({
        role: s.role,
        agentId: s.agentId,
        connectedAt: s.connectedAt.toISOString(),
      })),
    };
  }

  shutdown(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  // ----------------------------------------------------------
  // RPC HANDLERS
  // ----------------------------------------------------------

  private handleAuthenticate(
    ws: WSClient,
    session: ClientSession,
    id: string | number | null,
    params: Record<string, unknown>,
  ): void {
    const { companyId, role, agentId } = params;

    if (!companyId || typeof companyId !== 'string') {
      this.sendError(ws, id, -32602, 'companyId is required');
      return;
    }

    session.companyId = companyId;
    session.role = role === 'agent' ? 'agent' : 'operator';
    session.agentId = typeof agentId === 'string' ? agentId : null;

    this.sendResult(ws, id, {
      authenticated: true,
      companyId: session.companyId,
      role: session.role,
    });
  }

  private handleSubscribe(
    ws: WSClient,
    session: ClientSession,
    id: string | number | null,
    params: Record<string, unknown>,
  ): void {
    const events = params.events;
    if (!Array.isArray(events)) {
      this.sendError(ws, id, -32602, 'events must be an array of event type strings');
      return;
    }

    for (const evt of events) {
      if (typeof evt === 'string') {
        session.subscribedEvents.add(evt);
      }
    }

    this.sendResult(ws, id, {
      subscribed: [...session.subscribedEvents],
    });
  }

  private handleUnsubscribe(
    ws: WSClient,
    session: ClientSession,
    id: string | number | null,
    params: Record<string, unknown>,
  ): void {
    const events = params.events;
    if (!Array.isArray(events)) {
      this.sendError(ws, id, -32602, 'events must be an array of event type strings');
      return;
    }

    for (const evt of events) {
      if (typeof evt === 'string') {
        session.subscribedEvents.delete(evt);
      }
    }

    this.sendResult(ws, id, {
      subscribed: [...session.subscribedEvents],
    });
  }

  private handlePresence(ws: WSClient, session: ClientSession, id: string | number | null): void {
    const presence = session.companyId ? this.getPresence(session.companyId) : this.getPresence();

    this.sendResult(ws, id, presence);
  }

  // ----------------------------------------------------------
  // BROADCASTING
  // ----------------------------------------------------------

  private broadcastEvent(event: SystemEvent): void {
    const notification: WsRpcNotification = {
      jsonrpc: '2.0',
      method: 'event',
      params: {
        type: event.type,
        companyId: event.companyId,
        timestamp: event.timestamp.toISOString(),
        payload: event.payload,
      },
    };
    const message = JSON.stringify(notification);

    for (const [ws, session] of this.clients) {
      // Company scoping: only send to clients authenticated for this company
      // Unauthenticated clients (companyId=null) receive all events for backward compatibility
      if (session.companyId && session.companyId !== event.companyId) {
        continue;
      }

      // Event type filtering
      if (!session.subscribedEvents.has('*') && !session.subscribedEvents.has(event.type)) {
        continue;
      }

      try {
        ws.send(message);
      } catch {
        this.clients.delete(ws);
      }
    }
  }

  // ----------------------------------------------------------
  // PING / PONG
  // ----------------------------------------------------------

  private startPingLoop(): void {
    this.pingInterval = setInterval(() => {
      const now = Date.now();

      for (const [ws, session] of this.clients) {
        // If client hasn't responded to ping within timeout, disconnect
        if (now - session.lastPingAt.getTime() > PING_INTERVAL_MS + PONG_TIMEOUT_MS) {
          try {
            ws.close(1000, 'Ping timeout');
          } catch {
            // ignore
          }
          this.clients.delete(ws);
          continue;
        }

        // Send ping
        const ping: WsRpcNotification = {
          jsonrpc: '2.0',
          method: 'ping',
          params: { timestamp: new Date().toISOString() },
        };
        try {
          ws.send(JSON.stringify(ping));
        } catch {
          this.clients.delete(ws);
        }
      }
    }, PING_INTERVAL_MS);
  }

  // ----------------------------------------------------------
  // HELPERS
  // ----------------------------------------------------------

  private sendResult(ws: WSClient, id: string | number | null, result: unknown): void {
    const response: WsRpcResponse = { jsonrpc: '2.0', id, result };
    try {
      ws.send(JSON.stringify(response));
    } catch {
      this.clients.delete(ws);
    }
  }

  private sendError(ws: WSClient, id: string | number | null, code: number, message: string): void {
    const response: WsRpcResponse = {
      jsonrpc: '2.0',
      id,
      error: { code, message },
    };
    try {
      ws.send(JSON.stringify(response));
    } catch {
      this.clients.delete(ws);
    }
  }
}
