import type { Agent, BudgetSummary } from '../api';

// ============================================================
// Helpers
// ============================================================

function centsToUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function pct(spent: number, budget: number): number {
  if (budget <= 0) return 0;
  return Math.min((spent / budget) * 100, 100);
}

function barClass(spent: number, budget: number): string {
  if (budget <= 0) return 'ok';
  const ratio = spent / budget;
  if (ratio >= 1) return 'danger';
  if (ratio >= 0.8) return 'warning';
  return 'ok';
}

// ============================================================
// Component
// ============================================================

interface Props {
  budgetSummary: BudgetSummary | null;
  agents: Agent[];
}

export function BudgetOverview({ budgetSummary, agents }: Props) {
  if (!budgetSummary) {
    return <div className="empty-state">No budget data available.</div>;
  }

  const { budgetMonthlyCents, spentMonthlyCents, totalCostCents } = budgetSummary;
  const remaining = Math.max(0, budgetMonthlyCents - spentMonthlyCents);
  const usagePct = pct(spentMonthlyCents, budgetMonthlyCents);

  // Agents with a budget set, sorted by spend ratio descending
  const agentsWithBudget = agents
    .filter((a) => a.budgetMonthlyCents > 0)
    .sort((a, b) => {
      const ratioA = a.spentMonthlyCents / a.budgetMonthlyCents;
      const ratioB = b.spentMonthlyCents / b.budgetMonthlyCents;
      return ratioB - ratioA;
    });

  return (
    <div className="budget-overview">
      {/* Company Summary */}
      <div className="budget-card">
        <h3>Company Budget</h3>
        <div className="budget-numbers">
          <div className="budget-stat">
            <span className="budget-stat-label">Monthly Budget</span>
            <span className="budget-stat-value">{centsToUsd(budgetMonthlyCents)}</span>
          </div>
          <div className="budget-stat">
            <span className="budget-stat-label">Spent This Month</span>
            <span className="budget-stat-value">{centsToUsd(spentMonthlyCents)}</span>
          </div>
          <div className="budget-stat">
            <span className="budget-stat-label">Remaining</span>
            <span className="budget-stat-value">{centsToUsd(remaining)}</span>
          </div>
        </div>
        <div className="progress-bar-wrap">
          <div className="progress-bar">
            <div
              className={`progress-bar-fill ${barClass(spentMonthlyCents, budgetMonthlyCents)}`}
              style={{ width: `${usagePct}%` }}
            />
          </div>
          <div className="progress-label">{usagePct.toFixed(1)}% used</div>
        </div>
        {totalCostCents !== spentMonthlyCents && (
          <div className="budget-stat" style={{ marginTop: 12 }}>
            <span className="budget-stat-label">All-Time Total Cost</span>
            <span className="budget-stat-value" style={{ fontSize: 16 }}>
              {centsToUsd(totalCostCents)}
            </span>
          </div>
        )}
      </div>

      {/* Per-Agent Breakdown */}
      {agentsWithBudget.length > 0 && (
        <div className="budget-card">
          <h3>Agent Budgets</h3>
          <div className="agent-budget-list">
            {agentsWithBudget.map((agent) => {
              const agentPct = pct(agent.spentMonthlyCents, agent.budgetMonthlyCents);
              return (
                <div key={agent.id} className="agent-budget-row">
                  <div className="agent-budget-header">
                    <span className="agent-budget-name">
                      {agent.icon ? `${agent.icon} ` : ''}
                      {agent.name}
                      <span style={{ color: 'var(--text-muted)', fontWeight: 400, marginLeft: 8 }}>
                        {agent.role}
                      </span>
                    </span>
                    <span className="agent-budget-amount">
                      {centsToUsd(agent.spentMonthlyCents)} / {centsToUsd(agent.budgetMonthlyCents)}
                    </span>
                  </div>
                  <div className="progress-bar-wrap">
                    <div className="progress-bar">
                      <div
                        className={`progress-bar-fill ${barClass(agent.spentMonthlyCents, agent.budgetMonthlyCents)}`}
                        style={{ width: `${agentPct}%` }}
                      />
                    </div>
                    <div className="progress-label">{agentPct.toFixed(1)}%</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Agents without budget */}
      {agents.filter((a) => a.budgetMonthlyCents <= 0 && a.spentMonthlyCents > 0).length > 0 && (
        <div className="budget-card">
          <h3>Agents Without Budget Limit</h3>
          <div className="agent-budget-list">
            {agents
              .filter((a) => a.budgetMonthlyCents <= 0 && a.spentMonthlyCents > 0)
              .sort((a, b) => b.spentMonthlyCents - a.spentMonthlyCents)
              .map((agent) => (
                <div key={agent.id} className="agent-budget-row">
                  <div className="agent-budget-header">
                    <span className="agent-budget-name">
                      {agent.icon ? `${agent.icon} ` : ''}
                      {agent.name}
                      <span style={{ color: 'var(--text-muted)', fontWeight: 400, marginLeft: 8 }}>
                        {agent.role}
                      </span>
                    </span>
                    <span className="agent-budget-amount">
                      {centsToUsd(agent.spentMonthlyCents)} (no limit)
                    </span>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
