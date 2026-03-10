-- Enable pgvector extension before creating tables with vector columns
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "activity_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"agent_id" uuid,
	"run_id" uuid,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_log_actor_check" CHECK ("activity_log"."actor_type" IN ('agent', 'user', 'system'))
);
--> statement-breakpoint
CREATE TABLE "agent_competence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"task_type" text NOT NULL,
	"total_runs" integer DEFAULT 0 NOT NULL,
	"successful_runs" integer DEFAULT 0 NOT NULL,
	"failed_runs" integer DEFAULT 0 NOT NULL,
	"avg_cost_cents" double precision DEFAULT 0 NOT NULL,
	"avg_duration_ms" double precision DEFAULT 0 NOT NULL,
	"avg_quality_score" double precision DEFAULT 0 NOT NULL,
	"quality_trend" text DEFAULT 'stable' NOT NULL,
	"autonomy_level" text DEFAULT 'supervised' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_competence_unique" UNIQUE("company_id","agent_id","task_type"),
	CONSTRAINT "competence_trend_check" CHECK ("agent_competence"."quality_trend" IN ('improving', 'stable', 'degrading')),
	CONSTRAINT "competence_autonomy_check" CHECK ("agent_competence"."autonomy_level" IN ('supervised', 'semi_auto', 'auto')),
	CONSTRAINT "competence_runs_check" CHECK ("agent_competence"."successful_runs" + "agent_competence"."failed_runs" <= "agent_competence"."total_runs"),
	CONSTRAINT "competence_quality_check" CHECK ("agent_competence"."avg_quality_score" >= 0 AND "agent_competence"."avg_quality_score" <= 1)
);
--> statement-breakpoint
CREATE TABLE "agent_config_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"before_config" jsonb NOT NULL,
	"after_config" jsonb NOT NULL,
	"changed_keys" text[] NOT NULL,
	"source" text DEFAULT 'patch' NOT NULL,
	"rolled_back_from_revision_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_runtime_state" (
	"agent_id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"session_id" text,
	"state_json" jsonb,
	"last_run_id" uuid,
	"last_run_status" text,
	"container_id" text,
	"container_status" text,
	"cumulative_tokens" bigint DEFAULT 0 NOT NULL,
	"cumulative_cost_cents" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"title" text,
	"role" text NOT NULL,
	"icon" text,
	"status" text DEFAULT 'idle' NOT NULL,
	"reports_to" uuid,
	"capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"permissions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"adapter_type" text NOT NULL,
	"adapter_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"model_tier" text DEFAULT 'smart' NOT NULL,
	"model_override" text,
	"budget_monthly_cents" bigint DEFAULT 0 NOT NULL,
	"spent_monthly_cents" bigint DEFAULT 0 NOT NULL,
	"system_prompt" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agents_company_name" UNIQUE("company_id","name"),
	CONSTRAINT "agents_status_check" CHECK ("agents"."status" IN ('idle', 'running', 'paused', 'error', 'terminated')),
	CONSTRAINT "agents_role_check" CHECK ("agents"."role" IN ('ceo', 'cto', 'engineer', 'analyst', 'researcher', 'writer', 'designer', 'marketer', 'support')),
	CONSTRAINT "agents_model_tier_check" CHECK ("agents"."model_tier" IN ('frontier', 'smart', 'fast', 'lightweight')),
	CONSTRAINT "agents_adapter_type_check" CHECK ("agents"."adapter_type" IN ('claude_code', 'process', 'http')),
	CONSTRAINT "agents_budget_check" CHECK ("agents"."budget_monthly_cents" >= 0),
	CONSTRAINT "agents_spent_check" CHECK ("agents"."spent_monthly_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by_agent_id" uuid,
	"payload" jsonb NOT NULL,
	"decided_by_user_id" text,
	"decided_by_agent_id" uuid,
	"decision_note" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approvals_type_check" CHECK ("approvals"."type" IN ('hire_agent', 'strategy', 'purchase', 'publish', 'budget_increase')),
	CONSTRAINT "approvals_status_check" CHECK ("approvals"."status" IN ('pending', 'approved', 'rejected', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"issue_prefix" text NOT NULL,
	"issue_counter" integer DEFAULT 0 NOT NULL,
	"budget_monthly_cents" bigint DEFAULT 0 NOT NULL,
	"spent_monthly_cents" bigint DEFAULT 0 NOT NULL,
	"require_board_approval" boolean DEFAULT true NOT NULL,
	"mission_goal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_status_check" CHECK ("companies"."status" IN ('active', 'paused', 'archived')),
	CONSTRAINT "companies_budget_check" CHECK ("companies"."budget_monthly_cents" >= 0),
	CONSTRAINT "companies_spent_check" CHECK ("companies"."spent_monthly_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "cost_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"issue_id" uuid,
	"project_id" uuid,
	"goal_id" uuid,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"billing_code" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cost_events_cost_check" CHECK ("cost_events"."cost_cents" >= 0),
	CONSTRAINT "cost_events_input_tokens_check" CHECK ("cost_events"."input_tokens" >= 0),
	CONSTRAINT "cost_events_output_tokens_check" CHECK ("cost_events"."output_tokens" >= 0)
);
--> statement-breakpoint
CREATE TABLE "facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"fact_type" text NOT NULL,
	"subject" text NOT NULL,
	"predicate" text NOT NULL,
	"object" text NOT NULL,
	"confidence" double precision DEFAULT 0.8 NOT NULL,
	"source_run_id" uuid,
	"source_issue_id" uuid,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"invalidated_at" timestamp with time zone,
	"embedding" vector(1536),
	"embedding_model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "facts_type_check" CHECK ("facts"."fact_type" IN ('decision', 'entity', 'relationship', 'observation')),
	CONSTRAINT "facts_confidence_check" CHECK ("facts"."confidence" >= 0 AND "facts"."confidence" <= 1)
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"parent_id" uuid,
	"level" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"owner_agent_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goals_level_check" CHECK ("goals"."level" IN ('company', 'team', 'agent', 'task')),
	CONSTRAINT "goals_status_check" CHECK ("goals"."status" IN ('active', 'completed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "heartbeat_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"invocation_source" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"context_snapshot" jsonb,
	"usage_json" jsonb,
	"result_json" jsonb,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "heartbeat_runs_status_check" CHECK ("heartbeat_runs"."status" IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'timed_out')),
	CONSTRAINT "heartbeat_runs_source_check" CHECK ("heartbeat_runs"."invocation_source" IN ('scheduled', 'assigned', 'mentioned', 'manual', 'event'))
);
--> statement-breakpoint
CREATE TABLE "issue_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"author_agent_id" uuid,
	"author_user_id" text,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid,
	"goal_id" uuid,
	"parent_id" uuid,
	"issue_number" integer NOT NULL,
	"identifier" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'backlog' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"assignee_agent_id" uuid,
	"checkout_run_id" uuid,
	"execution_locked_at" timestamp with time zone,
	"lock_timeout_at" timestamp with time zone,
	"required_capabilities" jsonb,
	"billing_code" text,
	"request_depth" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"reopened_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issues_company_number" UNIQUE("company_id","issue_number"),
	CONSTRAINT "issues_company_identifier" UNIQUE("company_id","identifier"),
	CONSTRAINT "issues_status_check" CHECK ("issues"."status" IN ('backlog', 'todo', 'in_progress', 'in_review', 'done', 'cancelled')),
	CONSTRAINT "issues_priority_check" CHECK ("issues"."priority" IN ('critical', 'high', 'medium', 'low')),
	CONSTRAINT "issues_request_depth_check" CHECK ("issues"."request_depth" >= 0)
);
--> statement-breakpoint
CREATE TABLE "lessons_learned" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"run_id" uuid,
	"issue_id" uuid,
	"task_type" text NOT NULL,
	"approach" text NOT NULL,
	"what_worked" text,
	"what_failed" text,
	"lesson" text NOT NULL,
	"outcome" text NOT NULL,
	"confidence" double precision DEFAULT 0.5 NOT NULL,
	"embedding" vector(1536),
	"embedding_model" text,
	"times_retrieved" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lessons_outcome_check" CHECK ("lessons_learned"."outcome" IN ('success', 'partial_success', 'failure')),
	CONSTRAINT "lessons_confidence_check" CHECK ("lessons_learned"."confidence" >= 0 AND "lessons_learned"."confidence" <= 1)
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"goal_id" uuid,
	"lead_agent_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"target_date" date,
	"color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_role" text NOT NULL,
	"prompt_type" text NOT NULL,
	"version" integer NOT NULL,
	"content" text NOT NULL,
	"evaluation_score" double precision,
	"is_active" boolean DEFAULT false NOT NULL,
	"parent_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prompt_versions_type_check" CHECK ("prompt_versions"."prompt_type" IN ('heartbeat', 'system', 'skill'))
);
--> statement-breakpoint
CREATE TABLE "quality_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"issue_id" uuid,
	"run_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"rubric_id" uuid,
	"evaluator_type" text NOT NULL,
	"evaluator_agent_id" uuid,
	"scores" jsonb NOT NULL,
	"overall_score" double precision NOT NULL,
	"passed" boolean NOT NULL,
	"feedback" text,
	"revision_number" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quality_evals_evaluator_check" CHECK ("quality_evaluations"."evaluator_type" IN ('self', 'peer', 'judge', 'deterministic')),
	CONSTRAINT "quality_evals_score_check" CHECK ("quality_evaluations"."overall_score" >= 0 AND "quality_evaluations"."overall_score" <= 1),
	CONSTRAINT "quality_evals_revision_check" CHECK ("quality_evaluations"."revision_number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "quality_rubrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"role" text,
	"task_type" text,
	"criteria" jsonb NOT NULL,
	"judge_model" text DEFAULT 'claude-sonnet-4-20250514' NOT NULL,
	"judge_prompt" text NOT NULL,
	"min_improvement_threshold" double precision DEFAULT 0.1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quality_rubrics_company_name" UNIQUE("company_id","name")
);
--> statement-breakpoint
CREATE TABLE "shared_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"content" text NOT NULL,
	"content_type" text NOT NULL,
	"content_hash" text NOT NULL,
	"embedding" vector(1536),
	"embedding_model" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shared_embeddings_hash" UNIQUE("company_id","content_hash"),
	CONSTRAINT "shared_embeddings_type_check" CHECK ("shared_embeddings"."content_type" IN ('lesson', 'fact', 'document', 'code'))
);
--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_competence" ADD CONSTRAINT "agent_competence_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_competence" ADD CONSTRAINT "agent_competence_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_config_revisions" ADD CONSTRAINT "agent_config_revisions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_config_revisions" ADD CONSTRAINT "agent_config_revisions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runtime_state" ADD CONSTRAINT "agent_runtime_state_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runtime_state" ADD CONSTRAINT "agent_runtime_state_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runtime_state" ADD CONSTRAINT "agent_runtime_state_last_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("last_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_reports_to_agents_id_fk" FOREIGN KEY ("reports_to") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_requested_by_agent_id_agents_id_fk" FOREIGN KEY ("requested_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_decided_by_agent_id_agents_id_fk" FOREIGN KEY ("decided_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_events" ADD CONSTRAINT "cost_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_events" ADD CONSTRAINT "cost_events_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_events" ADD CONSTRAINT "cost_events_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_events" ADD CONSTRAINT "cost_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_events" ADD CONSTRAINT "cost_events_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_source_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("source_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_source_issue_id_issues_id_fk" FOREIGN KEY ("source_issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_parent_id_goals_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."goals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_owner_agent_id_agents_id_fk" FOREIGN KEY ("owner_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heartbeat_runs" ADD CONSTRAINT "heartbeat_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heartbeat_runs" ADD CONSTRAINT "heartbeat_runs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_comments" ADD CONSTRAINT "issue_comments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_comments" ADD CONSTRAINT "issue_comments_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_comments" ADD CONSTRAINT "issue_comments_author_agent_id_agents_id_fk" FOREIGN KEY ("author_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_parent_id_issues_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_assignee_agent_id_agents_id_fk" FOREIGN KEY ("assignee_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons_learned" ADD CONSTRAINT "lessons_learned_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons_learned" ADD CONSTRAINT "lessons_learned_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons_learned" ADD CONSTRAINT "lessons_learned_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons_learned" ADD CONSTRAINT "lessons_learned_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_lead_agent_id_agents_id_fk" FOREIGN KEY ("lead_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_versions" ADD CONSTRAINT "prompt_versions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_evaluations" ADD CONSTRAINT "quality_evaluations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_evaluations" ADD CONSTRAINT "quality_evaluations_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_evaluations" ADD CONSTRAINT "quality_evaluations_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_evaluations" ADD CONSTRAINT "quality_evaluations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_evaluations" ADD CONSTRAINT "quality_evaluations_rubric_id_quality_rubrics_id_fk" FOREIGN KEY ("rubric_id") REFERENCES "public"."quality_rubrics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_evaluations" ADD CONSTRAINT "quality_evaluations_evaluator_agent_id_agents_id_fk" FOREIGN KEY ("evaluator_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_rubrics" ADD CONSTRAINT "quality_rubrics_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_embeddings" ADD CONSTRAINT "shared_embeddings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_embeddings" ADD CONSTRAINT "shared_embeddings_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_activity_log_company" ON "activity_log" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_competence_agent" ON "agent_competence" USING btree ("company_id","agent_id");--> statement-breakpoint
CREATE INDEX "idx_agents_company" ON "agents" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_agents_reports_to" ON "agents" USING btree ("reports_to");--> statement-breakpoint
CREATE INDEX "idx_cost_events_agent" ON "cost_events" USING btree ("company_id","agent_id");--> statement-breakpoint
CREATE INDEX "idx_cost_events_time" ON "cost_events" USING btree ("company_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_facts_company" ON "facts" USING btree ("company_id","fact_type");--> statement-breakpoint
CREATE INDEX "idx_goals_parent" ON "goals" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "idx_heartbeat_runs_agent" ON "heartbeat_runs" USING btree ("company_id","agent_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_issue_comments_issue" ON "issue_comments" USING btree ("issue_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_issues_company_status" ON "issues" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "idx_issues_assignee" ON "issues" USING btree ("assignee_agent_id");--> statement-breakpoint
CREATE INDEX "idx_issues_project" ON "issues" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "idx_lessons_company_type" ON "lessons_learned" USING btree ("company_id","task_type");--> statement-breakpoint
CREATE INDEX "idx_quality_evals_agent" ON "quality_evaluations" USING btree ("company_id","agent_id");--> statement-breakpoint
CREATE INDEX "idx_quality_evals_issue" ON "quality_evaluations" USING btree ("issue_id","created_at");