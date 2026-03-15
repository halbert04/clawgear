-- Migration 0002: Add missing tables and fix enum constraints
-- Adds: triggers, workflows, workflow_runs, workflow_step_runs,
--        channel_bindings, conversations, conversation_messages,
--        evolved_skills, strategy_patterns, marketplace_skills,
--        audit_chain, agent_capability_declarations
-- Fixes: adapter_type, autonomy_level, approvals type constraints
-- Adds missing columns to agents, agent_competence, prompt_versions

-- ============================================================
-- FIX ENUM CONSTRAINTS
-- ============================================================

-- Add 'hand' to adapter_type
ALTER TABLE "agents" DROP CONSTRAINT "agents_adapter_type_check";
ALTER TABLE "agents" ADD CONSTRAINT "agents_adapter_type_check"
  CHECK ("agents"."adapter_type" IN ('claude_code', 'process', 'http', 'hand'));

-- Add 'degraded' to autonomy_level
ALTER TABLE "agent_competence" DROP CONSTRAINT "competence_autonomy_check";
ALTER TABLE "agent_competence" ADD CONSTRAINT "competence_autonomy_check"
  CHECK ("agent_competence"."autonomy_level" IN ('supervised', 'semi_auto', 'auto', 'degraded'));

-- Add 'hand_action', 'skill_proposal' to approvals type
ALTER TABLE "approvals" DROP CONSTRAINT "approvals_type_check";
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_type_check"
  CHECK ("approvals"."type" IN ('hire_agent', 'strategy', 'purchase', 'publish', 'budget_increase', 'hand_action', 'skill_proposal'));

-- ============================================================
-- ADD MISSING COLUMNS
-- ============================================================

-- agents: identity columns
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "public_key" text;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "identity_signature" text;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "identity_version" integer NOT NULL DEFAULT 0;

-- agent_competence: last_used_at
ALTER TABLE "agent_competence" ADD COLUMN IF NOT EXISTS "last_used_at" timestamp with time zone;

-- prompt_versions: A/B testing columns
ALTER TABLE "prompt_versions" ADD COLUMN IF NOT EXISTS "is_ab_testing" boolean NOT NULL DEFAULT false;
ALTER TABLE "prompt_versions" ADD COLUMN IF NOT EXISTS "ab_traffic_percent" integer NOT NULL DEFAULT 0;
ALTER TABLE "prompt_versions" ADD COLUMN IF NOT EXISTS "sample_count" integer NOT NULL DEFAULT 0;
ALTER TABLE "prompt_versions" ADD CONSTRAINT "prompt_versions_ab_traffic_check"
  CHECK ("prompt_versions"."ab_traffic_percent" >= 0 AND "prompt_versions"."ab_traffic_percent" <= 100);

-- ============================================================
-- EVOLVED SKILLS
-- ============================================================

CREATE TABLE "evolved_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"proposed_by_agent_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"content" text NOT NULL,
	"trigger_conditions" text NOT NULL,
	"example_invocations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"parent_skill_id" uuid,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"embedding" vector(1536),
	"embedding_model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evolved_skills_company_name_version" UNIQUE("company_id","name","version"),
	CONSTRAINT "evolved_skills_status_check" CHECK ("evolved_skills"."status" IN ('proposed', 'approved', 'active', 'deprecated')),
	CONSTRAINT "evolved_skills_version_check" CHECK ("evolved_skills"."version" >= 1),
	CONSTRAINT "evolved_skills_usage_check" CHECK ("evolved_skills"."usage_count" >= 0)
);

