import { useCallback, useEffect, useState } from 'react';
import {
  type ActivityEntry,
  type Agent,
  type Approval,
  type BudgetSummary,
  type Company,
  fetchActivity,
  fetchAgents,
  fetchApprovals,
  fetchBudgetSummary,
  fetchCompanies,
  fetchIssues,
  fetchQualityEvaluations,
  type Issue,
  type QualityEvaluation,
} from './api';
import { AgentList } from './components/AgentList';
import { AttentionQueue } from './components/AttentionQueue';
import { BudgetOverview } from './components/BudgetOverview';
import { IssueBoard } from './components/IssueBoard';
import { useWebSocket } from './hooks/useWebSocket';

type Tab = 'attention' | 'agents' | 'issues' | 'budget';

const TABS: { key: Tab; label: string }[] = [
  { key: 'attention', label: 'Attention Queue' },
  { key: 'agents', label: 'Agents' },
  { key: 'issues', label: 'Issues' },
  { key: 'budget', label: 'Budget' },
];

const POLL_INTERVAL_MS = 15_000;

export function App() {
  const [tab, setTab] = useState<Tab>('attention');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [budgetSummary, setBudgetSummary] = useState<BudgetSummary | null>(null);
  const [evaluations, setEvaluations] = useState<QualityEvaluation[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { events, connected } = useWebSocket();

  // Load companies on mount
  useEffect(() => {
    fetchCompanies()
      .then((res) => {
        setCompanies(res.data);
        if (res.data.length > 0) {
          setSelectedCompanyId(res.data[0]!.id);
        }
      })
      .catch((err) => setError(String(err)));
  }, []);

  // Load all data for selected company
  const loadData = useCallback(async () => {
    if (!selectedCompanyId) return;
    try {
      const [agentsRes, issuesRes, approvalsRes, budgetRes, evalsRes, activityRes] =
        await Promise.all([
          fetchAgents(selectedCompanyId),
          fetchIssues(selectedCompanyId),
          fetchApprovals(selectedCompanyId),
          fetchBudgetSummary(selectedCompanyId),
          fetchQualityEvaluations(selectedCompanyId),
          fetchActivity(selectedCompanyId),
        ]);
      setAgents(agentsRes.data);
      setIssues(issuesRes.data);
      setApprovals(approvalsRes.data);
      setBudgetSummary(budgetRes);
      setEvaluations(evalsRes.data);
      setActivity(activityRes.data);
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [selectedCompanyId]);

  useEffect(() => {
    setLoading(true);
    loadData();
  }, [loadData]);

  // Poll for fresh data
  useEffect(() => {
    if (!selectedCompanyId) return;
    const interval = setInterval(loadData, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [selectedCompanyId, loadData]);

  // Reload when relevant WS events arrive
  useEffect(() => {
    if (events.length === 0) return;
    const latest = events[0];
    if (!latest || latest.companyId !== selectedCompanyId) return;
    // Debounce: only reload on meaningful events
    const type = latest.type;
    if (
      type.startsWith('agent.') ||
      type.startsWith('issue.') ||
      type.startsWith('approval.') ||
      type.startsWith('budget.') ||
      type.startsWith('quality.') ||
      type.startsWith('activity.')
    ) {
      loadData();
    }
  }, [events, selectedCompanyId, loadData]);

  return (
    <div className="app-layout">
      <header className="app-header">
        <h1>
          <span>&gt;</span> ClawGear
        </h1>
        <div className="header-right">
          <select
            className="company-select"
            value={selectedCompanyId}
            onChange={(e) => setSelectedCompanyId(e.target.value)}
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            {companies.length === 0 && <option value="">No companies</option>}
          </select>
          <div className="ws-indicator">
            <div className={`ws-dot ${connected ? 'connected' : ''}`} />
            {connected ? 'live' : 'disconnected'}
          </div>
        </div>
      </header>

      <div className="tab-bar">
        {TABS.map((t) => (
          <button
            type="button"
            key={t.key}
            className={`tab-btn ${tab === t.key ? 'active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <main className="main-content">
        {error && <div className="error-state">{error}</div>}
        {loading && !error && <div className="loading-state">Loading...</div>}
        {!loading && !error && (
          <>
            {tab === 'attention' && (
              <AttentionQueue
                companyId={selectedCompanyId}
                agents={agents}
                approvals={approvals}
                evaluations={evaluations}
                budgetSummary={budgetSummary}
                issues={issues}
                activity={activity}
                onRefresh={loadData}
              />
            )}
            {tab === 'agents' && (
              <AgentList companyId={selectedCompanyId} agents={agents} onRefresh={loadData} />
            )}
            {tab === 'issues' && <IssueBoard issues={issues} agents={agents} />}
            {tab === 'budget' && <BudgetOverview budgetSummary={budgetSummary} agents={agents} />}
          </>
        )}
      </main>
    </div>
  );
}
