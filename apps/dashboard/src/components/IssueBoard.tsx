import type { Agent, Issue } from '../api';

// ============================================================
// Board column configuration
// ============================================================

interface Column {
  key: string;
  label: string;
}

const COLUMNS: Column[] = [
  { key: 'backlog', label: 'Backlog' },
  { key: 'todo', label: 'Todo' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'in_review', label: 'In Review' },
  { key: 'done', label: 'Done' },
];

// ============================================================
// Component
// ============================================================

interface Props {
  issues: Issue[];
  agents: Agent[];
}

export function IssueBoard({ issues, agents }: Props) {
  const agentMap = new Map(agents.map((a) => [a.id, a]));

  // Group issues by status
  const grouped = new Map<string, Issue[]>();
  for (const col of COLUMNS) {
    grouped.set(col.key, []);
  }
  for (const issue of issues) {
    const bucket = grouped.get(issue.status);
    if (bucket) {
      bucket.push(issue);
    }
    // Cancelled issues are excluded from the board
  }

  return (
    <div className="issue-board">
      {COLUMNS.map((col) => {
        const columnIssues = grouped.get(col.key) ?? [];
        return (
          <div key={col.key} className="board-column">
            <div className="column-header">
              <span>{col.label}</span>
              <span className="column-count">{columnIssues.length}</span>
            </div>
            {columnIssues.map((issue) => {
              const assignee = issue.assigneeAgentId ? agentMap.get(issue.assigneeAgentId) : null;
              return (
                <div key={issue.id} className="board-card">
                  <div className="card-id">{issue.identifier}</div>
                  <div className="card-title">{issue.title}</div>
                  <div className="card-meta">
                    <span className={`card-priority priority-${issue.priority}`}>
                      {issue.priority}
                    </span>
                    <span>{assignee ? assignee.name : ''}</span>
                  </div>
                </div>
              );
            })}
            {columnIssues.length === 0 && <div className="empty-state">--</div>}
          </div>
        );
      })}
    </div>
  );
}