ALTER TABLE "evolved_skills" ADD CONSTRAINT "evolved_skills_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade;
ALTER TABLE "evolved_skills" ADD CONSTRAINT "evolved_skills_proposed_by_fk" FOREIGN KEY ("proposed_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade;
ALTER TABLE "evolved_skills" ADD CONSTRAINT "evolved_skills_parent_fk" FOREIGN KEY ("parent_skill_id") REFERENCES "public"."evolved_skills"("id") ON DELETE set null;

CREATE INDEX "idx_evolved_skills_company" ON "evolved_skills" USING btree ("company_id","status");

-- ============================================================
-- STRATEGY PATTERNS
-- ============================================================

CREATE TABLE "strategy_patterns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"pattern_type" text NOT NULL,
	"description" text NOT NULL,
	"success_count" integer DEFAULT 0 NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"confidence" double precision DEFAULT 0.5 NOT NULL,
	"context_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "strategy_patterns_type_check" CHECK ("strategy_patterns"."pattern_type" IN ('goal_decomposition', 'delegation', 'resource_allocation')),
	CONSTRAINT "strategy_patterns_confidence_check" CHECK ("strategy_patterns"."confidence" >= 0 AND "strategy_patterns"."confidence" <= 1),
	CONSTRAINT "strategy_patterns_success_check" CHECK ("strategy_patterns"."success_count" >= 0),
	CONSTRAINT "strategy_patterns_failure_check" CHECK ("strategy_patterns"."failure_count" >= 0)
);

ALTER TABLE "strategy_patterns" ADD CONSTRAINT "strategy_patterns_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade;
ALTER TABLE "strategy_patterns" ADD CONSTRAINT "strategy_patterns_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade;

CREATE INDEX "idx_strategy_patterns_company" ON "strategy_patterns" USING btree ("company_id","agent_id");

-- ============================================================
-- CHANNEL BINDINGS
-- ============================================================

CREATE TABLE "channel_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"channel_name" text NOT NULL,
	"agent_id" uuid NOT NULL,
	"external_channel_id" text,
	"binding_type" text DEFAULT 'default' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_bindings_type_check" CHECK ("channel_bindings"."binding_type" IN ('default', 'dm', 'channel', 'thread'))
);

ALTER TABLE "channel_bindings" ADD CONSTRAINT "channel_bindings_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade;
ALTER TABLE "channel_bindings" ADD CONSTRAINT "channel_bindings_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade;

CREATE INDEX "idx_channel_bindings_company" ON "channel_bindings" USING btree ("company_id","channel_name");
CREATE INDEX "idx_channel_bindings_agent" ON "channel_bindings" USING btree ("agent_id");

-- ============================================================
-- CONVERSATIONS
-- ============================================================

CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"channel_name" text NOT NULL,
	"external_thread_id" text,
	"title" text,
	"status" text DEFAULT 'active' NOT NULL,
	"participant_id" text,
	"participant_name" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_status_check" CHECK ("conversations"."status" IN ('active', 'archived', 'closed'))
);

ALTER TABLE "conversations" ADD CONSTRAINT "conversations_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade;

CREATE INDEX "idx_conversations_company" ON "conversations" USING btree ("company_id","status");
CREATE INDEX "idx_conversations_agent" ON "conversations" USING btree ("agent_id","status");
CREATE INDEX "idx_conversations_last_message" ON "conversations" USING btree ("company_id","last_message_at");

-- ============================================================
-- CONVERSATION MESSAGES
-- ============================================================

CREATE TABLE "conversation_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"agent_id" uuid,
	"sender_id" text,
	"sender_name" text,
	"run_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_messages_role_check" CHECK ("conversation_messages"."role" IN ('user', 'agent', 'system'))
);

ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade;
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade;
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null;
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null;

CREATE INDEX "idx_conversation_messages_conversation" ON "conversation_messages" USING btree ("conversation_id","created_at");

-- ============================================================
-- TRIGGERS
-- ============================================================

