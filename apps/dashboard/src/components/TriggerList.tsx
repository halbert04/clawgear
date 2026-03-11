import { useState } from 'react';
import type { Trigger } from '../api';
import { activateTrigger, deactivateTrigger } from '../api';

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  return new Date(dateStr).toLocaleString();
}

interface Props {
  companyId: string;
  triggers: Trigger[];
  onRefresh: () => void;
}

export function TriggerList({ companyId, triggers, onRefresh }: Props) {
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const handleAction = async (
    triggerId: string,
    action: (companyId: string, triggerId: string) => Promise<unknown>,
  ) => {
    setLoadingId(triggerId);
    try {
      await action(companyId, triggerId);
      onRefresh();
    } catch (err) {
      console.error('Trigger action failed:', err);
    } finally {
      setLoadingId(null);
    }
  };

  if (triggers.length === 0) {
    return <div className="empty-state">No triggers configured.</div>;
  }

  return (
    <div className="hand-grid">
      {triggers.map((trigger) => {
        const isLoading = loadingId === trigger.id;
        const isActive = trigger.isActive;

        return (
          <div key={trigger.id} className="hand-card">
            <div className="hand-card-header">
              <h3 className="hand-card-name">{trigger.name}</h3>
              <span className={`status-badge status-${isActive ? 'active' : 'inactive'}`}>
                <span className="status-dot" />
                {isActive ? 'active' : 'inactive'}
              </span>
            </div>

            <div className="hand-card-body">
              <div className="hand-card-row">
                <span className="hand-card-label">Pattern</span>
                <span className="hand-card-value">{trigger.patternType}</span>
              </div>
              <div className="hand-card-row">
                <span className="hand-card-label">Action</span>
                <span className="hand-card-value">{trigger.actionType}</span>
              </div>
              <div className="hand-card-row">
                <span className="hand-card-label">Fire Count</span>
                <span className="hand-card-value">
                  {trigger.fireCount}
                  {trigger.maxFireCount ? ` / ${trigger.maxFireCount}` : ''}
                </span>
              </div>
              <div className="hand-card-row">
                <span className="hand-card-label">Last Fired</span>
                <span className="hand-card-value">{formatDate(trigger.lastFiredAt)}</span>
              </div>
            </div>

            <div className="hand-card-actions">
              {isActive ? (
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={isLoading}
                  onClick={() => handleAction(trigger.id, deactivateTrigger)}
                >
                  Deactivate
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={isLoading}
                  onClick={() => handleAction(trigger.id, activateTrigger)}
                >
                  Activate
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
