# ClawGear: Build Plan

**Version:** 1.0.0-deepened
**Date:** 2026-03-09
**Based on:** TDD v0.2.0 + TDD-CRITIQUE recommended changes
**Deepened on:** 2026-03-09

---

## Enhancement Summary

**Sections enhanced:** All phases (0-8), Schema, Key Decisions, Tech Stack
**Research agents used:** 13 parallel agents -- Architecture Strategist, Agent-Native Reviewer, Security Sentinel, Performance Oracle, Data Integrity Guardian, Spec Flow Analyzer, Agent-Native Architecture Skill, Multi-Agent Orchestration Research, Docker Sandbox Research, LLM-as-Judge Quality Patterns, Agent Memory Research, Bun+Hono+Drizzle Stack Research, Context/Memory Systems Research

### Key Improvements Discovered

1. **Schema: 18 critical data integrity fixes** -- missing CASCADE/SET NULL on all FKs, no CHECK constraints on enum fields, no vector indexes (HNSW), atomic issue_counter race condition, budget check-then-act race, missing `company_id` on `agent_runtime_state`
2. **Security: Move RLS to Phase 0** -- deferring Row-Level Security to Phase 8 is the single most dangerous architectural decision; every missing `WHERE company_id =` filter is a cross-tenant data breach
3. **Agent-Native: 15 capability gaps** -- only 6 of 25 dashboard actions are agent-accessible; approval system is human-only; no `complete_task` tool; no agent self-modification; heartbeat is a pipeline, not an agent loop
4. **Performance: 4 critical bottlenecks** -- no HNSW indexes on vector columns (queries degrade to 15s at 1M rows), Docker create/destroy per heartbeat (1-3s overhead), quality gates double LLM spend, no activity_log partitioning
5. **Architecture: Phase 1 exit criteria require Phase 2 infrastructure** -- heartbeat execution engine is Phase 2, but Phase 1 exit criteria describe a full heartbeat cycle; kernel should start in Phase 0 with event bus
6. **Docker: Use persistent per-agent containers** -- container pooling with `docker exec` eliminates 500ms-1.3s container creation overhead per heartbeat; every production platform (E2B, Daytona, Docker Sandboxes) converged on persistent containers or microVMs
7. **Quality: Cap revision loops at 3 iterations** -- Reflexion research shows diminishing returns after 3 revisions; add escalation policy and min-improvement threshold to prevent spinning
8. **Memory: Use RRF instead of neural reranker for V1** -- Reciprocal Rank Fusion is microseconds vs 100-300ms for Cohere Rerank, achieves 85-90% of neural quality; add reranker in Phase 6

### New Considerations Discovered
- **User authentication system is completely absent** -- dashboard has approval buttons but no user identity system; `decided_by_user_id` is a bare TEXT field with no auth backing
- **Capability matching algorithm is unspecified** -- the entire "flat orchestrator + capability pool" design depends on it, but the plan hand-waves it
- **No error recovery strategy** -- no specification for what happens when PostgreSQL is down, Docker crashes, LLM API is unavailable, or embedding service is down
- **No `complete_task` tool** -- agents have no explicit signal to terminate a heartbeat; the system decides when the agent is done, not the agent itself
- **Cross-tenant FK references unvalidated** -- an agent from company A can be assigned to a project in company B; FK constraints alone cannot prevent this

---

## Guiding Principle

> After running for 6 months, will ClawGear's agents be measurably better at their jobs than they were on day 1?

Every phase is designed to answer YES to that question. Quality and learning come before channels, marketplace, and advanced security.

---

## Key Decisions (Resolved from Critique)

| # | Decision | Resolution | Rationale |
|---|---|---|---|
| 1 | Language for kernel | **TypeScript (Bun)** | LLM latency is 99% of execution time. Iteration speed > kernel speed. Rust only for sandbox/crypto/desktop when needed later. |
| 2 | Primary sandbox | **Docker containers** | Most tools (git, npm, python) can't run in WASM. Docker covers 95% of cases. WASM added later for marketplace skills. |
| 3 | Shared memory | **PostgreSQL + pgvector** for shared knowledge | SQLite only for agent-local scratch/transcripts. Cross-agent learning requires shared storage. |
| 4 | Execution topology | **Flat orchestrator + capability pool** | Org chart for governance (budgets, approvals, quality review). Orchestrator assigns work by capability match, not chain-of-command. |
| 5 | Heartbeat model | **Hybrid: scheduled + event-driven** | Heartbeat for planned work. Event-driven wake for channel messages and triggers. |
| 6 | V1 scope | **Focused: one loop, one adapter, one channel** | assign -> execute -> evaluate -> learn -> improve. Prove this loop works before expanding. |
| 7 | Security posture | **9 essential layers for V1, defer 7** | Append-only logs + RBAC + sandbox + prompt injection defense. No Merkle/Ed25519/taint until needed. |
| 8 | Goal ancestry | **Tiered injection** | Full context for CEO/CTO. Actionable constraints only for workers. Deep ancestry on-demand. |

### Research Insights: Key Decisions

**Validation from multi-agent orchestration research:**
- Decision #4 (flat orchestrator) is validated by production systems: Microsoft Magentic-One, LangGraph Supervisor, and Anthropic's "Building Effective Agents" guidance all converge on flat orchestrator + worker pool. No production system uses deep hierarchies for execution.
- Decision #5 (hybrid heartbeat) aligns with all production agent frameworks. Critical addition: define trigger priorities (`manual > channel_message > assigned > mentioned > scheduled`) and add event debouncing (5s coalesce window per agent).
- Decision #1 (TypeScript/Bun) is validated by stack research: Bun + Hono + Drizzle gives fast iteration with no build step for internal TS packages. The LLM-latency-dominated workload makes framework performance irrelevant.

**New architectural patterns to adopt:**
- **KernelHandle pattern** (from OpenFang analysis): Define `KernelHandle` and `SecurityGate` interfaces in `@clawgear/shared`. Implementations in domain packages. Dependency injection at boot time. This eliminates all circular dependency risks between kernel/runtime/quality/security.
- **Agent Tool Manifest**: For every entity in the system, enumerate the tools available to agents during heartbeats. This is the single most important design artifact for agent-native parity.

---

## V1 Scope Boundary

**In V1:**
- Core kernel (TypeScript/Bun, Axum-style with Hono or Elysia)
- PostgreSQL for orchestration + shared knowledge (pgvector)
- SQLite for agent-local scratch data
- ONE adapter (Claude Code)
- Company/agent/goal/issue system with atomic checkout
- Heartbeat + event-driven hybrid execution
- Quality gates (self-reflection, LLM-as-judge, peer review, deterministic validators)
- Learning system (reflection, lessons_learned, experience retrieval)
- Competence tracking with graduated autonomy
- Attention queue dashboard (React + Vite)
- ONE channel (WebChat built-in)
- Essential security (Docker sandbox, RBAC, subprocess isolation, prompt injection defense)
- CLI for management

**NOT in V1:**
- Rust kernel / WASM sandbox
- Tauri desktop app / mobile apps
- 20+ channel adapters
- Hands (autonomous operations)
- GearHub marketplace
- Workflow engine (multi-step pipelines)
- Trigger engine
- Merkle audit / Ed25519 signing / taint tracking
- P2P protocol (OFP)
- A2A protocol
- Migration engine
- Device nodes / Canvas / A2UI
- Browser automation (CDP/Playwright)

---

## Tech Stack (V1)

| Layer | Technology | Why |
|---|---|---|
| Runtime | **Bun** | Fast TypeScript runtime, built-in test runner, SQLite driver |
| API Framework | **Hono** | Fast, lightweight, works with Bun, middleware ecosystem |
| Orchestration DB | **PostgreSQL 17 + pgvector** | ACID for atomic checkout, pgvector for shared embeddings |
| Agent Local DB | **SQLite** (via Bun native) | Agent scratch data, session transcripts |
| ORM | **Drizzle** | Type-safe, lightweight, PostgreSQL + SQLite support |
| Dashboard | **React + Vite** | Component ecosystem, fast dev cycle |
| CLI | **Commander.js** | Standard Node.js CLI framework |
| Validation | **Zod** | Runtime schema validation |
| Agent Sandbox | **Docker** | Container isolation for tool execution |
| Embeddings | **text-embedding-3-small** (OpenAI) | Good quality/cost ratio, upgrade path to large |
| Testing | **Bun test + Vitest** (dashboard) | Native test runners |
| Monorepo | **pnpm workspaces** | Fast, disk-efficient |

### Research Insights: Tech Stack

**Bun + PostgreSQL:** Use `postgres` (postgres.js by Porsager) as the PostgreSQL driver, NOT `pg` (node-postgres). postgres.js uses raw TCP sockets which Bun optimizes for, avoids the Node.js compatibility layer entirely. Use pnpm for dependency management, Bun for runtime execution (`bun run`, `bun test`). Never use `bun install` to avoid lockfile conflicts.

**Hono specifics:** WebSocket via `createBunWebSocket()` from `hono/bun` -- you must build connection tracking, company-scoped broadcasting, and ping/pong manually. SSE via `streamSSE` from `hono/streaming` is first-class. Use `@hono/zod-validator` for request validation. No built-in rate limiter -- implement GCRA algorithm or use `hono-rate-limiter`.

**Drizzle + pgvector:** Define a custom `vector` column type via `customType`. Drizzle does NOT have a CTE builder -- use `sql` template literals for recursive CTEs (goal ancestry) and window functions (competence trends). Use two separate schema directories: `src/pg/schema.ts` and `src/sqlite/schema.ts`. Run `drizzle-kit` with Node (not Bun) for migration generation.