CREATE TABLE "triggers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"pattern_type" text NOT NULL,
	"pattern_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"action_type" text NOT NULL,
	"action_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"fire_count" integer DEFAULT 0 NOT NULL,
	"max_fire_count" integer,
	"last_fired_at" timestamp with time zone,
	"cooldown_ms" integer DEFAULT 10000 NOT NULL,
	"created_by_agent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "triggers_pattern_type_check" CHECK ("triggers"."pattern_type" IN ('event_match', 'budget_threshold', 'schedule_missed', 'quality_failure', 'agent_idle')),
	CONSTRAINT "triggers_action_type_check" CHECK ("triggers"."action_type" IN ('wake_agent', 'create_issue', 'run_workflow')),
	CONSTRAINT "triggers_fire_count_check" CHECK ("triggers"."fire_count" >= 0),
	CONSTRAINT "triggers_cooldown_check" CHECK ("triggers"."cooldown_ms" >= 0)
);

ALTER TABLE "triggers" ADD CONSTRAINT "triggers_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade;
ALTER TABLE "triggers" ADD CONSTRAINT "triggers_created_by_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null;

CREATE INDEX "idx_triggers_company_active" ON "triggers" USING btree ("company_id","is_active");

-- ============================================================
-- WORKFLOWS
-- ============================================================

CREATE TABLE "workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"definition" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_agent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "workflows" ADD CONSTRAINT "workflows_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade;
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_created_by_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null;

CREATE INDEX "idx_workflows_company_active" ON "workflows" USING btree ("company_id","is_active");

-- ============================================================
-- WORKFLOW RUNS
-- ============================================================

CREATE TABLE "workflow_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"input_vars" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output_vars" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"current_step_index" integer DEFAULT 0 NOT NULL,
	"total_steps" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_runs_status_check" CHECK ("workflow_runs"."status" IN ('running', 'completed', 'failed', 'cancelled'))
);

ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade;
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade;

CREATE INDEX "idx_workflow_runs_workflow_status" ON "workflow_runs" USING btree ("workflow_id","status");
CREATE INDEX "idx_workflow_runs_company_status" ON "workflow_runs" USING btree ("company_id","status");

-- ============================================================
-- WORKFLOW STEP RUNS
-- ============================================================

CREATE TABLE "workflow_step_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_run_id" uuid NOT NULL,
	"step_name" text NOT NULL,
	"step_index" integer NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"agent_id" uuid,
	"heartbeat_run_id" uuid,
	"input_vars" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output_vars" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_message" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_step_runs_status_check" CHECK ("workflow_step_runs"."status" IN ('pending', 'running', 'completed', 'failed', 'skipped')),
	CONSTRAINT "workflow_step_runs_mode_check" CHECK ("workflow_step_runs"."mode" IN ('sequential', 'fan_out', 'conditional'))
);

ALTER TABLE "workflow_step_runs" ADD CONSTRAINT "workflow_step_runs_run_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE cascade;
ALTER TABLE "workflow_step_runs" ADD CONSTRAINT "workflow_step_runs_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null;
ALTER TABLE "workflow_step_runs" ADD CONSTRAINT "workflow_step_runs_heartbeat_fk" FOREIGN KEY ("heartbeat_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null;

CREATE INDEX "idx_workflow_step_runs_run_index" ON "workflow_step_runs" USING btree ("workflow_run_id","step_index");

-- ============================================================
-- MARKETPLACE SKILLS
-- ============================================================

CREATE TABLE "marketplace_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"version" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"author" text NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"manifest" jsonb NOT NULL,
	"signature" text NOT NULL,
	"publisher_key" text NOT NULL,
	"package_data" text NOT NULL,
	"checksum" text NOT NULL,
	"downloads" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'published' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_marketplace_skills_name_version" UNIQUE("company_id","name","version"),
	CONSTRAINT "marketplace_skills_status_check" CHECK ("marketplace_skills"."status" IN ('published', 'unpublished', 'flagged'))
);

ALTER TABLE "marketplace_skills" ADD CONSTRAINT "marketplace_skills_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade;

CREATE INDEX "idx_marketplace_skills_company" ON "marketplace_skills" USING btree ("company_id");
CREATE INDEX "idx_marketplace_skills_name" ON "marketplace_skills" USING btree ("name");
CREATE INDEX "idx_marketplace_skills_author" ON "marketplace_skills" USING btree ("author");

