import { useState } from 'react';
import type { Workflow } from '../api';
import { executeWorkflow } from '../api';

function truncateText(text: string | null, maxLength: number): string {
  if (!text) return 'No description';
  if (text.length <= maxLength) return text;
  return `${text.substring(0, maxLength)}...`;
}

interface Props {
  companyId: string;
  workflows: Workflow[];
  onRefresh: () => void;
}

export function WorkflowList({ companyId, workflows, onRefresh }: Props) {
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const handleExecute = async (workflowId: string) => {
    setLoadingId(workflowId);
    try {
      await executeWorkflow(companyId, workflowId, {});
      onRefresh();
    } catch (err) {
      console.error('Workflow execution failed:', err);
    } finally {
      setLoadingId(null);
    }
  };

  if (workflows.length === 0) {
    return <div className="empty-state">No workflows configured.</div>;
  }

  return (
    <div className="hand-grid">
      {workflows.map((workflow) => {
        const isLoading = loadingId === workflow.id;
        const isActive = workflow.isActive;

        return (
          <div key={workflow.id} className="hand-card">
            <div className="hand-card-header">
              <h3 className="hand-card-name">{workflow.name}</h3>
              <span className={`status-badge status-${isActive ? 'active' : 'inactive'}`}>
                <span className="status-dot" />
                {isActive ? 'active' : 'inactive'}
              </span>
            </div>

            <div className="hand-card-body">
              <div className="hand-card-row">
                <span className="hand-card-label">Description</span>
                <span className="hand-card-value">{truncateText(workflow.description, 100)}</span>
              </div>
              <div className="hand-card-row">
                <span className="hand-card-label">Steps</span>
                <span className="hand-card-value">{workflow.definition?.steps?.length ?? 0}</span>
              </div>
            </div>

            <div className="hand-card-actions">
              <button
                type="button"
                className="btn btn-sm"
                disabled={isLoading || !isActive}
                onClick={() => handleExecute(workflow.id)}
              >
                Run
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
