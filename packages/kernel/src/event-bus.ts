import type { EventBus, EventSubscription, SystemEvent } from '@clawgear/shared';

type EventHandler = (event: SystemEvent) => void;

export class InProcessEventBus implements EventBus {
  private handlers = new Map<string, Set<EventHandler>>();
  private wildcardHandlers = new Set<EventHandler>();

  emit(event: SystemEvent): void {
    // Notify type-specific handlers
    const typeHandlers = this.handlers.get(event.type);
    if (typeHandlers) {
      for (const handler of typeHandlers) {
        try {
          handler(event);
        } catch (err) {
          console.error(`Event handler error for ${event.type}:`, err);
        }
      }
    }

    // Notify wildcard handlers
    for (const handler of this.wildcardHandlers) {
      try {
        handler(event);
      } catch (err) {
        console.error('Wildcard event handler error:', err);
      }
    }
  }

  on(eventType: string, handler: EventHandler): EventSubscription {
    if (eventType === '*') {
      this.wildcardHandlers.add(handler);
      return {
        unsubscribe: () => {
          this.wildcardHandlers.delete(handler);
        },
      };
    }

    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler);

    return {
      unsubscribe: () => {
        this.handlers.get(eventType)?.delete(handler);
      },
    };
  }

  once(eventType: string, handler: EventHandler): EventSubscription {
    const wrappedHandler: EventHandler = (event) => {
      subscription.unsubscribe();
      handler(event);
    };
    const subscription = this.on(eventType, wrappedHandler);
    return subscription;
  }

  listenerCount(eventType?: string): number {
    if (!eventType) {
      let count = this.wildcardHandlers.size;
      for (const handlers of this.handlers.values()) {
        count += handlers.size;
      }
      return count;
    }
    return (this.handlers.get(eventType)?.size ?? 0) + this.wildcardHandlers.size;
  }

  removeAllListeners(): void {
    this.handlers.clear();
    this.wildcardHandlers.clear();
  }
}
