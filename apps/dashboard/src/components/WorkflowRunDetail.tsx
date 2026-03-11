import { useEffect, useState } from 'react';
import {
  cancelWorkflowRun,
  fetchWorkflowRunDetail,
  type WorkflowRunDetail as RunDetail,
} from '../api';

interface Props {
  companyId: string;
  runId: string;
  onBack: () => void;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleString();
}

function statusColor(status: string): string {
  switch (status) {
    case 'completed':
      return 'status-idle';
    case 'running':
      return 'status-running';
    case 'failed':
      return 'status-error';
    case 'cancelled':
    case 'skipped':
      return 'status-paused';
    default:
      return '';
  }
}

export function WorkflowRunDetail({ companyId, runId, onBack }: Props) {
  const [run, setRun] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    fetchWorkflowRunDetail(companyId, runId)
      .then(setRun)
      .catch((err) => console.error('Failed to load run:', err))
      .finally(() => setLoading(false));
  }, [companyId, runId]);

  const handleCancel = async () => {
    setCancelling(true);
    try {
      await cancelWorkflowRun(companyId, runId);
      const updated = await fetchWorkflowRunDetail(companyId, runId);
      setRun(updated);
    } catch (err) {
      console.error('Failed to cancel run:', err);
    } finally {
      setCancelling(false);
    }
  };

  if (loading) return <div className="loading-state">Loading run...</div>;
  if (!run) return <div className="empty-state">Run not found.</div>;

  return (
    <div>
      <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <button type="button" className="btn btn-sm" onClick={onBack}>
          Back
        </button>
        <h3 style={{ margin: 0 }}>Run {runId.slice(0, 8)}</h3>
        <span className={`status-badge ${statusColor(run.status)}`}>
          <span className="status-dot" />
          {run.status}
        </span>
        {run.status === 'running' && (
          <button type="button" className="btn btn-sm" disabled={cancelling} onClick={handleCancel}>
            Cancel
          </button>
        )}
      </div>

      <div style={{ marginBottom: '1rem', fontSize: '0.85rem', opacity: 0.8 }}>
        <span>Started: {formatDate(run.startedAt)}</span>
        {run.finishedAt && (
          <span style={{ marginLeft: '1rem' }}>Finished: {formatDate(run.finishedAt)}</span>
        )}
        <span style={{ marginLeft: '1rem' }}>
          Progress: {run.currentStepIndex}/{run.totalSteps}
        </span>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <th style={{ textAlign: 'left', padding: '0.5rem' }}>#</th>
            <th style={{ textAlign: 'left', padding: '0.5rem' }}>Step</th>
            <th style={{ textAlign: 'left', padding: '0.5rem' }}>Mode</th>
            <th style={{ textAlign: 'left', padding: '0.5rem' }}>Status</th>
            <th style={{ textAlign: 'left', padding: '0.5rem' }}>Agent</th>
            <th style={{ textAlign: 'left', padding: '0.5rem' }}>Started</th>
            <th style={{ textAlign: 'left', padding: '0.5rem' }}>Finished</th>
          </tr>
        </thead>
        <tbody>
          {run.steps.map((step) => (
            <tr key={step.id} style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={{ padding: '0.5rem' }}>{step.stepIndex}</td>
              <td style={{ padding: '0.5rem' }}>{step.stepName}</td>
              <td style={{ padding: '0.5rem' }}>{step.mode}</td>
              <td style={{ padding: '0.5rem' }}>
                <span className={`status-badge ${statusColor(step.status)}`}>
                  <span className="status-dot" />
                  {step.status}
                </span>
              </td>
              <td style={{ padding: '0.5rem' }}>{step.agentId?.slice(0, 8) ?? '-'}</td>
              <td style={{ padding: '0.5rem' }}>{formatDate(step.startedAt)}</td>
              <td style={{ padding: '0.5rem' }}>{formatDate(step.finishedAt)}</td>
            </tr>
          ))}
          {run.steps.length === 0 && (
            <tr>
              <td colSpan={7} style={{ padding: '1rem', textAlign: 'center', opacity: 0.5 }}>
                No steps recorded yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {run.steps.some((s) => s.errorMessage) && (
        <div style={{ marginTop: '1rem' }}>
          <h4>Errors</h4>
          {run.steps
            .filter((s) => s.errorMessage)
            .map((s) => (
              <div
                key={s.id}
                style={{ fontSize: '0.85rem', marginBottom: '0.5rem', color: 'var(--error)' }}
              >
                <strong>{s.stepName}:</strong> {s.errorMessage}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
