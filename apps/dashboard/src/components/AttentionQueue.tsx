import { useState } from 'react';
import type {
  ActivityEntry,
  Agent,
  Approval,
  BudgetSummary,
  Issue,
  QualityEvaluation,
} from '../api';
import { approveApproval, pauseAgent, rejectApproval, resumeAgent } from '../api';

// ============================================================
// Types
// ============================================================

type QueueItemType = 'urgent' | 'approval' | 'warning' | 'stuck' | 'info';

interface QueueItem {
  id: string;
  type: QueueItemType;
  label: string;
  description: string;
  detail: string;
  timestamp: string;
  score: number;
  actions?: QueueAction[];
}

interface QueueAction {
  label: string;
  variant: 'default' | 'approve' | 'reject' | 'danger';
  onClick: () => Promise<void>;
}

// ============================================================
// Priority scoring
// ============================================================

const SEVERITY_WEIGHT: Record<QueueItemType, number> = {
  urgent: 100,
  approval: 80,
  warning: 60,
  stuck: 40,
  info: 10,
};

function computeScore(type: QueueItemType, createdAt: string): number {
  const hoursSince = Math.max(0, (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60));
  return SEVERITY_WEIGHT[type] * (1 / (1 + hoursSince));
}

// ============================================================
// Helpers
// ============================================================

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function centsToUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// ============================================================
// Build queue items
// ============================================================

function buildQueueItems(
  companyId: string,
  agents: Agent[],
  approvals: Approval[],
  evaluations: QualityEvaluation[],
  budgetSummary: BudgetSummary | null,
  issues: Issue[],
  activity: ActivityEntry[],
  onRefresh: () => void,
): QueueItem[] {
  const items: QueueItem[] = [];
  const agentMap = new Map(agents.map((a) => [a.id, a]));

  // 1. URGENT: Quality gate failures (failed evaluations)
  const failedEvals = evaluations.filter((e) => !e.passed);
  for (const ev of failedEvals) {
    const agent = agentMap.get(ev.agentId);
    items.push({
      id: `eval-${ev.id}`,
      type: 'urgent',
      label: 'URGENT',
      description: `Quality gate failed: score ${(ev.overallScore * 100).toFixed(0)}%`,
      detail: agent ? `Agent: ${agent.name}` : `Agent: ${ev.agentId.slice(0, 8)}`,
      timestamp: ev.createdAt,
      score: computeScore('urgent', ev.createdAt),
    });
  }

  // 2. APPROVAL: Pending approval requests
  for (const approval of approvals) {
    const agent = approval.requestedByAgentId ? agentMap.get(approval.requestedByAgentId) : null;
    const requesterName = agent ? agent.name : 'Unknown agent';
    items.push({
      id: `approval-${approval.id}`,
      type: 'approval',
      label: 'APPROVAL',
      description: `${approval.type.replace(/_/g, ' ')} requested by ${requesterName}`,
      detail: summarizePayload(approval.payload),
      timestamp: approval.createdAt,
      score: computeScore('approval', approval.createdAt),
      actions: [
        {
          label: 'Approve',
          variant: 'approve',
          onClick: async () => {
            await approveApproval(companyId, approval.id);
            onRefresh();
          },
        },
        {
          label: 'Reject',
          variant: 'reject',
          onClick: async () => {
            await rejectApproval(companyId, approval.id);
            onRefresh();
          },
        },
      ],
    });
  }

  // 3. WARNING: Budget alerts at 80%+
  if (budgetSummary && budgetSummary.budgetMonthlyCents > 0) {
    const ratio = budgetSummary.spentMonthlyCents / budgetSummary.budgetMonthlyCents;
    if (ratio >= 0.8) {
      items.push({
        id: 'budget-company-warning',
        type: ratio >= 1 ? 'urgent' : 'warning',
        label: ratio >= 1 ? 'URGENT' : 'WARNING',
        description:
          ratio >= 1
            ? `Company budget exceeded: ${centsToUsd(budgetSummary.spentMonthlyCents)} / ${centsToUsd(budgetSummary.budgetMonthlyCents)}`
            : `Company budget at ${(ratio * 100).toFixed(0)}%: ${centsToUsd(budgetSummary.spentMonthlyCents)} / ${centsToUsd(budgetSummary.budgetMonthlyCents)}`,
        detail: 'Monthly budget threshold reached',
        timestamp: new Date().toISOString(),
        score: computeScore(ratio >= 1 ? 'urgent' : 'warning', new Date().toISOString()),
      });
    }
  }

  // Per-agent budget warnings
  for (const agent of agents) {
    if (agent.budgetMonthlyCents > 0) {
      const ratio = agent.spentMonthlyCents / agent.budgetMonthlyCents;
      if (ratio >= 0.8) {
        items.push({
          id: `budget-agent-${agent.id}`,
          type: ratio >= 1 ? 'urgent' : 'warning',
          label: ratio >= 1 ? 'URGENT' : 'WARNING',
          description:
            ratio >= 1
              ? `${agent.name} budget exceeded: ${centsToUsd(agent.spentMonthlyCents)} / ${centsToUsd(agent.budgetMonthlyCents)}`
              : `${agent.name} budget at ${(ratio * 100).toFixed(0)}%: ${centsToUsd(agent.spentMonthlyCents)} / ${centsToUsd(agent.budgetMonthlyCents)}`,
          detail: `Role: ${agent.role}`,
          timestamp: agent.updatedAt,
          score: computeScore(ratio >= 1 ? 'urgent' : 'warning', agent.updatedAt),
        });
      }
    }
  }

  // 4. STUCK: Agents in error state, or issues locked too long (>2 hours)
  for (const agent of agents) {
    if (agent.status === 'error') {
      items.push({
        id: `stuck-agent-${agent.id}`,
        type: 'stuck',
        label: 'STUCK',
        description: `${agent.name} is in error state`,
        detail: `Role: ${agent.role}`,
        timestamp: agent.updatedAt,
        score: computeScore('stuck', agent.updatedAt),
        actions: [
          {
            label: 'Resume',
            variant: 'default',
            onClick: async () => {
              await resumeAgent(companyId, agent.id);
              onRefresh();
            },
          },
          {
            label: 'Pause',
            variant: 'default',
            onClick: async () => {
              await pauseAgent(companyId, agent.id);
              onRefresh();
            },
          },
        ],
      });
    }
  }

  const twoHoursMs = 2 * 60 * 60 * 1000;
  for (const issue of issues) {
    if (issue.status === 'in_progress' && issue.executionLockedAt) {
      const lockedDuration = Date.now() - new Date(issue.executionLockedAt).getTime();
      if (lockedDuration > twoHoursMs) {
        const agent = issue.assigneeAgentId ? agentMap.get(issue.assigneeAgentId) : null;
        items.push({
          id: `stuck-issue-${issue.id}`,
          type: 'stuck',
          label: 'STUCK',
          description: `${issue.identifier} locked for ${Math.floor(lockedDuration / (1000 * 60 * 60))}h`,
          detail: agent ? `Assignee: ${agent.name}` : 'No assignee',
          timestamp: issue.executionLockedAt,
          score: computeScore('stuck', issue.executionLockedAt),
        });
      }
    }
  }

  // 5. INFO: Recent activity (last 10)
  const recentActivity = activity.slice(0, 10);
  for (const entry of recentActivity) {
    items.push({
      id: `activity-${entry.id}`,
      type: 'info',
      label: 'INFO',
      description: `${entry.actorType}:${entry.actorId.slice(0, 8)} ${entry.action} ${entry.entityType}`,
      detail: entry.entityId ? entry.entityId.slice(0, 8) : '',
      timestamp: entry.createdAt,
      score: computeScore('info', entry.createdAt),
    });
  }

  // Sort by priority score descending
  items.sort((a, b) => b.score - a.score);

  return items;
}