**pnpm workspaces:** Use catalogs (pnpm 9+) for shared dependency versions. Use `--filter "...[origin/main]"` in CI to run only changed packages. Structure `@clawgear/shared` with subpath exports from day one: `@clawgear/shared/types`, `@clawgear/shared/events`, `@clawgear/shared/interfaces`, `@clawgear/shared/validators`.

**Host requirements:** 32 GB minimum RAM for production at 1M+ embeddings (HNSW indexes on 1M vectors of 1536 dims use ~6-8 GB). Set `shared_buffers` to 8 GB, `effective_cache_size` to 16 GB, `maintenance_work_mem` to 2 GB.

---

## Monorepo Structure (V1)

```
clawgear/
  packages/
    @clawgear/kernel/           # Core: scheduler, budget, RBAC, event bus
    @clawgear/api/              # Hono HTTP/WS/SSE server
    @clawgear/db/               # Drizzle schemas (PostgreSQL + SQLite)
    @clawgear/runtime/          # Agent execution, Docker sandbox, adapters
    @clawgear/memory/           # Embeddings, hybrid search, compaction, facts
    @clawgear/quality/          # Quality gates, rubrics, evaluation
    @clawgear/learning/         # Reflection, lessons, competence, prompt optimization
    @clawgear/security/         # RBAC, prompt injection defense, subprocess sandbox
    @clawgear/shared/           # Types, validators, constants
    @clawgear/cli/              # CLI commands
  adapters/
    claude-code/                # Claude Code adapter
    process/                    # Generic process adapter
    http/                       # Generic HTTP webhook adapter
  channels/
    webchat/                    # Built-in web chat
  apps/
    dashboard/                  # React + Vite web UI
  skills/
    clawgear-heartbeat/         # Core heartbeat procedure skill
    create-agent/               # Agent creation skill
  docker/
    sandbox/                    # Dockerfile for agent sandbox containers
  docs/
  TDD.md
  TDD-CRITIQUE.md
  PLAN.md
```

---

## Database Schema (V1 -- PostgreSQL)

All tables company-scoped with UUIDs. Includes the three new systems from the critique.

```sql
-- ============================================================
-- CORE ORCHESTRATION (from TDD)
-- ============================================================

CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active', -- active | paused | archived
  issue_prefix TEXT NOT NULL,
  issue_counter INTEGER NOT NULL DEFAULT 0,
  budget_monthly_cents INTEGER NOT NULL DEFAULT 0,
  spent_monthly_cents INTEGER NOT NULL DEFAULT 0,
  require_board_approval BOOLEAN NOT NULL DEFAULT true,
  mission_goal_id UUID, -- FK to goals
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  title TEXT,
  role TEXT NOT NULL, -- ceo | cto | engineer | analyst | etc.
  icon TEXT,
  status TEXT NOT NULL DEFAULT 'idle', -- idle | running | paused | error | terminated
  reports_to UUID REFERENCES agents(id),
  capabilities JSONB NOT NULL DEFAULT '[]',
  permissions JSONB NOT NULL DEFAULT '{}',
  adapter_type TEXT NOT NULL, -- claude_code | process | http
  adapter_config JSONB NOT NULL DEFAULT '{}',
  model_tier TEXT NOT NULL DEFAULT 'smart', -- frontier | smart | fast | lightweight
  model_override TEXT, -- specific model name
  budget_monthly_cents INTEGER NOT NULL DEFAULT 0,
  spent_monthly_cents INTEGER NOT NULL DEFAULT 0,
  system_prompt TEXT, -- base system prompt
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, name)
);

CREATE TABLE goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  parent_id UUID REFERENCES goals(id),
  level TEXT NOT NULL, -- company | team | agent | task
  status TEXT NOT NULL DEFAULT 'active',
  owner_agent_id UUID REFERENCES agents(id),
  title TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  goal_id UUID REFERENCES goals(id),
  lead_agent_id UUID REFERENCES agents(id),
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  target_date DATE,
  color TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  project_id UUID REFERENCES projects(id),
  goal_id UUID REFERENCES goals(id),
  parent_id UUID REFERENCES issues(id),
  issue_number INTEGER NOT NULL,
  identifier TEXT NOT NULL, -- computed: prefix-number
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'backlog', -- backlog | todo | in_progress | in_review | done | cancelled
  priority TEXT NOT NULL DEFAULT 'medium', -- critical | high | medium | low
  assignee_agent_id UUID REFERENCES agents(id),
  checkout_run_id UUID,
  execution_locked_at TIMESTAMPTZ,
  billing_code TEXT,
  request_depth INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, issue_number)
);

CREATE TABLE issue_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  issue_id UUID NOT NULL REFERENCES issues(id),
  author_agent_id UUID REFERENCES agents(id),
  author_user_id TEXT, -- for human comments
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE heartbeat_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  agent_id UUID NOT NULL REFERENCES agents(id),
  invocation_source TEXT NOT NULL, -- scheduled | assigned | mentioned | manual | event
  status TEXT NOT NULL DEFAULT 'queued', -- queued | running | succeeded | failed | cancelled | timed_out
  context_snapshot JSONB,
  usage_json JSONB,
  result_json JSONB,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE cost_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  agent_id UUID NOT NULL REFERENCES agents(id),
  issue_id UUID REFERENCES issues(id),
  project_id UUID REFERENCES projects(id),
  goal_id UUID REFERENCES goals(id),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  billing_code TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  type TEXT NOT NULL, -- hire_agent | strategy | purchase | publish | budget_increase
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected | cancelled
  requested_by_agent_id UUID REFERENCES agents(id),
  payload JSONB NOT NULL,
  decided_by_user_id TEXT,
  decision_note TEXT,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE agent_config_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  agent_id UUID NOT NULL REFERENCES agents(id),
  before_config JSONB NOT NULL,
  after_config JSONB NOT NULL,
  changed_keys TEXT[] NOT NULL,
  source TEXT NOT NULL DEFAULT 'patch', -- patch | rollback
  rolled_back_from_revision_id UUID REFERENCES agent_config_revisions(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  actor_type TEXT NOT NULL, -- agent | user | system
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  agent_id UUID REFERENCES agents(id),
  run_id UUID REFERENCES heartbeat_runs(id),
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE agent_runtime_state (
  agent_id UUID PRIMARY KEY REFERENCES agents(id),
  session_id TEXT,
  state_json JSONB,
  last_run_id UUID REFERENCES heartbeat_runs(id),
  last_run_status TEXT,
  cumulative_tokens BIGINT NOT NULL DEFAULT 0,
  cumulative_cost_cents BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- QUALITY SYSTEM (NEW -- from critique recommendation #1)
-- ============================================================

CREATE TABLE quality_rubrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  role TEXT, -- applies to this role, NULL = all roles
  task_type TEXT, -- applies to this task type, NULL = all types
  criteria JSONB NOT NULL, -- array of {name, description, weight, pass_threshold}
  judge_model TEXT NOT NULL DEFAULT 'claude-sonnet-4-20250514',
  judge_prompt TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE quality_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  issue_id UUID REFERENCES issues(id),
  run_id UUID NOT NULL REFERENCES heartbeat_runs(id),
  agent_id UUID NOT NULL REFERENCES agents(id),
  rubric_id UUID REFERENCES quality_rubrics(id),
  evaluator_type TEXT NOT NULL, -- self | peer | judge | deterministic
  evaluator_agent_id UUID REFERENCES agents(id),
  scores JSONB NOT NULL, -- {criterion_name: score} per rubric criteria
  overall_score FLOAT NOT NULL,
  passed BOOLEAN NOT NULL,
  feedback TEXT,
  revision_number INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- LEARNING SYSTEM (NEW -- from critique recommendation #2)
-- ============================================================

CREATE TABLE lessons_learned (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  agent_id UUID NOT NULL REFERENCES agents(id),
  run_id UUID REFERENCES heartbeat_runs(id),
  issue_id UUID REFERENCES issues(id),
  task_type TEXT NOT NULL,
  approach TEXT NOT NULL,
  what_worked TEXT,
  what_failed TEXT,
  lesson TEXT NOT NULL,
  outcome TEXT NOT NULL, -- success | partial_success | failure
  confidence FLOAT NOT NULL DEFAULT 0.5,
  embedding vector(1536), -- pgvector for semantic search
  times_retrieved INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE agent_competence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  agent_id UUID NOT NULL REFERENCES agents(id),
  task_type TEXT NOT NULL,
  total_runs INTEGER NOT NULL DEFAULT 0,
  successful_runs INTEGER NOT NULL DEFAULT 0,
  failed_runs INTEGER NOT NULL DEFAULT 0,
  avg_cost_cents FLOAT NOT NULL DEFAULT 0,
  avg_duration_ms FLOAT NOT NULL DEFAULT 0,
  avg_quality_score FLOAT NOT NULL DEFAULT 0,
  quality_trend TEXT NOT NULL DEFAULT 'stable', -- improving | stable | degrading
  autonomy_level TEXT NOT NULL DEFAULT 'supervised', -- supervised | semi_auto | auto
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, agent_id, task_type)
);

CREATE TABLE prompt_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  agent_role TEXT NOT NULL,
  prompt_type TEXT NOT NULL, -- heartbeat | system | skill
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  evaluation_score FLOAT,
  is_active BOOLEAN NOT NULL DEFAULT false,
  parent_version_id UUID REFERENCES prompt_versions(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- SHARED KNOWLEDGE (NEW -- from critique recommendation #5)
-- ============================================================

CREATE TABLE facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  agent_id UUID NOT NULL REFERENCES agents(id),
  fact_type TEXT NOT NULL, -- decision | entity | relationship | observation
  subject TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object TEXT NOT NULL,
  confidence FLOAT NOT NULL DEFAULT 0.8,
  source_run_id UUID REFERENCES heartbeat_runs(id),
  source_issue_id UUID REFERENCES issues(id),
  valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  invalidated_at TIMESTAMPTZ,
  embedding vector(1536),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE shared_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  agent_id UUID NOT NULL REFERENCES agents(id),
  content TEXT NOT NULL,
  content_type TEXT NOT NULL, -- lesson | fact | document | code
  content_hash TEXT NOT NULL,
  embedding vector(1536),
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_agents_company ON agents(company_id);
CREATE INDEX idx_agents_reports_to ON agents(reports_to);
CREATE INDEX idx_issues_company_status ON issues(company_id, status);
CREATE INDEX idx_issues_assignee ON issues(assignee_agent_id);
CREATE INDEX idx_goals_parent ON goals(parent_id);
CREATE INDEX idx_cost_events_agent ON cost_events(company_id, agent_id);
CREATE INDEX idx_activity_log_company ON activity_log(company_id, created_at DESC);
CREATE INDEX idx_quality_evals_agent ON quality_evaluations(company_id, agent_id);
CREATE INDEX idx_lessons_company_type ON lessons_learned(company_id, task_type);
CREATE INDEX idx_competence_agent ON agent_competence(company_id, agent_id);
CREATE INDEX idx_facts_company ON facts(company_id, fact_type);
```

