import { useCallback, useEffect, useState } from 'react';
import { type Company, createCompany, type MigrateResponse, migrateOpenclaw } from '../api';

// Tauri interop -- lazy imports so the component compiles in browser mode
const tauriInvoke = async <T,>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
};

const tauriListen = async <T,>(
  event: string,
  handler: (payload: T) => void,
): Promise<() => void> => {
  const { listen } = await import('@tauri-apps/api/event');
  const unlisten = await listen<T>(event, (e) => handler(e.payload));
  return unlisten;
};

// Types matching Rust structs
interface OpenClawInstance {
  path: string;
  databaseUrl: string | null;
  dbReachable: boolean;
}

interface ScanProgress {
  phase: string;
  currentPath: string;
  instancesFound: number;
}

interface ExtractionProgress {
  table: string;
  rowsRead: number;
}

interface ExtractedData {
  config: unknown[];
  sessions: unknown[];
  skills: unknown[];
  triggers: unknown[];
  workflows: unknown[];
}

type WizardStep =
  | 'welcome'
  | 'scanning'
  | 'select-instance'
  | 'extracting'
  | 'preview'
  | 'company-setup'
  | 'migrating'
  | 'done'
  | 'error';

const STEP_ORDER: WizardStep[] = [
  'welcome',
  'scanning',
  'select-instance',
  'extracting',
  'preview',
  'company-setup',
  'migrating',
  'done',
];

interface Props {
  existingCompanyId?: string;
  onComplete: (companyId: string) => void;
  onCancel: () => void;
}

