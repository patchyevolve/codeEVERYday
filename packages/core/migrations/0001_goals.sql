CREATE TYPE "public"."domain" AS ENUM('NETWORKING', 'CYBERSECURITY', 'LOW_LEVEL', 'AI_ENGINEERING', 'WEBDEV', 'SYSTEMS', 'GENERAL');--> statement-breakpoint
CREATE TYPE "public"."goal_status" AS ENUM('ACTIVE', 'PAUSED', 'COMPLETED', 'DROPPED');--> statement-breakpoint
CREATE TYPE "public"."milestone_status" AS ENUM('LOCKED', 'ACTIVE', 'COMPLETED', 'BLOCKED');--> statement-breakpoint
CREATE TABLE "ai_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_type" text NOT NULL,
	"priority" text DEFAULT 'P3' NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"payload" jsonb NOT NULL,
	"result" jsonb,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" text NOT NULL,
	"task_type" text NOT NULL,
	"priority" text NOT NULL,
	"user_id" uuid,
	"session_id" uuid,
	"job_id" text,
	"provider" text,
	"model" text,
	"prompt_version" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"latency_ms" integer,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"est_cost_usd" real DEFAULT 0 NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"fallback_chain" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"from_cache" boolean DEFAULT false NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "ai_requests_request_id_unique" UNIQUE("request_id")
);
--> statement-breakpoint
CREATE TABLE "content_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"review_type" text NOT NULL,
	"passed" boolean NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reviewer" text,
	"reviewer_model" text,
	"prompt_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid,
	"type" text NOT NULL,
	"concept" text,
	"result" text,
	"source" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goal_milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" uuid NOT NULL,
	"title" text NOT NULL,
	"definition" text NOT NULL,
	"node_id" uuid,
	"language_key" text,
	"position" integer DEFAULT 0 NOT NULL,
	"status" "milestone_status" DEFAULT 'LOCKED' NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learner_dimensions" (
	"user_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"dimension" text NOT NULL,
	"value" real DEFAULT 0 NOT NULL,
	"confidence" real DEFAULT 0 NOT NULL,
	"evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learner_dimensions_user_id_node_id_dimension_pk" PRIMARY KEY("user_id","node_id","dimension")
);
--> statement-breakpoint
CREATE TABLE "provider_state" (
	"provider_id" text PRIMARY KEY NOT NULL,
	"breaker_state" text DEFAULT 'CLOSED' NOT NULL,
	"breaker_opened_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_failure_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"requests_today" integer DEFAULT 0 NOT NULL,
	"tokens_today" integer DEFAULT 0 NOT NULL,
	"last_reset_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_reports_session_id_unique" UNIQUE("session_id")
);
--> statement-breakpoint
CREATE TABLE "tutor_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"observations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"hypotheses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"selected_hypothesis" uuid,
	"confidence" real DEFAULT 0.5 NOT NULL,
	"action" text NOT NULL,
	"expected_outcome" text,
	"actual_outcome" text,
	"verdict" text DEFAULT 'unknown' NOT NULL,
	"correction" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tutor_experience" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"concept" text NOT NULL,
	"learner_problem" text NOT NULL,
	"strategy" text NOT NULL,
	"outcome" text NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tutor_hypotheses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"statement" text NOT NULL,
	"confidence" real DEFAULT 0.5 NOT NULL,
	"supporting_evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"contradicting_evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"alternatives" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_evaluated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"domain" "domain" NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"horizon_days" integer DEFAULT 180 NOT NULL,
	"status" "goal_status" DEFAULT 'ACTIVE' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "daily_sessions" DROP CONSTRAINT "daily_sessions_source_session_id_daily_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "content_items" ALTER COLUMN "validation" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "user_preferences" ALTER COLUMN "quiet_hours" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "user_preferences" ALTER COLUMN "weekly_schedule" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "content_items" ADD COLUMN "superseded_by" uuid;--> statement-breakpoint
ALTER TABLE "daily_sessions" ADD COLUMN "current_phase" text;--> statement-breakpoint
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_session_id_daily_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."daily_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reviews" ADD CONSTRAINT "content_reviews_content_id_content_items_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_events" ADD CONSTRAINT "evidence_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_events" ADD CONSTRAINT "evidence_events_session_id_daily_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."daily_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_milestones" ADD CONSTRAINT "goal_milestones_goal_id_user_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."user_goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_milestones" ADD CONSTRAINT "goal_milestones_node_id_domain_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."domain_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learner_dimensions" ADD CONSTRAINT "learner_dimensions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learner_dimensions" ADD CONSTRAINT "learner_dimensions_node_id_domain_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."domain_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_reports" ADD CONSTRAINT "session_reports_session_id_daily_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."daily_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_reports" ADD CONSTRAINT "session_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_decisions" ADD CONSTRAINT "tutor_decisions_session_id_daily_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."daily_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_decisions" ADD CONSTRAINT "tutor_decisions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_decisions" ADD CONSTRAINT "tutor_decisions_selected_hypothesis_tutor_hypotheses_id_fk" FOREIGN KEY ("selected_hypothesis") REFERENCES "public"."tutor_hypotheses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_hypotheses" ADD CONSTRAINT "tutor_hypotheses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_goals" ADD CONSTRAINT "user_goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_jobs_status_idx" ON "ai_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ai_jobs_run_after_idx" ON "ai_jobs" USING btree ("run_after");--> statement-breakpoint
CREATE INDEX "ai_jobs_job_type_idx" ON "ai_jobs" USING btree ("job_type");--> statement-breakpoint
CREATE INDEX "ai_requests_user_idx" ON "ai_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ai_requests_task_type_idx" ON "ai_requests" USING btree ("task_type");--> statement-breakpoint
CREATE INDEX "ai_requests_status_idx" ON "ai_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ai_requests_created_idx" ON "ai_requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "content_reviews_content_idx" ON "content_reviews" USING btree ("content_id");--> statement-breakpoint
CREATE INDEX "evidence_events_user_idx" ON "evidence_events" USING btree ("user_id","observed_at");--> statement-breakpoint
CREATE INDEX "evidence_events_session_idx" ON "evidence_events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "evidence_events_concept_idx" ON "evidence_events" USING btree ("concept");--> statement-breakpoint
CREATE INDEX "goal_milestones_goal_idx" ON "goal_milestones" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "learner_dimensions_user_idx" ON "learner_dimensions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_reports_user_idx" ON "session_reports" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tutor_decisions_session_idx" ON "tutor_decisions" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "tutor_decisions_user_idx" ON "tutor_decisions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tutor_experience_concept_idx" ON "tutor_experience" USING btree ("concept");--> statement-breakpoint
CREATE INDEX "tutor_experience_strategy_idx" ON "tutor_experience" USING btree ("strategy");--> statement-breakpoint
CREATE INDEX "tutor_hypotheses_user_idx" ON "tutor_hypotheses" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tutor_hypotheses_status_idx" ON "tutor_hypotheses" USING btree ("status");--> statement-breakpoint
CREATE INDEX "user_goals_user_idx" ON "user_goals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "daily_completions_user_idx" ON "daily_completions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "executions_submission_idx" ON "executions" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "notification_attempts_notif_idx" ON "notification_attempts" USING btree ("notification_id");--> statement-breakpoint
CREATE INDEX "submissions_content_item_idx" ON "submissions" USING btree ("content_item_id");--> statement-breakpoint
CREATE INDEX "submissions_status_idx" ON "submissions" USING btree ("status");--> statement-breakpoint
ALTER TABLE "daily_completions" ADD CONSTRAINT "daily_completions_user_session" UNIQUE("user_id","session_id");