-- ============================================================
-- AUDIT CHAIN
-- ============================================================

CREATE TABLE "audit_chain" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"details" jsonb,
	"entry_hash" text NOT NULL,
	"previous_hash" text,
	"chain_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_audit_chain_company_sequence" UNIQUE("company_id","sequence"),
	CONSTRAINT "audit_chain_actor_check" CHECK ("audit_chain"."actor_type" IN ('agent', 'user', 'system'))
);

ALTER TABLE "audit_chain" ADD CONSTRAINT "audit_chain_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade;

CREATE INDEX "idx_audit_chain_company_seq" ON "audit_chain" USING btree ("company_id","sequence");
CREATE INDEX "idx_audit_chain_chain_hash" ON "audit_chain" USING btree ("chain_hash");

-- ============================================================
-- AGENT CAPABILITY DECLARATIONS
-- ============================================================

CREATE TABLE "agent_capability_declarations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"granted_by" text NOT NULL,
	"signature" text NOT NULL,
	"signer_key" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_cap_decl_agent_version" UNIQUE("agent_id","version")
);

ALTER TABLE "agent_capability_declarations" ADD CONSTRAINT "cap_decl_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade;
ALTER TABLE "agent_capability_declarations" ADD CONSTRAINT "cap_decl_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade;

CREATE INDEX "idx_cap_decl_agent" ON "agent_capability_declarations" USING btree ("agent_id");
CREATE INDEX "idx_cap_decl_company" ON "agent_capability_declarations" USING btree ("company_id");

-- ============================================================
-- RLS + TRIGGERS FOR NEW TABLES
-- ============================================================

ALTER TABLE "evolved_skills" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "strategy_patterns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "channel_bindings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "conversation_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "triggers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workflows" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workflow_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workflow_step_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "marketplace_skills" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_chain" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent_capability_declarations" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON evolved_skills USING (company_id = current_setting('app.current_company_id', true)::UUID);
CREATE POLICY tenant_isolation ON strategy_patterns USING (company_id = current_setting('app.current_company_id', true)::UUID);
CREATE POLICY tenant_isolation ON channel_bindings USING (company_id = current_setting('app.current_company_id', true)::UUID);
CREATE POLICY tenant_isolation ON conversations USING (company_id = current_setting('app.current_company_id', true)::UUID);
CREATE POLICY tenant_isolation ON conversation_messages USING (company_id = current_setting('app.current_company_id', true)::UUID);
CREATE POLICY tenant_isolation ON triggers USING (company_id = current_setting('app.current_company_id', true)::UUID);
CREATE POLICY tenant_isolation ON workflows USING (company_id = current_setting('app.current_company_id', true)::UUID);
CREATE POLICY tenant_isolation ON workflow_runs USING (company_id = current_setting('app.current_company_id', true)::UUID);
CREATE POLICY tenant_isolation ON marketplace_skills USING (company_id = current_setting('app.current_company_id', true)::UUID);
CREATE POLICY tenant_isolation ON audit_chain USING (company_id = current_setting('app.current_company_id', true)::UUID);
CREATE POLICY tenant_isolation ON agent_capability_declarations USING (company_id = current_setting('app.current_company_id', true)::UUID);

CREATE TRIGGER trg_evolved_skills_updated_at BEFORE UPDATE ON evolved_skills FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_strategy_patterns_updated_at BEFORE UPDATE ON strategy_patterns FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_channel_bindings_updated_at BEFORE UPDATE ON channel_bindings FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_conversations_updated_at BEFORE UPDATE ON conversations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_triggers_updated_at BEFORE UPDATE ON triggers FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_workflows_updated_at BEFORE UPDATE ON workflows FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_marketplace_skills_updated_at BEFORE UPDATE ON marketplace_skills FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- HNSW index for evolved_skills embeddings
CREATE INDEX idx_evolved_skills_embedding ON evolved_skills
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