function summarizePayload(payload: Record<string, unknown>): string {
  const keys = Object.keys(payload);
  if (keys.length === 0) return '';
  // Show first couple of key-value pairs
  return keys
    .slice(0, 3)
    .map((k) => {
      const v = payload[k];
      const display = typeof v === 'string' ? v : JSON.stringify(v);
      const short =
        typeof display === 'string' && display.length > 40 ? `${display.slice(0, 40)}...` : display;
      return `${k}: ${short}`;
    })
    .join(', ');
}

// ============================================================
// Component
// ============================================================

interface Props {
  companyId: string;
  agents: Agent[];
  approvals: Approval[];
  evaluations: QualityEvaluation[];
  budgetSummary: BudgetSummary | null;
  issues: Issue[];
  activity: ActivityEntry[];
  onRefresh: () => void;
}

export function AttentionQueue({
  companyId,
  agents,
  approvals,
  evaluations,
  budgetSummary,
  issues,
  activity,
  onRefresh,
}: Props) {
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const items = buildQueueItems(
    companyId,
    agents,
    approvals,
    evaluations,
    budgetSummary,
    issues,
    activity,
    onRefresh,
  );

  const handleAction = async (itemId: string, action: QueueAction) => {
    setActionLoading(itemId);
    try {
      await action.onClick();
    } catch (err) {
      console.error('Action failed:', err);
    } finally {
      setActionLoading(null);
    }
  };

  if (items.length === 0) {
    return (
      <div className="attention-queue">
        <div className="queue-header">
          <h2>Attention Queue</h2>
        </div>
        <div className="empty-state">All clear -- nothing needs your attention.</div>
      </div>
    );
  }

  return (
    <div className="attention-queue">
      <div className="queue-header">
        <h2>Attention Queue</h2>
        <span className="queue-count">{items.length} items</span>
      </div>
      {items.map((item) => (
        <div key={item.id} className={`queue-item type-${item.type}`}>
          <span className={`badge badge-${item.type}`}>{item.label}</span>
          <div className="queue-item-desc">
            <div>{item.description}</div>
            {item.detail && <div className="detail">{item.detail}</div>}
          </div>
          <span className="queue-item-time">{timeAgo(item.timestamp)}</span>
          <div className="queue-item-actions">
            {item.actions?.map((action) => (
              <button
                type="button"
                key={action.label}
                className={`btn ${action.variant !== 'default' ? `btn-${action.variant}` : ''}`}
                disabled={actionLoading === item.id}
                onClick={() => handleAction(item.id, action)}
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