### Research Insights: Schema Critical Fixes

**CRITICAL -- Data Integrity (must apply in Phase 0.2 migration):**

1. **Add CASCADE/SET NULL on ALL foreign keys.** PostgreSQL defaults to `NO ACTION`, making deletion operations fail or orphan data. Policy: CASCADE for owned children, SET NULL for optional references.
   - `agents.reports_to` -> `ON DELETE SET NULL` (prevents orphaned reports)
   - `agents.company_id` -> `ON DELETE CASCADE`
   - `issues.assignee_agent_id` -> `ON DELETE SET NULL`
   - `issues.parent_id` -> `ON DELETE SET NULL`
   - `issue_comments.issue_id` -> `ON DELETE CASCADE`
   - `agent_runtime_state.agent_id` -> `ON DELETE CASCADE`
   - `cost_events` issue/project/goal refs -> `ON DELETE SET NULL` (never lose cost data)

2. **Add CHECK constraints on ALL status/enum fields.** Any string can be inserted into TEXT columns. Add CHECK constraints for: `companies.status`, `agents.status`, `agents.role`, `agents.model_tier`, `agents.adapter_type`, `goals.level`, `issues.status`, `issues.priority`, `heartbeat_runs.status`, `approvals.type`, `approvals.status`, `quality_evaluations.evaluator_type`, `lessons_learned.outcome`, `agent_competence.quality_trend`, `agent_competence.autonomy_level`, `facts.fact_type`, `shared_embeddings.content_type`, `prompt_versions.prompt_type`, `activity_log.actor_type`.

3. **Add numeric range CHECK constraints.** Budget values can go negative, confidence can exceed [0,1], quality scores are unbounded. Add: `budget >= 0`, `confidence BETWEEN 0 AND 1`, `quality_score BETWEEN 0 AND 1`, `cost_cents >= 0`, `successful_runs + failed_runs <= total_runs`.

4. **Make circular FK DEFERRABLE.** `companies.mission_goal_id -> goals(id)` must be added as a separate `ALTER TABLE` after both tables exist, with `DEFERRABLE INITIALLY DEFERRED`.

5. **Use BIGINT for ALL monetary columns.** INTEGER overflows at ~$21.4M. Change `budget_monthly_cents` and `spent_monthly_cents` on both `companies` and `agents` to BIGINT for consistency with `agent_runtime_state.cumulative_cost_cents`.

6. **Add `company_id` to `agent_runtime_state`.** Currently has no `company_id` -- a cross-tenant leak path. Any query without company scoping on this table can access other companies' agent state.

7. **Atomic issue_counter.** Use `UPDATE companies SET issue_counter = issue_counter + 1 RETURNING issue_counter` -- never read-then-increment which races under concurrency.

8. **Atomic budget enforcement.** Use `UPDATE agents SET spent = spent + $cost WHERE spent + $cost <= budget` in a single statement. The check-then-act pattern races. Both agent and company budget updates MUST be in a single transaction.

9. **Add `updated_at` triggers.** `updated_at` columns only set on INSERT. Add a trigger function `update_updated_at()` applied to all tables with `updated_at`.

**CRITICAL -- Row-Level Security (move from Phase 8 to Phase 0):**

Enable PostgreSQL RLS on ALL tables in the initial migration. Set `app.current_company_id` in session at the API middleware layer. This provides defense-in-depth: even if application code omits a WHERE clause, the database itself prevents cross-tenant access.

```sql
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agents
  USING (company_id = current_setting('app.current_company_id')::UUID);
-- Repeat for all 17 tables with company_id
```

**HIGH -- Missing Indexes (add to Phase 0.2):**

```sql
-- HNSW vector indexes (CRITICAL for retrieval performance)
CREATE INDEX idx_lessons_embedding ON lessons_learned
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
CREATE INDEX idx_facts_embedding ON facts
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
CREATE INDEX idx_shared_embeddings_embedding ON shared_embeddings
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- GIN for full-text search (required for hybrid search)
CREATE INDEX idx_shared_embeddings_fts ON shared_embeddings
  USING GIN (to_tsvector('english', content));
CREATE INDEX idx_lessons_fts ON lessons_learned
  USING GIN (to_tsvector('english', lesson));

-- Query pattern indexes
CREATE INDEX idx_issues_available ON issues(company_id, priority, created_at)
  WHERE status IN ('backlog', 'todo') AND checkout_run_id IS NULL;
CREATE INDEX idx_issues_project ON issues(project_id, status);
CREATE INDEX idx_heartbeat_runs_agent ON heartbeat_runs(company_id, agent_id, created_at DESC);
CREATE INDEX idx_heartbeat_runs_status ON heartbeat_runs(agent_id, status)
  WHERE status IN ('queued', 'running');
CREATE INDEX idx_cost_events_time ON cost_events(company_id, occurred_at);
CREATE INDEX idx_approvals_pending ON approvals(company_id, created_at DESC)
  WHERE status = 'pending';
CREATE INDEX idx_quality_evals_issue ON quality_evaluations(issue_id, created_at DESC);
CREATE INDEX idx_issue_comments_issue ON issue_comments(issue_id, created_at);
```

**HIGH -- Missing UNIQUE constraints:**

```sql
ALTER TABLE issues ADD CONSTRAINT uq_issues_identifier UNIQUE(company_id, identifier);
CREATE UNIQUE INDEX uq_active_prompt ON prompt_versions(company_id, agent_role, prompt_type)
  WHERE is_active = true;
ALTER TABLE shared_embeddings ADD CONSTRAINT uq_embedding_hash UNIQUE(company_id, content_hash);
ALTER TABLE quality_rubrics ADD CONSTRAINT uq_rubric_name UNIQUE(company_id, name);
```

**MEDIUM -- Schema additions:**

- Add `required_capabilities JSONB` to `issues` table (needed for capability matching algorithm)
- Add `embedding_model TEXT` to all embedding tables (needed for future model migration)
- Add `lock_timeout_at TIMESTAMPTZ` to `issues` table (explicit lock deadline instead of computed)
- Add `decided_by_agent_id UUID REFERENCES agents(id)` to `approvals` table (enable agent-to-agent approval, not just human)
- Add `checkout_run_id UUID REFERENCES heartbeat_runs(id) ON DELETE SET NULL` FK declaration on `issues` (currently undeclared)

**Migration order:** companies (without mission_goal_id FK) -> agents -> goals -> `ALTER TABLE companies ADD FK` (DEFERRABLE) -> projects -> issues -> heartbeat_runs -> remaining tables -> indexes -> RLS policies.

---

## Phase 0: Foundation

Set up the monorepo, database, basic API server, and CLI skeleton.

### 0.1 Monorepo Setup
- [ ] Initialize pnpm workspace with the V1 package structure
- [ ] Configure TypeScript (strict mode, path aliases)
- [ ] Configure Bun as the runtime
- [ ] Set up shared tsconfig, eslint, prettier
- [ ] Set up Biome or ESLint for linting
- [ ] Add Docker Compose for local dev (PostgreSQL + pgvector)

### 0.2 Database Layer (`@clawgear/db`)
- [ ] Install Drizzle ORM + drizzle-kit
- [ ] Define all PostgreSQL schemas listed above (core + quality + learning + shared knowledge)
- [ ] Write initial migration
- [ ] Set up pgvector extension in migration
- [ ] Add seed script for development (creates a sample company, CEO agent, goals)
- [ ] SQLite schema for agent-local data (sessions, scratch KV)

### 0.3 API Server (`@clawgear/api`)
- [ ] Hono server with CORS, request logging, error handling middleware
- [ ] Health check endpoints (`GET /api/health`, `GET /api/health/detail`)
- [ ] API key authentication middleware (company-scoped)
- [ ] Request validation with Zod
- [ ] WebSocket upgrade support (for future dashboard live updates)

### 0.4 Shared Types (`@clawgear/shared`)
- [ ] Define all entity types matching the database schema
- [ ] Define API request/response types
- [ ] Zod validators for all inputs
- [ ] Event types for the internal event bus
- [ ] Status enums and state machine types

### 0.5 CLI Skeleton (`@clawgear/cli`)
- [ ] `clawgear init` -- interactive setup (creates config, runs migrations)
- [ ] `clawgear start` -- launches API server
- [ ] `clawgear status` -- system health check

### 0.6 Development Infrastructure
- [ ] Test setup (Bun test for packages, Vitest for dashboard)
- [ ] CI pipeline (lint, type-check, test, build)
- [ ] `.env.example` with all required config vars
- [ ] Docker Compose for full stack (API + PostgreSQL + pgvector)

