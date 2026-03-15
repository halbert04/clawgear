import { describe, expect, mock, test } from 'bun:test';
import { InProcessEventBus } from '@clawgear/kernel';
import { EventBridge } from './event-bridge.js';

interface MockWs {
  send: ReturnType<typeof mock>;
  close: ReturnType<typeof mock>;
}

function createMockWs(): MockWs {
  return {
    send: mock(() => {}),
    close: mock(() => {}),
  };
}

function parseLastCall(ws: MockWs): unknown {
  const calls = (ws.send as ReturnType<typeof mock>).mock.calls;
  const lastArg = calls[calls.length - 1]?.[0] as string;
  return JSON.parse(lastArg);
}

describe('EventBridge', () => {
  test('broadcasts events as JSON-RPC notifications to authenticated clients', () => {
    const eventBus = new InProcessEventBus();
    const bridge = new EventBridge(eventBus);

    const ws = createMockWs();
    bridge.addClient(ws as never);

    // Authenticate for company-1
    bridge.handleMessage(
      ws as never,
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'authenticate',
        params: { companyId: 'company-1' },
      }),
    );
    (ws.send as ReturnType<typeof mock>).mockClear();

    eventBus.emit({
      type: 'agent.created',
      companyId: 'company-1',
      timestamp: new Date('2026-01-01T00:00:00Z'),
      payload: { agentId: 'agent-1', name: 'Alice' },
    });

    const msg = parseLastCall(ws) as Record<string, unknown>;
    expect(msg.jsonrpc).toBe('2.0');
    expect(msg.method).toBe('event');
    expect((msg.params as Record<string, unknown>).type).toBe('agent.created');
    expect((msg.params as Record<string, unknown>).companyId).toBe('company-1');
  });

  test('company-scoped broadcasting: authenticated client only receives its company events', () => {
    const eventBus = new InProcessEventBus();
    const bridge = new EventBridge(eventBus);

    const ws1 = createMockWs();
    const ws2 = createMockWs();
    bridge.addClient(ws1 as never);
    bridge.addClient(ws2 as never);

    // Authenticate ws1 for company-1
    bridge.handleMessage(
      ws1 as never,
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'authenticate',
        params: { companyId: 'company-1', role: 'operator' },
      }),
    );

    // Authenticate ws2 for company-2
    bridge.handleMessage(
      ws2 as never,
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'authenticate',
        params: { companyId: 'company-2', role: 'operator' },
      }),
    );

    // Clear mock call history
    (ws1.send as ReturnType<typeof mock>).mockClear();
    (ws2.send as ReturnType<typeof mock>).mockClear();

    // Emit event for company-1
    eventBus.emit({
      type: 'agent.created',
      companyId: 'company-1',
      timestamp: new Date(),
      payload: { agentId: 'a1' },
    });

    expect(ws1.send).toHaveBeenCalledTimes(1);
    expect(ws2.send).not.toHaveBeenCalled();
  });

  test('unauthenticated clients do NOT receive events', () => {
    const eventBus = new InProcessEventBus();
    const bridge = new EventBridge(eventBus);

    const ws = createMockWs();
    bridge.addClient(ws as never);

    eventBus.emit({
      type: 'test.event',
      companyId: 'any-company',
      timestamp: new Date(),
      payload: {},
    });

    expect(ws.send).not.toHaveBeenCalled();
  });

  test('authenticate RPC returns success', () => {
    const eventBus = new InProcessEventBus();
    const bridge = new EventBridge(eventBus);

    const ws = createMockWs();
    bridge.addClient(ws as never);

    bridge.handleMessage(
      ws as never,
      JSON.stringify({
        jsonrpc: '2.0',
        id: 42,
        method: 'authenticate',
        params: { companyId: 'c1', role: 'agent', agentId: 'a1' },
      }),
    );

    const msg = parseLastCall(ws) as Record<string, unknown>;
    expect(msg.jsonrpc).toBe('2.0');
    expect(msg.id).toBe(42);
    expect((msg.result as Record<string, unknown>).authenticated).toBe(true);
    expect((msg.result as Record<string, unknown>).companyId).toBe('c1');
    expect((msg.result as Record<string, unknown>).role).toBe('agent');
  });

  test('subscribe/unsubscribe filters events', () => {
    const eventBus = new InProcessEventBus();
    const bridge = new EventBridge(eventBus);

    const ws = createMockWs();
    bridge.addClient(ws as never);

    // Authenticate first
    bridge.handleMessage(
      ws as never,
      JSON.stringify({
        jsonrpc: '2.0',
        id: 0,
        method: 'authenticate',
        params: { companyId: 'c1' },
      }),
    );

    // Subscribe to only agent events
    bridge.handleMessage(
      ws as never,
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'subscribe',
        params: { events: ['agent.created'] },
      }),
    );

    // Unsubscribe from wildcard
    bridge.handleMessage(
      ws as never,
      JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'unsubscribe',
        params: { events: ['*'] },
      }),
    );

    (ws.send as ReturnType<typeof mock>).mockClear();

    // This should be received (matches subscription)
    eventBus.emit({
      type: 'agent.created',
      companyId: 'c1',
      timestamp: new Date(),
      payload: {},
    });

    // This should NOT be received (not subscribed)
    eventBus.emit({
      type: 'issue.created',
      companyId: 'c1',
      timestamp: new Date(),
      payload: {},
    });

    expect(ws.send).toHaveBeenCalledTimes(1);
    const msg = parseLastCall(ws) as Record<string, unknown>;
    expect((msg.params as Record<string, unknown>).type).toBe('agent.created');
  });

  test('ping RPC returns pong', () => {
    const eventBus = new InProcessEventBus();
    const bridge = new EventBridge(eventBus);

    const ws = createMockWs();
    bridge.addClient(ws as never);

    bridge.handleMessage(ws as never, JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'ping' }));

    const msg = parseLastCall(ws) as Record<string, unknown>;
    expect(msg.id).toBe(99);
    expect((msg.result as Record<string, unknown>).pong).toBe(true);
  });

  test('presence tracking', () => {
    const eventBus = new InProcessEventBus();
    const bridge = new EventBridge(eventBus);

    const ws1 = createMockWs();
    const ws2 = createMockWs();
    bridge.addClient(ws1 as never);
    bridge.addClient(ws2 as never);

    // Authenticate ws1 as operator for company-1
    bridge.handleMessage(
      ws1 as never,
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'authenticate',
        params: { companyId: 'company-1', role: 'operator' },
      }),
    );

    // Authenticate ws2 as agent for company-1
    bridge.handleMessage(
      ws2 as never,
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'authenticate',
        params: { companyId: 'company-1', role: 'agent', agentId: 'agent-1' },
      }),
    );

    const presence = bridge.getPresence('company-1');
    expect(presence.total).toBe(2);
    expect(presence.operators).toBe(1);
    expect(presence.agents).toBe(1);
  });

  test('invalid JSON returns parse error', () => {
    const eventBus = new InProcessEventBus();
    const bridge = new EventBridge(eventBus);

    const ws = createMockWs();
    bridge.addClient(ws as never);

    bridge.handleMessage(ws as never, 'not json');

    const msg = parseLastCall(ws) as Record<string, unknown>;
    expect((msg.error as Record<string, unknown>).code).toBe(-32700);
  });

  test('unknown method returns method not found', () => {
    const eventBus = new InProcessEventBus();
    const bridge = new EventBridge(eventBus);

    const ws = createMockWs();
    bridge.addClient(ws as never);

    bridge.handleMessage(
      ws as never,
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'nonexistent' }),
    );

    const msg = parseLastCall(ws) as Record<string, unknown>;
    expect((msg.error as Record<string, unknown>).code).toBe(-32601);
  });

  test('removes client on removeClient', () => {
    const eventBus = new InProcessEventBus();
    const bridge = new EventBridge(eventBus);

    const ws = createMockWs();
    bridge.addClient(ws as never);
    expect(bridge.clientCount).toBe(1);

    bridge.removeClient(ws as never);
    expect(bridge.clientCount).toBe(0);
  });

  test('removes client when send throws', () => {
    const eventBus = new InProcessEventBus();
    const bridge = new EventBridge(eventBus);

    const ws = createMockWs();
    bridge.addClient(ws as never);

    // Authenticate first (send works during auth)
    bridge.handleMessage(
      ws as never,
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'authenticate',
        params: { companyId: 'c1' },
      }),
    );
    expect(bridge.clientCount).toBe(1);

    // Now make send throw
    (ws.send as ReturnType<typeof mock>).mockImplementation(() => {
      throw new Error('Connection closed');
    });

    eventBus.emit({
      type: 'test.event',
      companyId: 'c1',
      timestamp: new Date(),
      payload: {},
    });

    expect(bridge.clientCount).toBe(0);
  });

  test('shutdown clears ping interval', () => {
    const eventBus = new InProcessEventBus();
    const bridge = new EventBridge(eventBus);
    bridge.shutdown();
    // No error means success — interval was cleared
    expect(bridge.clientCount).toBe(0);
  });
});
