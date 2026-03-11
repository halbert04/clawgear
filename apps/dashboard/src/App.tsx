import { useCallback, useEffect, useState } from 'react';
import {
  type ActivityEntry,
  type Agent,
  type Approval,
  type BudgetSummary,
  type ChannelBinding,
  type Company,
  type EvolvedSkill,
  fetchActivity,
  fetchAgents,
  fetchApprovals,
  fetchBudgetSummary,
  fetchChannelBindings,
  fetchCompanies,
  fetchEvolvedSkills,
  fetchHands,
  fetchIssues,
  fetchQualityEvaluations,
  fetchStrategies,
  fetchTeamCompetence,
  fetchTriggers,
  fetchWorkflows,
  type Hand,
  type Issue,
  type QualityEvaluation,
  type StrategyPattern,
  type TeamCompetence,
  type Trigger,
  type Workflow,
} from './api';
import { AgentList } from './components/AgentList';
import { AttentionQueue } from './components/AttentionQueue';
import { BudgetOverview } from './components/BudgetOverview';
import { ChannelStatus } from './components/ChannelStatus';
import { EvolutionDashboard } from './components/EvolutionDashboard';
import { HandList } from './components/HandList';
import { IssueBoard } from './components/IssueBoard';
import { TriggerList } from './components/TriggerList';
import { WorkflowList } from './components/WorkflowList';
import { useWebSocket } from './hooks/useWebSocket';

type Tab =
  | 'attention'
  | 'agents'
  | 'issues'
  | 'budget'
  | 'hands'
  | 'channels'
  | 'triggers'
  | 'workflows'
  | 'evolution';

const TABS: { key: Tab; label: string }[] = [
  { key: 'attention', label: 'Attention Queue' },
  { key: 'agents', label: 'Agents' },
  { key: 'issues', label: 'Issues' },
  { key: 'budget', label: 'Budget' },
  { key: 'hands', label: 'Hands' },
  { key: 'channels', label: 'Channels' },
  { key: 'triggers', label: 'Triggers' },
  { key: 'workflows', label: 'Workflows' },
  { key: 'evolution', label: 'Evolution' },
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
  const [hands, setHands] = useState<Hand[]>([]);
  const [evolvedSkills, setEvolvedSkills] = useState<EvolvedSkill[]>([]);
  const [teamCompetence, setTeamCompetence] = useState<TeamCompetence[]>([]);
  const [strategyPatterns, setStrategyPatterns] = useState<StrategyPattern[]>([]);
  const [triggersList, setTriggersList] = useState<Trigger[]>([]);
  const [workflowsList, setWorkflowsList] = useState<Workflow[]>([]);
  const [channelBindings, setChannelBindings] = useState<ChannelBinding[]>([]);
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
      const [
        agentsRes,
        issuesRes,
        approvalsRes,
        budgetRes,
        evalsRes,
        activityRes,
        handsRes,
        skillsRes,
        competenceRes,
        strategiesRes,
        triggersRes,
        workflowsRes,
        channelBindingsRes,
      ] = await Promise.all([
        fetchAgents(selectedCompanyId),
        fetchIssues(selectedCompanyId),
        fetchApprovals(selectedCompanyId),
        fetchBudgetSummary(selectedCompanyId),
        fetchQualityEvaluations(selectedCompanyId),
        fetchActivity(selectedCompanyId),
        fetchHands(selectedCompanyId),
        fetchEvolvedSkills(selectedCompanyId),
        fetchTeamCompetence(selectedCompanyId),
        fetchStrategies(selectedCompanyId),
        fetchTriggers(selectedCompanyId),
        fetchWorkflows(selectedCompanyId),
        fetchChannelBindings(selectedCompanyId),
      ]);
      setAgents(agentsRes.data);
      setIssues(issuesRes.data);
      setApprovals(approvalsRes.data);
      setBudgetSummary(budgetRes);
      setEvaluations(evalsRes.data);
      setActivity(activityRes.data);
      setHands(handsRes.data);
      setEvolvedSkills(skillsRes.data);
      setTeamCompetence(competenceRes.data);
      setStrategyPatterns(strategiesRes.data);
      setTriggersList(triggersRes.data);
      setWorkflowsList(workflowsRes.data);
      setChannelBindings(channelBindingsRes.data);
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
      type.startsWith('activity.') ||
      type.startsWith('hand.') ||
      type.startsWith('channel.') ||
      type.startsWith('trigger.') ||
      type.startsWith('workflow.') ||
      type.startsWith('evolution.')
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
            {tab === 'hands' && (
              <HandList companyId={selectedCompanyId} hands={hands} onRefresh={loadData} />
            )}
            {tab === 'channels' && <ChannelStatus bindings={channelBindings} agents={agents} />}
            {tab === 'triggers' && (
              <TriggerList
                companyId={selectedCompanyId}
                triggers={triggersList}
                onRefresh={loadData}
              />
            )}
            {tab === 'workflows' && (
              <WorkflowList
                companyId={selectedCompanyId}
                workflows={workflowsList}
                onRefresh={loadData}
              />
            )}
            {tab === 'evolution' && (
              <EvolutionDashboard
                companyId={selectedCompanyId}
                skills={evolvedSkills}
                competence={teamCompetence}
                strategies={strategyPatterns}
                onRefresh={loadData}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}