**Exit criteria:** `clawgear init && clawgear start` boots the API server, connects to PostgreSQL, runs migrations, and responds to health checks.

### Research Insights: Phase 0

**Start `@clawgear/kernel` in Phase 0** (not Phase 2). Begin with just the event bus and typed event definitions. Phase 1 adds CRUD event emission. Phase 2 adds the scheduler and heartbeat pipeline. This makes the kernel a gradually-built package rather than a Phase-2-only deliverable.

**Define interfaces in `@clawgear/shared` from day one:**
```typescript
// @clawgear/shared/src/interfaces/kernel-handle.ts
export interface KernelHandle {
  checkBudget(agentId: string): Promise<BudgetStatus>;
  checkCapability(agentId: string, capability: Capability): Promise<boolean>;
  emitEvent(event: SystemEvent): void;
  recordCost(event: CostEvent): Promise<void>;
}

// @clawgear/shared/src/interfaces/security-gate.ts
export interface SecurityGate {
  validateToolCall(agentId: string, tool: string, args: unknown): Promise<boolean>;
  sanitizeInput(input: string, source: InputSource): string;
  sanitizeOutput(output: string): string;
}
```

**Structure `@clawgear/shared` with subpath exports:**
```
@clawgear/shared/src/
  types/          # Entity types (Agent, Issue, Goal, etc.)
  events/         # Event type definitions
  validators/     # Zod schemas
  interfaces/     # KernelHandle, SecurityGate, etc.
  constants/      # Status enums, limits
  index.ts        # Curated public API
```

**Add RLS policies to the initial migration** (see Schema Research Insights above).

**Add system-level health metrics** to `GET /api/health/detail`: scheduler last tick, active heartbeats count, event bus queue depth, PostgreSQL connection pool usage, query latency p99.

**Document single-instance constraint:** V1 is single-instance only. Add `CLAWGEAR_INSTANCE_ID` env var. Plan `PostgreSQL LISTEN/NOTIFY` for future multi-instance (Phase 7+).

**Add user authentication system design** (currently absent): At minimum, email/password with bcrypt, JWT session tokens (15 min TTL + refresh tokens), user-to-company binding with roles (admin, operator, viewer). API keys for programmatic access, JWT for dashboard access.

---

## Phase 1: Orchestration Core + Quality

Build the business logic and quality gate system together. The quality gates are built alongside the core, not bolted on later.

### 1.1 Company CRUD
- [ ] `POST /api/companies` -- create company
- [ ] `GET /api/companies` -- list companies
- [ ] `GET /api/companies/:id` -- get company detail
- [ ] `PATCH /api/companies/:id` -- update company
- [ ] Budget tracking (monthly reset logic)

### 1.2 Agent CRUD + Org Chart
- [ ] `POST /api/companies/:cid/agents` -- create agent (with approval gate if configured)
- [ ] `GET /api/companies/:cid/agents` -- list agents with hierarchy
- [ ] `GET /api/companies/:cid/agents/:id` -- agent detail
- [ ] `PATCH /api/companies/:cid/agents/:id` -- update agent config (creates revision)
- [ ] `POST /api/companies/:cid/agents/:id/pause` -- pause agent
- [ ] `POST /api/companies/:cid/agents/:id/resume` -- resume agent
- [ ] `POST /api/companies/:cid/agents/:id/terminate` -- irreversible termination
- [ ] Config revision history + rollback
- [ ] Org chart tree query (agents with their reports)

