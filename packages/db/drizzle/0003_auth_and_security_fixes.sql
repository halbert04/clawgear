-- Migration 0003: Auth and security fixes
-- Adds: api_key_hash to companies, missing RLS policy on workflow_step_runs,
--        missing indexes on projects/goals/issue_comments

-- ============================================================
-- API KEY HASH COLUMN
-- ============================================================

ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "api_key_hash" text;
CREATE INDEX "idx_companies_api_key_hash" ON "companies" USING btree ("api_key_hash");

-- ============================================================
-- MISSING RLS POLICY
-- ============================================================

-- workflow_step_runs has RLS enabled but was missing the tenant isolation policy.
-- It joins through workflow_runs which has company_id, so we create a policy
-- that checks the parent run's company_id.
CREATE POLICY tenant_isolation ON workflow_step_runs
  USING (
    workflow_run_id IN (
      SELECT id FROM workflow_runs
      WHERE company_id = current_setting('app.current_company_id', true)::UUID
    )
  );

-- ============================================================
-- MISSING INDEXES (from DB audit)
-- ============================================================

CREATE INDEX IF NOT EXISTS "idx_projects_company_status" ON "projects" USING btree ("company_id", "status");
CREATE INDEX IF NOT EXISTS "idx_goals_company_status" ON "goals" USING btree ("company_id", "status");
CREATE INDEX IF NOT EXISTS "idx_goals_company_level" ON "goals" USING btree ("company_id", "level");
