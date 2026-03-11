import { useEffect, useRef } from 'react';
import { isTauri, sendNativeNotification, updateTrayStatus } from './useTauri';
import type { WsEvent } from './useWebSocket';

/**
 * Hook that monitors WebSocket events and triggers native notifications
 * for urgent attention queue items. Also updates the tray status indicator.
 *
 * Gracefully no-ops when running in a browser (non-Tauri) for notifications,
 * but falls back to browser Notification API.
 */
export function useDesktopNotifications(events: WsEvent[]): void {
  const lastEventTimestamp = useRef<string>('');
  const notifiedEvents = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (events.length === 0) return;
    const latest = events[0];
    if (!latest || latest.timestamp === lastEventTimestamp.current) return;
    lastEventTimestamp.current = latest.timestamp;

    // Deduplicate notifications
    const eventKey = `${latest.type}:${latest.timestamp}`;
    if (notifiedEvents.current.has(eventKey)) return;
    notifiedEvents.current.add(eventKey);

    // Cap the set size to prevent memory leaks
    if (notifiedEvents.current.size > 500) {
      const entries = Array.from(notifiedEvents.current);
      notifiedEvents.current = new Set(entries.slice(-250));
    }

    // Notify on important events
    const { type, payload } = latest;
    const p = payload as Record<string, unknown>;

    if (type === 'quality.gate_failed' || type === 'quality.evaluation_failed') {
      sendNativeNotification({
        title: 'Quality Gate Failed',
        body: `Agent ${p.agentName || 'unknown'} failed quality evaluation`,
      });
    } else if (type === 'approval.requested') {
      sendNativeNotification({
        title: 'Approval Required',
        body: `${p.type || 'Action'} requires your approval`,
      });
    } else if (type === 'budget.exceeded') {
      sendNativeNotification({
        title: 'Budget Exceeded',
        body: `${p.agentName || 'Agent'} has exceeded its budget`,
      });
    } else if (type === 'budget.warning') {
      sendNativeNotification({
        title: 'Budget Warning',
        body: `${p.agentName || 'Agent'} is at ${p.percentUsed || '80+'}% of budget`,
      });
    } else if (type === 'agent.error' || type === 'agent.stuck') {
      sendNativeNotification({
        title: 'Agent Issue',
        body: `Agent ${p.agentName || 'unknown'} needs attention`,
      });
    }
  }, [events]);

  // Update tray status based on recent event patterns
  useEffect(() => {
    if (!isTauri()) return;

    const recentEvents = events.slice(0, 50);
    let urgentCount = 0;
    let warningCount = 0;

    for (const event of recentEvents) {
      if (
        event.type === 'quality.gate_failed' ||
        event.type === 'agent.error' ||
        event.type === 'budget.exceeded'
      ) {
        urgentCount++;
      } else if (
        event.type === 'approval.requested' ||
        event.type === 'budget.warning' ||
        event.type === 'agent.stuck'
      ) {
        warningCount++;
      }
    }

    if (urgentCount > 0) {
      updateTrayStatus('error');
    } else if (warningCount > 0) {
      updateTrayStatus('warning');
    } else {
      updateTrayStatus('healthy');
    }
  }, [events]);
}