### 1.3 Goal System
- [ ] Goal CRUD with hierarchical parent-child
- [ ] Goal level enforcement (company -> team -> agent -> task)
- [ ] **Tiered ancestry resolution** (critique #8): full ancestry for CEO/CTO, actionable constraints for workers
- [ ] `GET /api/companies/:cid/goals/:id/ancestry` -- returns the full chain
- [ ] Goal ancestry transformation: convert hierarchy to actionable constraints format

### 1.4 Project + Issue System
- [ ] Project CRUD linked to goals
- [ ] Issue CRUD with issue numbering (prefix + counter)
- [ ] Issue status state machine: `backlog -> todo -> in_progress -> in_review -> done`
- [ ] **Atomic checkout** (PostgreSQL single-UPDATE pattern from Paperclip)
- [ ] Checkout timeout with automatic release (critique recommendation)
- [ ] Issue comments (agent + human authoring)
- [ ] Issue assignment with agent wake-up trigger

### 1.5 Budget Enforcement
- [ ] Cost event ingestion (`POST /api/companies/:cid/cost-events`)
- [ ] Atomic increment of agent + company `spent_monthly_cents`
- [ ] Auto-pause at 100% budget
- [ ] Warning events at 80% budget
- [ ] Monthly budget reset (scheduled job)
- [ ] Cost attribution to issue/project/goal

### 1.6 Approval Gates
- [ ] Approval request creation (agent requests approval)
- [ ] `GET /api/companies/:cid/approvals` -- list pending approvals
- [ ] `POST /api/companies/:cid/approvals/:id/approve` -- approve
- [ ] `POST /api/companies/:cid/approvals/:id/reject` -- reject
- [ ] Configurable approval types: hire_agent, strategy, purchase, budget_increase

### 1.7 Activity Log
- [ ] Append-only activity_log table (NOT Merkle-chained yet -- critique #9)
- [ ] Log all CRUD operations, status changes, approvals
- [ ] `GET /api/companies/:cid/activity` -- paginated activity feed
- [ ] WebSocket event streaming for real-time dashboard updates

### 1.8 Quality Gate System (NEW)
- [ ] Quality rubric CRUD (per role, per task type)
- [ ] Default rubrics for common roles (engineer, researcher, writer)
- [ ] **Self-reflection step**: after every heartbeat output, agent critiques its own work
  - Structured prompt: "Does this meet the acceptance criteria? What could be wrong? Rate 1-5."
  - Self-reflection stored as part of the heartbeat run record
- [ ] **LLM-as-Judge gate**: dedicated judge model call evaluates output against rubric
  - Runs after self-reflection, before issue status transition
  - Configurable judge model (default: cheaper/faster model)
  - Scores per criterion, overall pass/fail
  - Failed outputs sent back to agent with specific feedback
- [ ] **Peer review via hierarchy**: on `in_progress -> in_review` transition
  - Manager agent (from `reports_to`) reviews the work
  - Review creates a quality_evaluation record
  - Pass -> `done`. Fail -> back to `in_progress` with feedback
- [ ] **Deterministic validators**: pluggable validators for structured outputs
  - JSON Schema validation for structured outputs
  - Code outputs: optionally run test commands
  - Text: assertion checks (contains X, length < Y)
- [ ] Quality evaluation API
  - `GET /api/companies/:cid/quality/evaluations` -- list evaluations
  - `GET /api/companies/:cid/agents/:id/quality` -- agent quality summary
- [ ] Graduated response: minor issues -> agent self-fixes; major issues -> escalate to manager

### 1.9 Attention Queue Dashboard (NEW)
- [ ] React + Vite project setup
- [ ] **Single prioritized queue** as the primary view:
  - `[URGENT]` -- quality gate failures
  - `[APPROVAL]` -- pending approval requests
  - `[WARNING]` -- budget alerts (80%+)
  - `[STUCK]` -- agents exceeding expected time
  - `[INFO]` -- daily summary (issues completed, spend, health)
- [ ] Priority scoring algorithm (severity x recency x impact)
- [ ] Quick action buttons (approve, reject, reassign, pause agent)
- [ ] WebSocket live updates
- [ ] Secondary views:
  - Org chart visualization (agent hierarchy with status indicators)
  - Issue board (kanban by status)
  - Agent detail (runs, quality scores, cost breakdown)
  - Budget overview (per-agent and per-company)

### 1.10 Internal Event Bus
- [ ] Typed event bus (in-process, pub/sub)
- [ ] Event types: agent_status_changed, issue_status_changed, budget_warning, budget_exceeded, approval_requested, quality_gate_result, heartbeat_completed
- [ ] WebSocket bridge: events -> dashboard in real-time
- [ ] Event persistence to activity_log

**Exit criteria:** Create a company with a CEO and engineer agent. CEO creates a goal and issue. Engineer checks out the issue. After work, self-reflection + quality gate evaluate output. Pass -> issue done. Fail -> sent back with feedback. All actions visible in the attention queue dashboard.

### Research Insights: Phase 1

**Fix exit criteria dependency:** The current exit criteria describe a full heartbeat cycle (agent wakes, executes, self-reflects, passes quality gate), but the heartbeat execution engine is Phase 2. Rewrite Phase 1 exit criteria to: "Create a company with CEO and engineer agents via API. CEO creates a goal and issue. Engineer is assigned the issue via atomic checkout. Quality rubrics exist and can be invoked manually via API. All CRUD operations emit events to the event bus. Attention queue dashboard displays all entities and pending approvals in real-time via WebSocket."

**Issue status state machine -- add missing transitions:**
```
backlog -> todo -> in_progress -> in_review -> done
                                             -> cancelled (from any state)
                      in_progress <- in_review (rejected)
backlog <- cancelled (reopened)
```
Add `reopened_at TIMESTAMPTZ` to the `issues` table. Track reopened count for quality metrics.

**Capability matching algorithm (required for flat orchestrator):**
```typescript
function matchAgent(issue: Issue, agents: Agent[]): Agent | null {
  const candidates = agents
    .filter(a => a.status === 'idle')
    .filter(a => hasCapabilities(a, issue.required_capabilities))
    .filter(a => withinBudget(a, issue.estimated_cost_cents));

  if (candidates.length === 0) return null;

  return candidates.sort((a, b) => {
    const compA = getCompetence(a, issue.task_type);
    const compB = getCompetence(b, issue.task_type);
    // Primary: competence score. Secondary: cost efficiency. Tertiary: availability.
    return (compB?.avg_quality_score ?? 0) - (compA?.avg_quality_score ?? 0)
      || (compA?.avg_cost_cents ?? Infinity) - (compB?.avg_cost_cents ?? Infinity);
  })[0];
}
```

**Enable agent-to-agent approvals:** Add `decided_by_agent_id UUID REFERENCES agents(id)` to the `approvals` table. Allow manager agents to approve/reject requests from their reports. Human override always available. This closes the agent-native parity gap where approvals are structurally human-only.

**Quality gate revision loop policy:**
- Cap at **3 revision iterations** per issue per heartbeat cycle (Reflexion research shows diminishing returns after 3)
- After 3 failures: escalate to manager agent with all feedback history
- Add `min_improvement_threshold FLOAT DEFAULT 0.1` to `quality_rubrics` -- if score improves less than threshold between revisions, escalate early
- Store revision chain: `quality_evaluations.revision_number` tracks which attempt

**Rubric design templates (from LLM-as-Judge research):**
```json
{
  "code_quality": {
    "criteria": [
      {"name": "correctness", "weight": 0.4, "pass_threshold": 0.7,
       "description": "Code compiles, tests pass, requirements met"},
      {"name": "maintainability", "weight": 0.3, "pass_threshold": 0.6,
       "description": "Readable, well-structured, appropriate abstractions"},
      {"name": "efficiency", "weight": 0.2, "pass_threshold": 0.5,
       "description": "No obvious performance issues, reasonable complexity"},
      {"name": "security", "weight": 0.1, "pass_threshold": 0.8,
       "description": "No injection, no hardcoded secrets, input validation"}
    ]
  }
}
```

**Attention queue priority formula:**
```
score = severity_weight[type] * (1 / (1 + hours_since_created)) * impact_multiplier
```
Where `severity_weight`: URGENT=100, APPROVAL=80, WARNING=60, STUCK=40, INFO=10. `impact_multiplier`: budget_pct_remaining < 0.1 = 3x, critical_priority = 2x, blocking_other_issues = 1.5x.

---

## Phase 2: Agent Runtime + Learning

Build the execution engine, adapter system, and learning loop.

### 2.1 Heartbeat Execution Engine (`@clawgear/kernel`)
- [ ] Heartbeat scheduler (cron-based, configurable per agent)
- [ ] **Hybrid wake model**: scheduled heartbeats + event-driven wake (for assignments, mentions)
- [ ] Heartbeat procedure orchestration:
  1. Load agent config + runtime state
  2. Resolve context (tiered goal ancestry, recent lessons, current assignments)
  3. Execute via adapter
  4. Self-reflection step
  5. Quality gate evaluation
  6. Post-run reflection (learning system)
  7. Persist runtime state
  8. Update competence tracking
- [ ] Heartbeat run recording (status, timing, usage, result)
- [ ] Concurrent heartbeat guard (prevent double-execution)
- [ ] Heartbeat timeout with automatic cancellation

### 2.2 Context Assembly
- [ ] **Agent identity block**: name, role, title, capabilities, permissions
- [ ] **Current task block**: issue details, comments, acceptance criteria
- [ ] **Goal constraints block** (tiered):
  - CEO/CTO: full goal ancestry
  - Workers: immediate goal + constraints (budget remaining, deadline, dependencies)
- [ ] **Relevant lessons block**: top-5 lessons from `lessons_learned` for this task type
- [ ] **Recent competence block**: "You have completed 12 similar tasks with 83% success rate"
- [ ] **Available tools block**: tool descriptions for the adapter
- [ ] **Skill injection**: relevant SKILL.md content for the current task
- [ ] Token budget tracking: ensure assembled context fits the model window

### 2.3 Adapter System (`@clawgear/runtime`)
- [ ] Adapter interface:
  ```typescript
  interface Adapter {
    execute(ctx: AdapterContext): Promise<AdapterResult>
    testEnvironment(): Promise<EnvironmentTestResult>
    // optional session management
    serializeSession?(session: unknown): string
    deserializeSession?(data: string): unknown
  }
  ```
- [ ] **Claude Code adapter**: spawn `claude` CLI, pass context, collect output
  - Session persistence (resume sessions across heartbeats)
  - Tool result parsing
  - Cost extraction from usage output
- [ ] **Process adapter**: generic subprocess spawner
- [ ] **HTTP adapter**: webhook-based execution
- [ ] Adapter registry and configuration
- [ ] Environment testing (`clawgear agent test-env <name>`)

### 2.4 Model Routing
- [ ] 4-tier model configuration: frontier / smart / fast / lightweight
- [ ] Per-agent tier assignment (from agent config)
- [ ] Provider failover: try primary provider, fall back to secondary
- [ ] Rate limit backoff (short cooldown for rate limits, exponential for billing errors)
- [ ] Usage tracking per model/provider

### 2.5 Docker Sandbox (`@clawgear/security`)
- [ ] Docker container management for agent tool execution
- [ ] Sandbox image with common tools (git, node, python, etc.)
- [ ] Per-agent workspace volume mounting
- [ ] Network policy (restrict egress to allowed domains)
- [ ] Resource limits (CPU, memory, disk)
- [ ] Container lifecycle (create on heartbeat start, destroy on completion)
- [ ] Timeout enforcement

### 2.6 Session Persistence
- [ ] Session key resolution (hierarchical: `agent:{id}:main`, etc.)
- [ ] SQLite-based session transcript storage (JSONL)
- [ ] Runtime state persistence across heartbeats (PostgreSQL `agent_runtime_state`)
- [ ] Session cleanup policy (prune after configurable TTL)

### 2.7 Skill Injection System
- [ ] SKILL.md format parser (frontmatter + markdown body)
- [ ] Skill directory resolution (workspace > company > bundled)
- [ ] Skill manifest injection (names, descriptions) into system prompt
- [ ] On-demand full skill content loading
- [ ] Environment variable injection (`CLAWGEAR_AGENT_ID`, `CLAWGEAR_COMPANY_ID`, etc.)

### 2.8 Learning System (NEW -- `@clawgear/learning`)
- [ ] **Post-run reflection**: after every heartbeat, agent writes structured reflection
  - Prompt: "What did you do? What worked? What failed? What's the key lesson?"
  - Output: `{taskType, approach, whatWorked, whatFailed, lesson, outcome, confidence}`
  - Stored in `lessons_learned` table (PostgreSQL, shared)
  - Embedding generated for semantic retrieval
- [ ] **Experience-indexed retrieval**: before each heartbeat, retrieve relevant lessons
  - Query: semantic search on task description + task type filter
  - Top-5 lessons injected into context: "Here's what the team learned about tasks like this..."
  - Track retrieval count (`times_retrieved`) for lesson utility scoring
- [ ] **Competence tracking**: per agent, per task type
  - Update after every quality evaluation
  - Track: total_runs, success_rate, avg_cost, avg_duration, avg_quality_score
  - Compute quality_trend (compare last 10 runs to previous 10)
  - **Graduated autonomy**: as competence increases, reduce approval requirements
    - `supervised`: every output needs peer review
    - `semi_auto`: only failures or high-impact tasks need review
    - `auto`: quality gate only, no peer review (earned through consistent quality)
- [ ] **Cross-agent learning**: any agent can retrieve lessons from any other agent in the company
  - Lessons are company-scoped, not agent-scoped
  - Filter by task_type and outcome for relevance

### 2.9 Shared Knowledge Store (NEW -- `@clawgear/memory`)
- [ ] **Typed fact store**: agents can store structured facts
  - API: `POST /api/companies/:cid/facts` (agent creates a fact)
  - Types: decision, entity, relationship, observation
  - Subject-predicate-object triples with confidence scores
  - Validity tracking (valid_from, invalidated_at)
  - Embedding for semantic retrieval
- [ ] **Shared embedding store**: company-wide vector search
  - Content types: lesson, fact, document, code
  - Hybrid search: pgvector cosine similarity + full-text search
  - Deduplication via content_hash
- [ ] **Memory tools for agents**: agents can call these during heartbeats
  - `memory_store(content, type)` -- persist a memory
  - `memory_retrieve(query, type_filter)` -- semantic search
  - `fact_store(subject, predicate, object)` -- store a typed fact
  - `fact_query(subject?, predicate?, object?)` -- query facts
- [ ] **Context compaction** (improved):
  - Structured extraction: extract facts, decisions, learnings before compacting
  - MemGPT-style paging: agent explicitly manages what's in context
  - Always-present core context (identity, current task, constraints) -- never compacted
  - Compaction as graceful degradation, not primary strategy

### 2.10 Semantic Progress Events (NEW)
- [ ] Agent progress reporting during heartbeats:
  ```json
  {"phase": "research", "step": 2, "totalSteps": 5,
   "description": "Analyzing competitor data", "confidence": 0.7}
  ```
- [ ] Enhanced stuck detection:
  - Time-per-progress tracking (flag at 3x P95 duration)
  - Budget-proportional progress (80% budget spent + 20% progress = escalate)
  - Cosine similarity on recent actions (detect semantic loops)
- [ ] Progress events streamed to dashboard via WebSocket

### 2.11 Agent-to-Agent Communication
- [ ] Internal messaging: agent can message other agents (respecting org chart permissions)
- [ ] `POST /api/companies/:cid/agents/:id/message` -- send message to agent (triggers wake)
- [ ] Message routing: respect `agent_messaging` capability in agent config
- [ ] Peer-to-peer for collaboration, not forced through chain-of-command (critique #3)

### 2.12 CLI Extensions
- [ ] `clawgear agent spawn <role> --company <id>` -- create agent (from template or custom)
- [ ] `clawgear agent list --company <id>` -- list agents with status
- [ ] `clawgear agent chat <name>` -- interactive chat session
- [ ] `clawgear agent heartbeat <name>` -- manually trigger heartbeat
- [ ] `clawgear issue create <title> --company <id> --goal <id>`
- [ ] `clawgear issue list --company <id>` -- list with filters
- [ ] `clawgear issue assign <id> --agent <name>`

**Exit criteria:** An agent wakes up (scheduled or event-driven), assembles context with goal constraints + relevant lessons, executes via Claude Code adapter in a Docker sandbox, self-reflects, passes quality gate, stores a lesson learned, and updates its competence score. The second time it encounters a similar task, it retrieves the lesson from the first run.

### Research Insights: Phase 2

**Heartbeat as agent loop, not pipeline:** The 8-step heartbeat procedure (2.1) describes a pipeline the system drives. Instead, treat the heartbeat as an agent loop: the agent receives context + tools, decides what to do, calls `complete_task` when done. The system provides tools; the agent drives execution. This is the single most important agent-native fix.

```typescript
// Agent tools available during heartbeat (the Agent Tool Manifest)
const heartbeatTools = [
  // Work tools
  'checkout_issue',      // Claim an issue from the backlog
  'update_issue_status', // Move issue through state machine
  'add_comment',         // Comment on an issue
  'create_sub_issue',    // Break down work
  // Memory tools
  'memory_store',        // Persist a memory
  'memory_retrieve',     // Semantic search memories
  'fact_store',          // Store an SPO triple
  'fact_query',          // Query the fact store
  // Communication tools
  'message_agent',       // Send message to another agent
  'request_approval',    // Request approval from manager/board
  // Meta tools
  'report_progress',     // Emit semantic progress event
  'complete_task',       // EXPLICIT heartbeat terminator
];
```

**Docker container pooling (CRITICAL performance fix):**
- Do NOT create/destroy containers per heartbeat (500ms-1.3s overhead each)
- Create persistent per-agent containers at agent creation time
- Use `docker exec` for each heartbeat invocation
- Add `container_id TEXT` and `container_status TEXT` to `agent_runtime_state`
- Container health check on heartbeat start; recreate only if unhealthy
- Resource limits: `--memory=2g --cpus=1.0 --pids-limit=256` per container
- Network: `--network=clawgear-sandbox` with egress allowlist proxy

```typescript
// Container lifecycle
async function ensureContainer(agent: Agent): Promise<string> {
  const state = await getAgentRuntimeState(agent.id);
  if (state.container_id && await isContainerHealthy(state.container_id)) {
    return state.container_id;
  }
  // Recreate if missing or unhealthy
  const containerId = await createAgentContainer(agent);
  await updateRuntimeState(agent.id, { container_id: containerId });
  return containerId;
}
```

**Embedding generation -- batch and async:**
- Never generate embeddings synchronously in the heartbeat path
- Use a background job queue: `INSERT INTO embedding_queue (content, target_table, target_id)`
- Worker process picks up queue items, generates embeddings in batches (OpenAI supports up to 2048 inputs per batch)
- Until embedding is generated, content is still searchable via full-text (GIN index) but not via vector similarity

**Hybrid search with RRF (Reciprocal Rank Fusion):**
```sql
-- Vector search (fast with HNSW)
WITH vector_results AS (
  SELECT id, content, embedding <=> $query_embedding AS distance,
         ROW_NUMBER() OVER (ORDER BY embedding <=> $query_embedding) AS rank
  FROM shared_embeddings
  WHERE company_id = $company_id
  ORDER BY embedding <=> $query_embedding
  LIMIT 50
),
-- Full-text search
fts_results AS (
  SELECT id, content,
         ts_rank_cd(to_tsvector('english', content), plainto_tsquery('english', $query)) AS rank_score,
         ROW_NUMBER() OVER (ORDER BY ts_rank_cd(to_tsvector('english', content), plainto_tsquery('english', $query)) DESC) AS rank
  FROM shared_embeddings
  WHERE company_id = $company_id
    AND to_tsvector('english', content) @@ plainto_tsquery('english', $query)
  LIMIT 50
)
-- RRF fusion (k=60 is standard)
SELECT COALESCE(v.id, f.id) AS id,
       COALESCE(v.content, f.content) AS content,
       COALESCE(1.0 / (60 + v.rank), 0) + COALESCE(1.0 / (60 + f.rank), 0) AS rrf_score
FROM vector_results v
FULL OUTER JOIN fts_results f ON v.id = f.id
ORDER BY rrf_score DESC
LIMIT 10;
```

**Checkpointing for long tasks:**
- Agent calls `report_progress` with state snapshot every N tool calls
- If heartbeat times out or crashes, next heartbeat resumes from last checkpoint
- Store checkpoints in `agent_runtime_state.state_json`
- Checkpoint schema: `{ phase, step, partial_results, tool_call_count, tokens_used }`

**Error recovery procedures (currently unspecified):**
| Failure | Detection | Recovery |
|---------|-----------|----------|
| PostgreSQL down | Connection pool health check | Retry 3x with exponential backoff, then pause all heartbeats, emit SYSTEM_DEGRADED event |
| Docker daemon down | Container health check fails | Pause agents requiring sandbox, allow non-sandbox agents to continue |
| LLM API unavailable | HTTP 429/500/503 | Per-provider backoff (30s, 60s, 120s), failover to secondary provider, then pause agent |
| Embedding API down | HTTP error on embed call | Queue for retry, fall back to full-text-only search |
| Agent infinite loop | Loop guard (SHA256 dedup + cosine similarity) | Kill heartbeat, mark run as failed, increment loop_count, pause agent after 3 loops |

**Claude Code adapter specifics:**
- Spawn `claude` CLI with `--print` flag for non-interactive mode
- Pass context via `--system-prompt` and task via stdin
- Parse JSON output for tool calls and results
- Extract cost from `usage` field in response
- Session persistence: use `--session-id` flag to resume across heartbeats
- Timeout: 5 minutes default, configurable per agent

---

## Phase 3: Security (Essential Layers Only)

9 essential security layers. No Merkle chains, no Ed25519, no taint tracking.

### 3.1 RBAC Capability Gates
- [ ] Capability definition per agent (capabilities JSONB)
- [ ] Kernel-enforced capability checking before tool execution
- [ ] Capability types: `FileRead(glob)`, `FileWrite(glob)`, `NetConnect(pattern)`, `ToolInvoke(tool_id)`, `AgentMessage(agent_id)`
- [ ] No privilege escalation: agents cannot grant capabilities they don't have
- [ ] Capability audit logging

### 3.2 Subprocess Sandbox
- [ ] `env_clear()` -- subprocess starts with clean environment
- [ ] Selective passthrough of safe env vars only
- [ ] Process tree isolation (kill entire tree on timeout)
- [ ] Direct argv execution via argument parsing (no shell interpreter, prevents injection)
- [ ] Working directory confinement

### 3.3 Prompt Injection Defense (COMPREHENSIVE -- critique #8)
- [ ] **Input sanitization**: all external data (web scrapes, API responses, user messages) sanitized before entering agent context
  - Escape system prompt markers and override patterns
  - Strip encoded exfiltration patterns
- [ ] **Output filtering**: scan agent responses for data exfiltration
  - Detect encoded data, suspicious URLs, credential patterns
- [ ] **Tool call validation**: anomaly detection on tool call patterns
  - Is the agent calling tools consistent with its current task?
  - Flag unexpected tool calls for review
- [ ] **Context isolation**: untrusted inputs in a clearly delimited section
  - User data marked as `<user-data>` blocks, not mixed with instructions
- [ ] **Injection attempt logging**: log detected injection attempts to activity_log
- [ ] Configurable strictness levels per agent/role

### 3.4 SSRF Protection
- [ ] Block requests to private IP ranges (10.x, 172.16-31.x, 192.168.x)
- [ ] Block cloud metadata endpoints (169.254.169.254)
- [ ] DNS rebinding protection
- [ ] Configurable allowlist for agent HTTP egress

### 3.5 Security Headers
- [ ] CSP, HSTS, X-Frame-Options, X-Content-Type-Options
- [ ] Applied to all API and dashboard responses

### 3.6 Loop Guard (Enhanced)
- [ ] SHA256 tool call deduplication with circuit breaker
- [ ] **Semantic loop detection**: cosine similarity on recent N actions
- [ ] Configurable max iterations per heartbeat
- [ ] Automatic escalation when loop detected (pause agent, notify dashboard)

### 3.7 Secret Management
- [ ] Company secrets stored encrypted at rest (AES-256-GCM)
- [ ] Agent API keys stored as SHA-256 hashes (plaintext shown once at creation)
- [ ] Secret redaction in all logs and API responses
- [ ] Secret rotation support

### 3.8 API Authentication
- [ ] API key authentication for external access
- [ ] Rate limiting per API key (GCRA algorithm)
- [ ] Request signing for agent-to-API calls

**Exit criteria:** An agent in a Docker sandbox cannot: access private IPs, invoke tools outside its capability set, spawn uncontrolled subprocesses, exfiltrate data via output, or bypass rate limits. Injection attempts are detected and logged.

### Research Insights: Phase 3

**Move prompt injection defense to Phase 2:** Prompt injection defense (3.3) is listed in Phase 3, but agents start executing in Phase 2. Any agent that processes external data (web scrapes, user messages, API responses) needs injection defense before it runs. Move the guardian pattern to Phase 2 as a prerequisite for agent execution.

**Guardian pattern for prompt injection (from security research):**
```typescript
// SecurityGate implementation
class PromptInjectionGuard implements SecurityGate {
  async sanitizeInput(input: string, source: InputSource): string {
    if (source === 'system') return input; // trusted
    // Wrap untrusted content in XML delimiters
    return `<retrieved-context source="${source}" trust="untrusted">
${this.escapeSystemMarkers(input)}
</retrieved-context>`;
  }

  private escapeSystemMarkers(text: string): string {
    // Strip patterns that could override system prompts
    return text
      .replace(/\[SYSTEM\]/gi, '[FILTERED]')
      .replace(/\[INST\]/gi, '[FILTERED]')
      .replace(/<\|im_start\|>/gi, '')
      .replace(/Human:|Assistant:/gi, (m) => m.replace(/:/g, ''));
  }

  async sanitizeOutput(output: string): string {
    // Detect encoded exfiltration (base64, hex, URL-encoded data blobs)
    if (this.detectExfiltration(output)) {
      await this.logInjectionAttempt('output_exfiltration', output);
      return '[OUTPUT REDACTED: potential data exfiltration detected]';
    }
    return this.redactSecrets(output);
  }
}
```

**Docker network security:**
- Create a dedicated Docker network: `docker network create --internal clawgear-sandbox`
- Egress only through an allowlist proxy (Squid or Envoy)
- DNS restricted to the proxy (blocks DNS tunneling)
- Default deny all outbound; allowlist per agent's `NetConnect(pattern)` capability
- Block metadata endpoints: `--add-host=metadata.google.internal:127.0.0.1`

**Secret management specifics:**
- Master encryption key from `CLAWGEAR_MASTER_KEY` env var (never stored in DB)
- Derive per-company encryption keys via HKDF: `HKDF(master_key, company_id, "company-secrets")`
- Agent API keys: generate 32-byte random, store `SHA256(key)`, show plaintext once
- Secret redaction: compile regex patterns from stored secrets, apply to all log output and API responses
- Rotation: generate new key, re-encrypt all company secrets in a transaction, invalidate old key

**RBAC capability structure:**
```typescript
type Capability =
  | { type: 'file_read'; glob: string }
  | { type: 'file_write'; glob: string }
  | { type: 'net_connect'; pattern: string }  // e.g., "*.github.com"
  | { type: 'tool_invoke'; tool_id: string }
  | { type: 'agent_message'; agent_id: string | '*' }
  | { type: 'shell_exec'; commands: string[] }  // allowlisted commands only
  | { type: 'docker_exec'; image: string };

// Enforcement: check BEFORE tool execution, not after
async function enforceCapability(agentId: string, action: ToolCall): Promise<void> {
  const capabilities = await getAgentCapabilities(agentId);
  const required = mapToolCallToCapability(action);
  if (!capabilities.some(cap => satisfies(cap, required))) {
    await logCapabilityViolation(agentId, action, required);
    throw new CapabilityDeniedError(agentId, required);
  }
}
```

**Security testing requirements for exit criteria:**
- Add a security test suite that validates each of the 9 layers
- Test: agent in sandbox attempts `curl 169.254.169.254` -> blocked
- Test: agent calls tool outside capability set -> denied + logged
- Test: input with `[SYSTEM]` override -> sanitized before reaching agent
- Test: output with base64-encoded secrets -> redacted
- Test: agent attempts to `kill -9` parent process -> blocked by subprocess isolation

---

## Phase 4: Communication + Channels

Add real-time communication. WebChat first, then Slack.

### 4.1 WebSocket Gateway
- [ ] Typed JSON-RPC protocol over WebSocket
- [ ] Role-based connections: Operator (human/dashboard), Agent (internal)
- [ ] Presence tracking (connected clients, agent status)
- [ ] Event streaming (real-time dashboard updates)
- [ ] Reconnection handling with session resume

### 4.2 WebChat Channel (Built-In)
- [ ] Chat widget component for the dashboard
- [ ] Direct conversation with any agent
- [ ] Message routing: chat message -> agent wake (event-driven, not heartbeat)
- [ ] Streaming responses via SSE
- [ ] Conversation history

### 4.3 Slack Channel Adapter
- [ ] @slack/bolt integration
- [ ] Company binding (Slack workspace -> company)
- [ ] Agent binding (Slack channel/DM -> agent)
- [ ] Real-time message handling (event-driven wake)
- [ ] Response formatting (Slack blocks)
- [ ] Thread support (map to issue comments)

### 4.4 Channel Routing Framework
- [ ] Channel adapter interface:
  ```typescript
  interface ChannelAdapter {
    name: string
    init(config: ChannelConfig): Promise<void>
    send(message: OutboundMessage): Promise<void>
    onMessage(handler: (msg: InboundMessage) => void): void
    shutdown(): Promise<void>
  }
  ```
- [ ] Inbound routing: message -> company resolution -> agent binding -> session resolution -> wake agent
- [ ] Outbound routing: agent response -> channel adapter -> formatted delivery
- [ ] Binding management API (CRUD for channel-agent bindings)
- [ ] Most-specific binding wins (DM > channel > default)

### 4.5 SSE Streaming
- [ ] `POST /api/companies/:cid/agents/:id/message/stream` -- streaming responses
- [ ] Events: `chunk`, `tool_use`, `tool_result`, `progress`, `done`
- [ ] Dashboard integration for real-time agent output display

**Exit criteria:** A user can chat with an agent via the web dashboard (WebChat) or Slack. Messages trigger immediate agent wake (event-driven). Agent streams responses back to the originating channel.

### Research Insights: Phase 4

**WebSocket connection management:** Hono's `createBunWebSocket()` provides raw WebSocket support but no connection tracking, room management, or heartbeat/ping. Implement:
- Connection registry: `Map<string, Set<WebSocket>>` keyed by `company_id`
- Ping/pong every 30s to detect stale connections
- Reconnection with session token (JWT) to restore subscriptions
- Company-scoped broadcasting: events only sent to connections authenticated for that company

**Channel message -> agent wake latency target:** < 500ms from message receipt to agent heartbeat start. This requires event-driven wake to bypass the scheduler entirely. Use an in-process event emitter, not a database poll.

---

## Phase 5: Autonomous Operations (Hands)

Self-running capability packages for background tasks.

### 5.1 Hands Framework
- [ ] HAND.toml parser (tools, settings, metrics, schedule, requirements)
- [ ] Hand lifecycle management (activate, deactivate, status)
- [ ] Schedule-based execution (separate from heartbeat scheduler)
- [ ] Hand cost attribution (to owning agent's budget)
- [ ] Hand output as issue comments or new issues
- [ ] Approval gate integration (Hands that require approval before acting)

### 5.2 Researcher Hand
- [ ] Deep research with CRAAP methodology
- [ ] Web search + source evaluation
- [ ] Research findings posted as issue comments
- [ ] Knowledge graph updates (facts table) from research

### 5.3 Collector Hand (OSINT Monitoring)
- [ ] Configurable monitoring targets (competitors, keywords, domains)
- [ ] Periodic collection runs
- [ ] Critical alerts escalated to CEO agent
- [ ] Findings stored in shared knowledge

### 5.4 Browser Hand
- [ ] Web automation workflows
- [ ] Purchase approval gates (human approval required)
- [ ] Screenshot/evidence collection

### 5.5 Hand Dashboard
- [ ] Status view per hand (active/inactive, last run, next run)
- [ ] Metrics display (runs, costs, outputs)
- [ ] Manual trigger and deactivation controls

### 5.6 CLI Extensions
- [ ] `clawgear hand activate <name>`
- [ ] `clawgear hand deactivate <name>`
- [ ] `clawgear hand status <name>`
- [ ] `clawgear hand list`

**Exit criteria:** A Researcher Hand runs on schedule, conducts web research, posts findings as issue comments, stores facts in shared knowledge, and respects the owning agent's budget.

### Research Insights: Phase 5

**Hands are just agents with schedules:** Don't create a separate framework. A Hand is an agent with `adapter_type = 'hand'`, a HAND.toml config parsed into `adapter_config`, and a cron schedule. Reuse the heartbeat execution engine, quality gates, budget enforcement, and learning system. The only new code is the HAND.toml parser and the schedule-to-heartbeat bridge.

---

## Phase 6: Evolution

Systems that make agents measurably better over time.

### 6.1 Skill Evolution (Voyager Pattern)
- [ ] After N successful runs of a pattern, agent proposes a new SKILL.md
- [ ] Skill approval gate (manager or board reviews)
- [ ] Approved skills added to company skill library
- [ ] Other agents can discover and use evolved skills
- [ ] Skill versioning and deprecation

### 6.2 Prompt Optimization Pipeline (DSPy-Inspired)
- [ ] Collect successful vs. failed runs with their prompts and outputs
- [ ] After 100+ runs: use successful runs as few-shot examples
- [ ] Generate optimized prompts using quality gate scores as the objective
- [ ] A/B testing: 10% of tasks use optimized prompt
- [ ] Auto-rollback if quality regresses
- [ ] Prompt version tracking (prompt_versions table)

### 6.3 Advanced Competence Tracking
- [ ] Curriculum learning: start agents on simple tasks, graduate to complex
- [ ] Task routing optimization: assign to most competent available agent (not just chain-of-command)
- [ ] Competence decay: agents that haven't done a task type recently lose autonomy level
- [ ] Team competence dashboard: which task types are the team strong/weak at?

### 6.4 Strategy Learning
- [ ] CEO agent tracks which strategies produce good outcomes
- [ ] Goal decomposition patterns that worked get reinforced
- [ ] Delegation patterns that worked get reinforced
- [ ] Strategic reflection: "Are we pursuing the right goals?"

### 6.5 Memory Consolidation
- [ ] Periodic consolidation job: merge duplicate lessons, resolve conflicts, generalize patterns
- [ ] Fact validation: check if stored facts are still current
- [ ] Lesson utility scoring: lessons retrieved more often + associated with success get higher confidence
- [ ] Archive low-confidence, low-retrieval lessons

**Exit criteria:** After 100+ heartbeats, the system has: generated at least one evolved skill, optimized at least one agent's prompt with measurable improvement, and graduated at least one agent from supervised to semi_auto autonomy.

### Research Insights: Phase 6

**Prompt optimization -- use DSPy patterns but not DSPy itself:**
- Collect (input, output, score) triples from quality evaluations
- After 100+ examples: select top-10 by score as few-shot exemplars
- Generate candidate prompts by varying: instruction phrasing, few-shot selection, output format
- Evaluate candidates on a held-out set of 20 examples using the same rubric
- Deploy winner at 10% traffic, compare quality scores, auto-rollback if regression > 5%
- The `prompt_versions` table already supports this workflow

**Skill evolution guard rails:**
- Require 5+ successful uses of the pattern before proposing a skill
- Skill proposal must include: trigger conditions, expected inputs/outputs, 3+ example invocations
- Manager approval required; auto-reject if similar skill already exists (cosine similarity > 0.9 on description embedding)
- Skills are immutable once published; new versions get new IDs

**Graduated autonomy thresholds:**
| Level | Requirements | What changes |
|-------|-------------|-------------|
| supervised | Default for new agents | Every output gets peer review |
| semi_auto | 20+ runs, 80%+ pass rate, 0 critical failures in last 10 | Only failures and high-impact tasks reviewed |
| auto | 50+ runs, 90%+ pass rate, 0 critical failures in last 20 | Quality gate only, no peer review |
| degraded | 3+ failures in last 10 runs | Downgrade to supervised, notify manager |

---

## Phase 7: Desktop, Devices, Ecosystem

Expand the surface area. Only start this after Phases 0-4 are solid.

### 7.1 Additional Channel Adapters
- [ ] Discord (discord.js)
- [ ] Telegram (grammY)
- [ ] WhatsApp (@whiskeysockets/baileys)
- [ ] Microsoft Teams (Bot Framework)
- [ ] Email (IMAP/SMTP)

### 7.2 Workflow Engine
- [ ] Multi-step agent pipelines (TOML definition)
- [ ] Execution modes: sequential, fan_out, collect, conditional, loop
- [ ] Variable substitution (`{{input}}`, `{{named_var}}`)
- [ ] Error handling per step (fail, skip, retry)
- [ ] Agent resolution via org chart roles
- [ ] Workflow run tracking and cost attribution

### 7.3 Trigger Engine
- [ ] Event-driven automation via pattern matching on event bus
- [ ] Pattern types: lifecycle, budget_threshold, approval_pending, issue_status_change, etc.
- [ ] Prompt template with `{{event}}` substitution
- [ ] Fire count limits and auto-disable

### 7.4 Tauri Desktop App
- [ ] Tauri 2.0 shell wrapping the web dashboard
- [ ] System tray with status indicator
- [ ] Native notifications for urgent attention queue items
- [ ] Close-to-tray behavior

### 7.5 Browser Automation
- [ ] Playwright/CDP integration for web tasks
- [ ] Isolated Chromium instance per agent
- [ ] Extension Relay mode for existing browser sessions

### 7.6 GearHub Marketplace
- [ ] Skill publishing with integrity verification
- [ ] Search and discovery
- [ ] `clawgear skill install <name>` / `clawgear skill publish`
- [ ] Security scanning for malicious patterns
- [ ] Ed25519 signing (NOW add this -- marketplace needs it)

### 7.7 Migration Engine
- [ ] `clawgear migrate --from paperclip` (companies, agents, issues)
- [ ] `clawgear migrate --from openfang` (agents, memory, skills)
- [ ] `clawgear migrate --from openclaw` (config, sessions, skills)
- [ ] Dry-run mode

**Exit criteria:** ClawGear runs as a native desktop app, supports 5+ channels, has a workflow engine for multi-step pipelines, and a marketplace for sharing skills.

### Research Insights: Phase 7

**RLS was moved to Phase 0.** Remove section 8.7 (Multi-Tenancy Hardening) from Phase 8 -- it's now part of the initial migration. Phase 8 should focus on advanced security (Merkle, Ed25519, taint tracking, WASM) and scale (P2P, multi-instance, mobile).

**Activity log partitioning:** By Phase 7, the `activity_log` table will be the largest in the system. Add time-based partitioning (monthly) before it reaches 10M+ rows. PostgreSQL declarative partitioning:
```sql
CREATE TABLE activity_log (
  -- same columns --
) PARTITION BY RANGE (created_at);

CREATE TABLE activity_log_2026_01 PARTITION OF activity_log
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
-- Auto-create partitions via pg_partman or a scheduled job
```

---

## Phase 8: Advanced Security + Scale

Only when the core is proven and compliance demands it.

### 8.1 WASM Sandbox (Optional High-Security Mode)
- [ ] Wasmtime integration for marketplace skills compiled to WASM
- [ ] Dual metering (fuel + epoch)
- [ ] Watchdog thread
- [ ] Only for specifically compiled WASM skills, not the general sandbox

### 8.2 Merkle Hash-Chain Audit
- [ ] Cryptographically linked, tamper-evident action log
- [ ] Verification endpoint (`GET /api/audit/verify`)
- [ ] Builds on top of the existing activity_log

### 8.3 Ed25519 Manifest Signing (Extended)
- [ ] Agent identity signing (beyond marketplace skills)
- [ ] Capability declaration signing

### 8.4 Taint Tracking
- [ ] Information flow labels propagated source-to-sink
- [ ] Classify data sensitivity levels
- [ ] Prevent sensitive data from reaching unauthorized tools/channels

### 8.5 P2P Mutual Authentication
- [ ] For multi-instance ClawGear deployments
- [ ] HMAC-SHA256 nonce-based mutual auth
- [ ] Cross-instance agent delegation

### 8.6 Mobile Companion Apps
- [ ] iOS (Swift) companion
- [ ] Android (Kotlin) companion
- [ ] Device node pairing (camera, screen, location, notifications)

### 8.7 Multi-Tenancy Hardening
- [ ] ~~Row-level security policies in PostgreSQL~~ **(Moved to Phase 0 -- see Schema Research Insights)**
- [ ] Tenant isolation testing (fuzz testing: verify no cross-tenant data access across all API endpoints)
- [ ] Rate limiting per tenant
- [ ] Database-per-tenant option for whale customers

**Exit criteria:** The system meets compliance requirements for regulated industries. Multi-instance deployment is supported with mutual authentication.

### Research Insights: Phase 8

**Observability before scale:** Before Phase 8, add structured logging (JSON), distributed tracing (OpenTelemetry), and metric collection. At minimum: heartbeat duration p50/p95/p99, quality gate pass rate (rolling 7d), LLM cost per heartbeat, memory retrieval latency, container startup time. These metrics are prerequisites for identifying what to scale.

---

## Dependency Graph

```
Phase 0 (Foundation)
  |
  v
Phase 1 (Orchestration + Quality)
  |
  v
Phase 2 (Runtime + Learning)
  |
  +------+------+
  |      |      |
  v      v      v
Phase 3  Phase 4  Phase 5
(Security) (Channels) (Hands)
  |      |      |
  +------+------+
         |
         v
   Phase 6 (Evolution)
         |
         v
   Phase 7 (Ecosystem)
         |
         v
   Phase 8 (Scale)
```

Phases 3, 4, and 5 can be developed in parallel after Phase 2 is complete.

---

## Success Metrics

| Metric | Target (3 months) | Target (6 months) |
|---|---|---|
| Quality gate pass rate | 60% on first attempt | 80% on first attempt |
| Agent improvement | Measurable trend | 15%+ quality increase vs month 1 |
| Lessons generated | 100+ company-wide | 1000+ with consolidation |
| Graduated autonomy | At least 1 agent at semi_auto | At least 3 agents at auto |
| Evolved skills | 0 (learning phase) | 5+ agent-created skills in use |
| Budget accuracy | Within 20% of estimates | Within 10% of estimates |
| Prompt optimization | Baseline established | 10%+ improvement over baseline |

---

## Open Questions (Remaining)

| # | Question | Recommended Resolution |
|---|---|---|
| 1 | Which embedding model? | Start with `text-embedding-3-small` (1536 dims). Upgrade path to `text-embedding-3-large` or open-source BGE-M3. Add model column to embeddings for migration. |
| 2 | Licensing model? | MIT for maximum adoption. Revisit if SaaS hosting becomes a concern. |
| 3 | CEO strategic planning? | Phase 1: Human-defined goals, AI-optimized execution. Phase 6+: LLM-driven goal decomposition with board approval. |
| 4 | ClawHub security (malicious skills)? | Docker sandbox + automated scanning + reputation system. Curated registry for V1. |
| 5 | Multi-tenancy model? | Row-level isolation (current design). Database-per-tenant only if a whale customer requires it. |
| 6 | Reranker for retrieval? | **Use RRF for V1** (microseconds, 85-90% of neural quality). Add Cohere Rerank in Phase 6 when volume justifies the 100-300ms latency per query. |
| 7 | User authentication? | **Add in Phase 0.** Email/password + bcrypt, JWT (15 min) + refresh tokens, user-to-company roles (admin/operator/viewer). API keys for programmatic access. |
| 8 | Error recovery strategy? | **Define per failure type** (see Phase 2 Research Insights). PostgreSQL down -> pause heartbeats. Docker down -> pause sandbox agents. LLM API down -> provider failover then pause. |
| 9 | Observability stack? | **OpenTelemetry + structured JSON logs.** Add before Phase 6. Metrics: heartbeat p95, quality pass rate, LLM cost/heartbeat, retrieval latency. |