export function ImportWizard({ existingCompanyId, onComplete, onCancel }: Props) {
  const [step, setStep] = useState<WizardStep>('welcome');
  const [errorMsg, setErrorMsg] = useState('');
  const [errorFrom, setErrorFrom] = useState<WizardStep>('welcome');

  // Scanning
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [instances, setInstances] = useState<OpenClawInstance[]>([]);

  // Selection
  const [selectedInstance, setSelectedInstance] = useState<OpenClawInstance | null>(null);

  // Extraction
  const [extractProgress, setExtractProgress] = useState<ExtractionProgress | null>(null);
  const [extractedData, setExtractedData] = useState<ExtractedData | null>(null);

  // Preview
  const [previewReport, setPreviewReport] = useState<MigrateResponse | null>(null);

  // Company setup
  const [companyName, setCompanyName] = useState('');
  const [issuePrefix, setIssuePrefix] = useState('OC');
  const [budgetCents, setBudgetCents] = useState(100000);

  // Migration
  const [companyId, setCompanyId] = useState(existingCompanyId ?? '');
  const [migrationResult, setMigrationResult] = useState<MigrateResponse | null>(null);

  // Error handler
  const handleError = useCallback((msg: string, fromStep: WizardStep) => {
    setErrorMsg(String(msg));
    setErrorFrom(fromStep);
    setStep('error');
  }, []);

  // -- Scanning --
  useEffect(() => {
    if (step !== 'scanning') return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    (async () => {
      try {
        cleanup = await tauriListen<ScanProgress>('openclaw-scan-progress', (p) => {
          if (!cancelled) setScanProgress(p);
        });

        const result = await tauriInvoke<OpenClawInstance[]>('scan_openclaw_instances');
        if (!cancelled) {
          setInstances(result);
          setStep(result.length > 0 ? 'select-instance' : 'error');
          if (result.length === 0) {
            setErrorMsg('No OpenClaw installations found.');
            setErrorFrom('scanning');
          }
        }
      } catch (e) {
        if (!cancelled) handleError(String(e), 'scanning');
      }
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [step, handleError]);

  // -- Extraction --
  useEffect(() => {
    if (step !== 'extracting' || !selectedInstance?.databaseUrl) return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    (async () => {
      try {
        cleanup = await tauriListen<ExtractionProgress>('openclaw-extract-progress', (p) => {
          if (!cancelled) setExtractProgress(p);
        });

        const result = await tauriInvoke<ExtractedData>('extract_openclaw_data', {
          databaseUrl: selectedInstance.databaseUrl,
        });
        if (!cancelled) {
          setExtractedData(result);
          setStep('preview');
        }
      } catch (e) {
        if (!cancelled) handleError(String(e), 'extracting');
      }
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [step, selectedInstance, handleError]);

  // -- Preview (dry run) --
  useEffect(() => {
    if (step !== 'preview' || !extractedData) return;
    let cancelled = false;

    // Use a temp company ID for dry run if we don't have one yet
    const dryRunCompanyId = companyId || '00000000-0000-0000-0000-000000000000';

    (async () => {
      try {
        const resp = await migrateOpenclaw(extractedData, dryRunCompanyId, true);
        if (!cancelled) setPreviewReport(resp);
      } catch (e) {
        if (!cancelled) handleError(String(e), 'preview');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [step, extractedData, companyId, handleError]);

  // -- Migration --
  useEffect(() => {
    if (step !== 'migrating' || !extractedData || !companyId) return;
    let cancelled = false;

    (async () => {
      try {
        const resp = await migrateOpenclaw(extractedData, companyId, false);
        if (!cancelled) {
          setMigrationResult(resp);
          setStep('done');
        }
      } catch (e) {
        if (!cancelled) handleError(String(e), 'migrating');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [step, extractedData, companyId, handleError]);

  // Company creation handler
  const handleCreateCompany = async () => {
    try {
      const company: Company = await createCompany({
        name: companyName,
        issuePrefix,
        budgetMonthlyCents: budgetCents,
      });
      setCompanyId(company.id);
      setStep('migrating');
    } catch (e) {
      handleError(String(e), 'company-setup');
    }
  };

  // Step indicator
  const currentIdx = STEP_ORDER.indexOf(step === 'error' ? errorFrom : step);

  return (
    <div className="wizard-overlay">
      <div className="wizard-container">
        {/* Step indicator */}
        <div className="wizard-step-indicator">
          {STEP_ORDER.map((s, i) => (
            <div
              key={s}
              className={`wizard-dot ${i < currentIdx ? 'done' : ''} ${i === currentIdx ? 'active' : ''}`}
            />
          ))}
        </div>

        {/* Welcome */}
        {step === 'welcome' && (
          <div className="wizard-step">
            <h2>Import from OpenClaw</h2>
            <p className="wizard-desc">
              Migrate your OpenClaw data into ClawGear. We'll scan your system for OpenClaw
              installations, read the database, and import triggers, workflows, skills, and
              configuration.
            </p>
            <div className="wizard-actions">
              <button type="button" className="btn" onClick={onCancel}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={() => setStep('scanning')}>
                Scan for OpenClaw
              </button>
            </div>
          </div>
        )}

        {/* Scanning */}
        {step === 'scanning' && (
          <div className="wizard-step">
            <h2>Scanning...</h2>
            <div className="wizard-progress">
              <div className="progress-pulse" />
              {scanProgress && (
                <p className="wizard-progress-text">
                  {scanProgress.phase === 'checking_db'
                    ? 'Testing database connection...'
                    : `Checking ${scanProgress.currentPath}`}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Select Instance */}
        {step === 'select-instance' && (
          <div className="wizard-step">
            <h2>Select Installation</h2>
            <p className="wizard-desc">
              Found {instances.length} OpenClaw installation{instances.length !== 1 ? 's' : ''}.
            </p>
            <div className="instance-list">
              {instances.map((inst) => (
                <button
                  type="button"
                  key={inst.path}
                  className={`instance-card ${selectedInstance?.path === inst.path ? 'selected' : ''}`}
                  onClick={() => setSelectedInstance(inst)}
                >
                  <div className="instance-path">{inst.path}</div>
                  <div className="instance-meta">
                    {inst.databaseUrl ? (
                      <span
                        className={`instance-db ${inst.dbReachable ? 'reachable' : 'unreachable'}`}
                      >
                        DB {inst.dbReachable ? 'reachable' : 'unreachable'}
                      </span>
                    ) : (
                      <span className="instance-db unreachable">No DB URL found</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
            <div className="wizard-actions">
              <button type="button" className="btn" onClick={onCancel}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!selectedInstance?.dbReachable}
                onClick={() => setStep('extracting')}
              >
                Extract Data
              </button>
            </div>
          </div>
        )}

        {/* Extracting */}
        {step === 'extracting' && (
          <div className="wizard-step">
            <h2>Extracting Data...</h2>
            <div className="wizard-progress">
              <div className="progress-pulse" />
              {extractProgress && (
                <p className="wizard-progress-text">
                  Reading {extractProgress.table}... ({extractProgress.rowsRead} rows)
                </p>
              )}
            </div>
          </div>
        )}

        {/* Preview */}
        {step === 'preview' && (
          <div className="wizard-step">
            <h2>Preview Migration</h2>
            {/* Show extracted data counts immediately */}
            {extractedData && !previewReport && (
              <>
                <p className="wizard-desc">Running dry-run analysis...</p>
                <div className="summary-grid">
                  {extractedData.triggers.length > 0 && (
                    <div className="summary-card">
                      <div className="summary-count">{extractedData.triggers.length}</div>
                      <div className="summary-label">triggers</div>
                    </div>
                  )}
                  {extractedData.workflows.length > 0 && (
                    <div className="summary-card">
                      <div className="summary-count">{extractedData.workflows.length}</div>
                      <div className="summary-label">workflows</div>
                    </div>
                  )}
                  {extractedData.skills.length > 0 && (
                    <div className="summary-card">
                      <div className="summary-count">{extractedData.skills.length}</div>
                      <div className="summary-label">skills</div>
                    </div>
                  )}
                  {extractedData.sessions.length > 0 && (
                    <div className="summary-card">
                      <div className="summary-count">{extractedData.sessions.length}</div>
                      <div className="summary-label">sessions</div>
                    </div>
                  )}
                  {extractedData.config.length > 0 && (
                    <div className="summary-card">
                      <div className="summary-count">{extractedData.config.length}</div>
                      <div className="summary-label">config</div>
                    </div>
                  )}
                </div>
              </>
            )}
            {previewReport && (
              <>
                <div className="summary-grid">
                  {Object.entries(previewReport.report.counts).map(([entity, count]) => (
                    <div key={entity} className="summary-card">
                      <div className="summary-count">{count}</div>
                      <div className="summary-label">{entity}</div>
                    </div>
                  ))}
                </div>
                {/* Agent FK warning for skills/sessions */}
                {extractedData &&
                  (extractedData.skills.length > 0 || extractedData.sessions.length > 0) && (
                    <div className="wizard-warnings">
                      <h3>Note</h3>
                      <div className="warning-item">
                        Skills and sessions reference agent IDs from OpenClaw. They will only be
                        imported if matching agents already exist in the target ClawGear company.
                        Triggers and workflows import without this requirement.
                      </div>
                    </div>
                  )}
                {previewReport.report.warnings.length > 0 && (
                  <div className="wizard-warnings">
                    <h3>Warnings</h3>
                    {previewReport.report.warnings.map((w) => (
                      <div
                        key={`${w.entityType}-${w.entityId}-${w.message}`}
                        className="warning-item"
                      >
                        [{w.entityType}] {w.message}
                      </div>
                    ))}
                  </div>
                )}
                {previewReport.report.errors.length > 0 && (
                  <div className="wizard-errors">
                    <h3>Errors</h3>
                    {previewReport.report.errors.map((e) => (
                      <div
                        key={`${e.entityType}-${e.entityId}-${e.message}`}
                        className="error-item"
                      >
                        [{e.entityType}] {e.message}
                      </div>
                    ))}
                  </div>
                )}
                <div className="wizard-actions">
                  <button type="button" className="btn" onClick={onCancel}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={previewReport.report.status === 'failed'}
                    onClick={() => setStep(existingCompanyId ? 'migrating' : 'company-setup')}
                  >
                    {existingCompanyId ? 'Start Migration' : 'Set Up Company'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Company Setup */}
        {step === 'company-setup' && (
          <div className="wizard-step">
            <h2>Create Company</h2>
            <p className="wizard-desc">Set up a new ClawGear company to hold the imported data.</p>
            <div className="wizard-form">
              <label className="wizard-label">
                Company Name
                <input
                  className="wizard-input"
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="My Company"
                />
              </label>
              <label className="wizard-label">
                Issue Prefix
                <input
                  className="wizard-input"
                  type="text"
                  value={issuePrefix}
                  onChange={(e) => setIssuePrefix(e.target.value)}
                  placeholder="OC"
                  maxLength={6}
                />
              </label>
              <label className="wizard-label">
                Monthly Budget (cents)
                <input
                  className="wizard-input"
                  type="number"
                  value={budgetCents}
                  min={0}
                  onChange={(e) => setBudgetCents(Math.max(0, Number(e.target.value) || 0))}
                />
              </label>
            </div>
            <div className="wizard-actions">
              <button type="button" className="btn" onClick={() => setStep('preview')}>
                Back
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!companyName.trim() || !issuePrefix.trim()}
                onClick={handleCreateCompany}
              >
                Create & Migrate
              </button>
            </div>
          </div>
        )}

        {/* Migrating */}
        {step === 'migrating' && (
          <div className="wizard-step">
            <h2>Migrating...</h2>
            <div className="wizard-progress">
              <div className="progress-pulse" />
              <p className="wizard-progress-text">Writing data to ClawGear database...</p>
            </div>
          </div>
        )}

        {/* Done */}
        {step === 'done' && migrationResult && (
          <div className="wizard-step">
            <h2>Migration Complete</h2>
            <div className="summary-grid">
              {migrationResult.report.persistence &&
                Object.entries(migrationResult.report.persistence.inserted).map(
                  ([entity, count]) => (
                    <div key={entity} className="summary-card">
                      <div className="summary-count">{count}</div>
                      <div className="summary-label">{entity} imported</div>
                    </div>
                  ),
                )}
            </div>
            {migrationResult.report.persistence &&
              migrationResult.report.persistence.errors.length > 0 && (
                <div className="wizard-warnings">
                  <h3>Issues</h3>
                  {migrationResult.report.persistence.errors.map((e) => (
                    <div
                      key={`${e.entityType}-${e.entityId}-${e.message}`}
                      className={e.severity === 'error' ? 'error-item' : 'warning-item'}
                    >
                      [{e.entityType}] {e.message}
                    </div>
                  ))}
                </div>
              )}
            <div className="wizard-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => onComplete(companyId)}
              >
                Go to Dashboard
              </button>
            </div>
          </div>
        )}

        {/* Error */}
        {step === 'error' && (
          <div className="wizard-step">
            <h2>Error</h2>
            <div className="error-item">{errorMsg}</div>
            <div className="wizard-actions">
              <button type="button" className="btn" onClick={onCancel}>
                Cancel
              </button>
              <button type="button" className="btn" onClick={() => setStep(errorFrom)}>
                Retry
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
