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

describe('EventBridge', () => {
  test('broadcasts events to connected clients', () => {
    const eventBus = new InProcessEventBus();
    const bridge = new EventBridge(eventBus);

    const ws1 = createMockWs();
    const ws2 = createMockWs();
    bridge.addClient(ws1 as never);
    bridge.addClient(ws2 as never);

    eventBus.emit({
      type: 'agent.created',
      companyId: 'company-1',
      timestamp: new Date('2026-01-01T00:00:00Z'),
      payload: { agentId: 'agent-1', name: 'Alice' },
    });

    const expected = JSON.stringify({
      type: 'agent.created',
      companyId: 'company-1',
      timestamp: '2026-01-01T00:00:00.000Z',
      payload: { agentId: 'agent-1', name: 'Alice' },
    });

    expect(ws1.send).toHaveBeenCalledWith(expected);
    expect(ws2.send).toHaveBeenCalledWith(expected);
  });

  test('removes client on removeClient', () => {
    const eventBus = new InProcessEventBus();
    const bridge = new EventBridge(eventBus);

    const ws = createMockWs();
    bridge.addClient(ws as never);
    expect(bridge.clientCount).toBe(1);

    bridge.removeClient(ws as never);
    expect(bridge.clientCount).toBe(0);

    eventBus.emit({
      type: 'test.event',
      companyId: 'c1',
      timestamp: new Date(),
      payload: {},
    });

    expect(ws.send).not.toHaveBeenCalled();
  });

  test('removes client when send throws', () => {
    const eventBus = new InProcessEventBus();
    const bridge = new EventBridge(eventBus);

    const ws = createMockWs();
    (ws.send as ReturnType<typeof mock>).mockImplementation(() => {
      throw new Error('Connection closed');
    });

    bridge.addClient(ws as never);
    expect(bridge.clientCount).toBe(1);

    eventBus.emit({
      type: 'test.event',
      companyId: 'c1',
      timestamp: new Date(),
      payload: {},
    });

    expect(bridge.clientCount).toBe(0);
  });
});
