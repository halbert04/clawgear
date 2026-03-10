-- Custom migration: pgvector extension, HNSW/GIN indexes, RLS policies, updated_at trigger

-- ============================================================
-- HNSW VECTOR INDEXES
-- ============================================================

CREATE INDEX idx_lessons_embedding ON lessons_learned
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

CREATE INDEX idx_facts_embedding ON facts
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

CREATE INDEX idx_shared_embeddings_embedding ON shared_embeddings
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- ============================================================
-- GIN FULL-TEXT SEARCH INDEXES
-- ============================================================

CREATE INDEX idx_shared_embeddings_fts ON shared_embeddings
  USING GIN (to_tsvector('english', content));

CREATE INDEX idx_lessons_fts ON lessons_learned
  USING GIN (to_tsvector('english', lesson));

-- ============================================================
-- PARTIAL INDEXES FOR COMMON QUERIES
-- ============================================================

CREATE INDEX idx_issues_available ON issues(company_id, priority, created_at)
  WHERE status IN ('backlog', 'todo') AND checkout_run_id IS NULL;

CREATE INDEX idx_heartbeat_runs_active ON heartbeat_runs(agent_id, status)
  WHERE status IN ('queued', 'running');

CREATE INDEX idx_approvals_pending ON approvals(company_id, created_at DESC)
  WHERE status = 'pending';

-- ============================================================
-- UPDATED_AT TRIGGER
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_companies_updated_at BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_agents_updated_at BEFORE UPDATE ON agents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_goals_updated_at BEFORE UPDATE ON goals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_projects_updated_at BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_issues_updated_at BEFORE UPDATE ON issues
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_quality_rubrics_updated_at BEFORE UPDATE ON quality_rubrics
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_agent_runtime_state_updated_at BEFORE UPDATE ON agent_runtime_state
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_agent_competence_updated_at BEFORE UPDATE ON agent_competence
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- ROW-LEVEL SECURITY
-- ============================================================

-- Enable RLS on all company-scoped tables
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE issue_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE heartbeat_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_config_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_runtime_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_rubrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE lessons_learned ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_competence ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompt_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_embeddings ENABLE ROW LEVEL SECURITY;

-- Create tenant isolation policies
-- The application sets: SET app.current_company_id = '<uuid>' per request
-- Companies table uses its own id
CREATE POLICY tenant_isolation ON companies
  USING (id = current_setting('app.current_company_id', true)::UUID);

-- All other tables use company_id
CREATE POLICY tenant_isolation ON agents
  USING (company_id = current_setting('app.current_company_id', true)::UUID);

CREATE POLICY tenant_isolation ON goals
  USING (company_id = current_setting('app.current_company_id', true)::UUID);

CREATE POLICY tenant_isolation ON projects
  USING (company_id = current_setting('app.current_company_id', true)::UUID);

CREATE POLICY tenant_isolation ON issues
  USING (company_id = current_setting('app.current_company_id', true)::UUID);

CREATE POLICY tenant_isolation ON issue_comments
  USING (company_id = current_setting('app.current_company_id', true)::UUID);

CREATE POLICY tenant_isolation ON heartbeat_runs
  USING (company_id = current_setting('app.current_company_id', true)::UUID);

CREATE POLICY tenant_isolation ON cost_events
  USING (company_id = current_setting('app.current_company_id', true)::UUID);

CREATE POLICY tenant_isolation ON approvals
  USING (company_id = current_setting('app.current_company_id', true)::UUID);

CREATE POLICY tenant_isolation ON agent_config_revisions
  USING (company_id = current_setting('app.current_company_id', true)::UUID);

CREATE POLICY tenant_isolation ON activity_log
  USING (company_id = current_setting('app.current_company_id', true)::UUID);

CREATE POLICY tenant_isolation ON agent_runtime_state
  USING (company_id = current_setting('app.current_company_id', true)::UUID);

CREATE POLICY tenant_isolation ON quality_rubrics
  USING (company_id = current_setting('app.current_company_id', true)::UUID);

CREATE POLICY tenant_isolation ON quality_evaluations
  USING (company_id = current_setting('app.current_company_id', true)::UUID);

CREATE POLICY tenant_isolation ON lessons_learned
  USING (company_id = current_setting('app.current_company_id', true)::UUID);

CREATE POLICY tenant_isolation ON agent_competence
  USING (company_id = current_setting('app.current_company_id', true)::UUID);

CREATE POLICY tenant_isolation ON prompt_versions
  USING (company_id = current_setting('app.current_company_id', true)::UUID);

CREATE POLICY tenant_isolation ON facts
  USING (company_id = current_setting('app.current_company_id', true)::UUID);

CREATE POLICY tenant_isolation ON shared_embeddings
  USING (company_id = current_setting('app.current_company_id', true)::UUID);
