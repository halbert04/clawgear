import { useState } from 'react';
import type { EvolvedSkill, StrategyPattern, TeamCompetence } from '../api';
import { approveSkill, deprecateSkill } from '../api';

interface EvolutionDashboardProps {
  companyId: string;
  skills: EvolvedSkill[];
  competence: TeamCompetence[];
  strategies: StrategyPattern[];
  onRefresh: () => void;
}

type Section = 'skills' | 'competence' | 'strategies';

export function EvolutionDashboard({
  companyId,
  skills,
  competence,
  strategies,
  onRefresh,
}: EvolutionDashboardProps) {
  const [section, setSection] = useState<Section>('skills');

  return (
    <div>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        {(['skills', 'competence', 'strategies'] as Section[]).map((s) => (
          <button
            type="button"
            key={s}
            className={`tab-btn ${section === s ? 'active' : ''}`}
            onClick={() => setSection(s)}
          >
            {s === 'skills'
              ? 'Evolved Skills'
              : s === 'competence'
                ? 'Team Competence'
                : 'Strategy Patterns'}
          </button>
        ))}
      </div>

      {section === 'skills' && (
        <SkillsSection companyId={companyId} skills={skills} onRefresh={onRefresh} />
      )}
      {section === 'competence' && <CompetenceSection competence={competence} />}
      {section === 'strategies' && <StrategiesSection strategies={strategies} />}
    </div>
  );
}

function SkillsSection({
  companyId,
  skills,
  onRefresh,
}: {
  companyId: string;
  skills: EvolvedSkill[];
  onRefresh: () => void;
}) {
  const proposed = skills.filter((s) => s.status === 'proposed');
  const active = skills.filter((s) => s.status === 'active');
  const deprecated = skills.filter((s) => s.status === 'deprecated');

  const handleApprove = async (skillId: string) => {
    await approveSkill(companyId, skillId);
    onRefresh();
  };

  const handleDeprecate = async (skillId: string) => {
    await deprecateSkill(companyId, skillId);
    onRefresh();
  };

  return (
    <div>
      {proposed.length > 0 && (
        <>
          <h3>Pending Approval ({proposed.length})</h3>
          <div className="card-grid">
            {proposed.map((s) => (
              <div key={s.id} className="card" style={{ borderLeft: '3px solid #f59e0b' }}>
                <div className="card-header">
                  <strong>{s.name}</strong>
                  <span className="badge badge-warning">v{s.version} proposed</span>
                </div>
                <p style={{ fontSize: '0.85rem', color: '#9ca3af' }}>{s.description}</p>
                <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                  <button
                    type="button"
                    className="btn-sm btn-success"
                    onClick={() => handleApprove(s.id)}
                  >
                    Approve
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <h3>Active Skills ({active.length})</h3>
      {active.length === 0 ? (
        <p className="empty-state">No active evolved skills yet.</p>
      ) : (
        <div className="card-grid">
          {active.map((s) => (
            <div key={s.id} className="card" style={{ borderLeft: '3px solid #10b981' }}>
              <div className="card-header">
                <strong>{s.name}</strong>
                <span className="badge badge-success">v{s.version} active</span>
              </div>
              <p style={{ fontSize: '0.85rem', color: '#9ca3af' }}>{s.description}</p>
              <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: '4px' }}>
                Used {s.usageCount} times
              </div>
              <button
                type="button"
                className="btn-sm btn-muted"
                style={{ marginTop: '8px' }}
                onClick={() => handleDeprecate(s.id)}
              >
                Deprecate
              </button>
            </div>
          ))}
        </div>
      )}

      {deprecated.length > 0 && (
        <>
          <h3>Deprecated ({deprecated.length})</h3>
          <div className="card-grid">
            {deprecated.map((s) => (
              <div key={s.id} className="card" style={{ opacity: 0.6 }}>
                <strong>{s.name}</strong> v{s.version}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function CompetenceSection({ competence }: { competence: TeamCompetence[] }) {
  if (competence.length === 0) {
    return (
      <p className="empty-state">
        No competence data yet. Agents build competence through heartbeat runs.
      </p>
    );
  }

  return (
    <div>
      <h3>Team Competence by Task Type</h3>
      <table className="data-table">
        <thead>
          <tr>
            <th>Task Type</th>
            <th>Agents</th>
            <th>Success Rate</th>
            <th>Avg Quality</th>
            <th>Total Runs</th>
          </tr>
        </thead>
        <tbody>
          {competence.map((c) => (
            <tr key={c.taskType}>
              <td>{c.taskType}</td>
              <td>{c.totalAgents}</td>
              <td>{c.avgSuccessRate != null ? `${(c.avgSuccessRate * 100).toFixed(0)}%` : '-'}</td>
              <td>
                {c.avgQuality != null ? (
                  <span
                    style={{
                      color:
                        c.avgQuality >= 0.7
                          ? '#10b981'
                          : c.avgQuality >= 0.4
                            ? '#f59e0b'
                            : '#ef4444',
                    }}
                  >
                    {c.avgQuality.toFixed(2)}
                  </span>
                ) : (
                  '-'
                )}
              </td>
              <td>{c.totalRuns}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StrategiesSection({ strategies }: { strategies: StrategyPattern[] }) {
  if (strategies.length === 0) {
    return <p className="empty-state">No strategy patterns recorded yet.</p>;
  }

  const byType = new Map<string, StrategyPattern[]>();
  for (const s of strategies) {
    const list = byType.get(s.patternType) ?? [];
    list.push(s);
    byType.set(s.patternType, list);
  }

  return (
    <div>
      {[...byType.entries()].map(([type, patterns]) => (
        <div key={type}>
          <h3>{type.replace(/_/g, ' ')}</h3>
          <div className="card-grid">
            {patterns.map((p) => {
              const total = p.successCount + p.failureCount;
              return (
                <div key={p.id} className="card">
                  <p style={{ fontSize: '0.85rem' }}>{p.description}</p>
                  <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: '4px' }}>
                    Confidence:{' '}
                    <span
                      style={{
                        color:
                          p.confidence >= 0.7
                            ? '#10b981'
                            : p.confidence >= 0.4
                              ? '#f59e0b'
                              : '#ef4444',
                      }}
                    >
                      {(p.confidence * 100).toFixed(0)}%
                    </span>{' '}
                    ({p.successCount}/{total} success)
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
