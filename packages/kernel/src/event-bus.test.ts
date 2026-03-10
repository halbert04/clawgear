import { describe, expect, mock, test } from 'bun:test';
import type { SystemEvent } from '@clawgear/shared';
import { InProcessEventBus } from './event-bus.js';

function makeEvent(type: string, companyId = 'test-company'): SystemEvent {
  return {
    type,
    companyId,
    timestamp: new Date(),
    payload: {},
  };
}

describe('InProcessEventBus', () => {
  test('emits events to registered handlers', () => {
    const bus = new InProcessEventBus();
    const handler = mock(() => {});

    bus.on('test.event', handler);
    bus.emit(makeEvent('test.event'));

    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('does not call handlers for different event types', () => {
    const bus = new InProcessEventBus();
    const handler = mock(() => {});

    bus.on('test.event', handler);
    bus.emit(makeEvent('other.event'));

    expect(handler).toHaveBeenCalledTimes(0);
  });

  test('wildcard handler receives all events', () => {
    const bus = new InProcessEventBus();
    const handler = mock(() => {});

    bus.on('*', handler);
    bus.emit(makeEvent('test.event'));
    bus.emit(makeEvent('other.event'));

    expect(handler).toHaveBeenCalledTimes(2);
  });

  test('unsubscribe removes handler', () => {
    const bus = new InProcessEventBus();
    const handler = mock(() => {});

    const sub = bus.on('test.event', handler);
    bus.emit(makeEvent('test.event'));
    sub.unsubscribe();
    bus.emit(makeEvent('test.event'));

    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('once fires handler only once', () => {
    const bus = new InProcessEventBus();
    const handler = mock(() => {});

    bus.once('test.event', handler);
    bus.emit(makeEvent('test.event'));
    bus.emit(makeEvent('test.event'));

    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('handler errors do not break other handlers', () => {
    const bus = new InProcessEventBus();
    const errorHandler = mock(() => {
      throw new Error('handler error');
    });
    const goodHandler = mock(() => {});

    bus.on('test.event', errorHandler);
    bus.on('test.event', goodHandler);
    bus.emit(makeEvent('test.event'));

    expect(errorHandler).toHaveBeenCalledTimes(1);
    expect(goodHandler).toHaveBeenCalledTimes(1);
  });

  test('listenerCount tracks handlers correctly', () => {
    const bus = new InProcessEventBus();

    expect(bus.listenerCount()).toBe(0);

    bus.on('a', () => {});
    bus.on('b', () => {});
    bus.on('*', () => {});

    expect(bus.listenerCount()).toBe(3);
    expect(bus.listenerCount('a')).toBe(2); // 1 specific + 1 wildcard
    expect(bus.listenerCount('b')).toBe(2);
    expect(bus.listenerCount('c')).toBe(1); // only wildcard
  });

  test('removeAllListeners clears everything', () => {
    const bus = new InProcessEventBus();
    const handler = mock(() => {});

    bus.on('test.event', handler);
    bus.on('*', handler);
    bus.removeAllListeners();
    bus.emit(makeEvent('test.event'));

    expect(handler).toHaveBeenCalledTimes(0);
  });

  test('passes event payload to handler', () => {
    const bus = new InProcessEventBus();
    let received: SystemEvent | null = null;

    bus.on('test.event', (event) => {
      received = event;
    });

    const event = makeEvent('test.event');
    event.payload = { key: 'value' };
    bus.emit(event);

    expect(received).not.toBeNull();
    expect(received!.payload).toEqual({ key: 'value' });
    expect(received!.type).toBe('test.event');
  });
});
