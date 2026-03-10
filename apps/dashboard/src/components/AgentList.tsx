import { useState } from 'react';
import type { Agent } from '../api';
import { pauseAgent, resumeAgent, terminateAgent } from '../api';

// ============================================================
// Helpers
// ============================================================

function centsToUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function budgetClass(spent: number, limit: number): string {
  if (limit <= 0) return '';
  const ratio = spent / limit;
  if (ratio >= 1) return 'budget-over';
  if (ratio >= 0.8) return 'budget-warning';
  return '';
}

// ============================================================
// Component
// ============================================================

interface Props {
  companyId: string;
  agents: Agent[];
  onRefresh: () => void;
}

export function AgentList({ companyId, agents, onRefresh }: Props) {
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const handleAction = async (
    agentId: string,
    action: (companyId: string, agentId: string) => Promise<Agent>,
  ) => {
    setLoadingId(agentId);
    try {
      await action(companyId, agentId);
      onRefresh();
    } catch (err) {
      console.error('Agent action failed:', err);
    } finally {
      setLoadingId(null);
    }
  };

  if (agents.length === 0) {
    return <div className="empty-state">No agents found.</div>;
  }

  return (
    <div className="agent-table-wrap">
      <table className="agent-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Role</th>
            <th>Status</th>
            <th>Model Tier</th>
            <th>Budget</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {agents.map((agent) => {
            const isLoading = loadingId === agent.id;
            const isTerminated = agent.status === 'terminated';

            return (
              <tr key={agent.id}>
                <td>
                  <div className="agent-name">
                    {agent.icon ? `${agent.icon} ` : ''}
                    {agent.name}
                  </div>
                  {agent.title && <div className="agent-role">{agent.title}</div>}
                </td>
                <td>{agent.role}</td>
                <td>
                  <span className={`status-badge status-${agent.status}`}>
                    <span className="status-dot" />
                    {agent.status}
                  </span>
                </td>
                <td>{agent.modelTier}</td>
                <td>
                  <span
                    className={`budget-cell ${budgetClass(agent.spentMonthlyCents, agent.budgetMonthlyCents)}`}
                  >
                    {centsToUsd(agent.spentMonthlyCents)}
                    {agent.budgetMonthlyCents > 0 && <> / {centsToUsd(agent.budgetMonthlyCents)}</>}
                  </span>
                </td>
                <td>
                  <div className="action-cell">
                    {agent.status === 'paused' ? (
                      <button
                        type="button"
                        className="btn"
                        disabled={isLoading || isTerminated}
                        onClick={() => handleAction(agent.id, resumeAgent)}
                      >
                        Resume
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn"
                        disabled={isLoading || isTerminated || agent.status === 'paused'}
                        onClick={() => handleAction(agent.id, pauseAgent)}
                      >
                        Pause
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-danger"
                      disabled={isLoading || isTerminated}
                      onClick={() => handleAction(agent.id, terminateAgent)}
                    >
                      Terminate
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
