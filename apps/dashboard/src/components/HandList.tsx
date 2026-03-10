import { useState } from 'react';
import type { Hand } from '../api';
import { activateHand, deactivateHand, triggerHand } from '../api';

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'Not scheduled';
  return new Date(dateStr).toLocaleString();
}

interface Props {
  companyId: string;
  hands: Hand[];
  onRefresh: () => void;
}

export function HandList({ companyId, hands, onRefresh }: Props) {
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const handleAction = async (
    handId: string,
    action: (companyId: string, handId: string) => Promise<unknown>,
  ) => {
    setLoadingId(handId);
    try {
      await action(companyId, handId);
      onRefresh();
    } catch (err) {
      console.error('Hand action failed:', err);
    } finally {
      setLoadingId(null);
    }
  };

  if (hands.length === 0) {
    return <div className="empty-state">No hands configured.</div>;
  }

  return (
    <div className="hand-grid">
      {hands.map((hand) => {
        const isLoading = loadingId === hand.id;
        const isActive = hand.status === 'idle' || hand.status === 'running';
        const isTerminated = hand.status === 'terminated';

        return (
          <div key={hand.id} className="hand-card">
            <div className="hand-card-header">
              <h3 className="hand-card-name">{hand.name}</h3>
              <span className={`status-badge status-${hand.status}`}>
                <span className="status-dot" />
                {hand.status}
              </span>
            </div>

            <div className="hand-card-body">
              <div className="hand-card-row">
                <span className="hand-card-label">Last Run</span>
                <span className="hand-card-value">{formatDate(hand.updatedAt)}</span>
              </div>
              <div className="hand-card-row">
                <span className="hand-card-label">Next Run</span>
                <span className="hand-card-value">{formatDate(hand.nextRunAt)}</span>
              </div>
              <div className="hand-card-row">
                <span className="hand-card-label">Cost</span>
                <span className="hand-card-value">
                  ${(hand.spentMonthlyCents / 100).toFixed(2)}
                </span>
              </div>
            </div>

            <div className="hand-card-actions">
              <button
                type="button"
                className="btn btn-sm"
                disabled={isLoading || isTerminated || hand.status === 'running'}
                onClick={() => handleAction(hand.id, triggerHand)}
              >
                Trigger
              </button>
              {isActive ? (
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={isLoading || isTerminated}
                  onClick={() => handleAction(hand.id, deactivateHand)}
                >
                  Deactivate
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={isLoading || isTerminated}
                  onClick={() => handleAction(hand.id, activateHand)}
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
