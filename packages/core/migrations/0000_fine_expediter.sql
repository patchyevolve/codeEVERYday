CREATE TYPE "public"."attempt_status" AS ENUM('SUCCESS', 'FAILURE');--> statement-breakpoint
CREATE TYPE "public"."concept_state" AS ENUM('NOT_STARTED', 'LEARNING', 'PRACTICING', 'WEAK', 'PROFICIENT', 'MASTERED', 'DECAYING', 'REVIEW_REQUIRED');--> statement-breakpoint
CREATE TYPE "public"."content_kind" AS ENUM('LESSON', 'CODING', 'DEBUGGING', 'CONCEPTUAL', 'TRACING', 'PREDICTION', 'ASSESSMENT', 'REAL_WORLD', 'PROJECT');--> statement-breakpoint
CREATE TYPE "public"."content_source" AS ENUM('PROVIDER_SEED', 'AI_GENERATED', 'AI_ADAPTED', 'TEMPLATE', 'USER_REQUESTED');--> statement-breakpoint
CREATE TYPE "public"."content_status" AS ENUM('DRAFT', 'VALIDATED', 'RETIRED');--> statement-breakpoint
CREATE TYPE "public"."edge_kind" AS ENUM('PREREQUISITE', 'RELATED');--> statement-breakpoint
CREATE TYPE "public"."mistake_severity" AS ENUM('LOW', 'MEDIUM', 'HIGH');--> statement-breakpoint
CREATE TYPE "public"."node_source" AS ENUM('PROVIDER_SEED', 'AI_GENERATED', 'USER_REQUESTED');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('IN_APP', 'EMAIL', 'DESKTOP', 'WEBHOOK');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('QUEUED', 'SENT', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('SESSION_AVAILABLE', 'REMINDER', 'STRONG_REMINDER', 'FINAL_REMINDER', 'MISSED_DAY', 'RECOVERY_SCHEDULED', 'ACHIEVEMENT', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."path_status" AS ENUM('PLANNED', 'ACTIVE', 'COMPLETED', 'BLOCKED');--> statement-breakpoint
CREATE TYPE "public"."session_kind" AS ENUM('REGULAR', 'RECOVERY', 'REVIEW', 'EXPLORATION');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('SCHEDULED', 'AVAILABLE', 'STARTED', 'IN_PROGRESS', 'COMPLETED', 'PARTIALLY_COMPLETED', 'MISSED', 'EXCUSED');--> statement-breakpoint
CREATE TYPE "public"."submission_status" AS ENUM('PENDING', 'RUNNING', 'PASS', 'FAIL', 'COMPILE_ERROR', 'TIMEOUT', 'RUNTIME_ERROR', 'EXECUTOR_ERROR');--> statement-breakpoint
CREATE TYPE "public"."task_kind" AS ENUM('REVIEW', 'LEARN', 'PRACTICE', 'ASSESS', 'PROJECT');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('PENDING', 'DONE', 'SKIPPED');--> statement-breakpoint
CREATE TABLE "achievements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"earned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "achievements_user_code" UNIQUE("user_id","code")
);
--> statement-breakpoint
CREATE TABLE "content_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"kind" "content_kind" NOT NULL,
	"title" text NOT NULL,
	"prompt_md" text,
	"difficulty" integer DEFAULT 1 NOT NULL,
	"est_minutes" integer DEFAULT 10 NOT NULL,
	"payload" jsonb NOT NULL,
	"source" "content_source" DEFAULT 'TEMPLATE' NOT NULL,
	"status" "content_status" DEFAULT 'DRAFT' NOT NULL,
	"validation" jsonb DEFAULT 'null'::jsonb,
	"generated_by" text,
	"version" integer DEFAULT 1 NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"quality_score" real DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_completions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"criteria" jsonb,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"kind" "session_kind" DEFAULT 'REGULAR' NOT NULL,
	"status" "session_status" DEFAULT 'SCHEDULED' NOT NULL,
	"decision" jsonb,
	"planned_minutes" integer DEFAULT 45 NOT NULL,
	"due_at" timestamp with time zone,
	"deadline_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"source_session_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_sessions_user_date_kind" UNIQUE("user_id","local_date","kind")
);
--> statement-breakpoint
CREATE TABLE "daily_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"kind" "task_kind" DEFAULT 'PRACTICE' NOT NULL,
	"content_item_id" uuid NOT NULL,
	"title" text NOT NULL,
	"est_minutes" integer DEFAULT 10 NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"status" "task_status" DEFAULT 'PENDING' NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domain_edges" (
	"from_id" uuid NOT NULL,
	"to_id" uuid NOT NULL,
	"kind" "edge_kind" NOT NULL,
	CONSTRAINT "domain_edges_from_id_to_id_kind_pk" PRIMARY KEY("from_id","to_id","kind")
);
--> statement-breakpoint
CREATE TABLE "domain_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"language_key" text NOT NULL,
	"node_key" text NOT NULL,
	"label" text NOT NULL,
	"definition" text NOT NULL,
	"difficulty" integer DEFAULT 1 NOT NULL,
	"est_minutes" integer DEFAULT 30 NOT NULL,
	"depth" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'MODELED' NOT NULL,
	"source" "node_source" DEFAULT 'AI_GENERATED' NOT NULL,
	"applications" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"misconceptions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "domain_nodes_lang_key" UNIQUE("language_key","node_key")
);
--> statement-breakpoint
CREATE TABLE "executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"sandbox" jsonb,
	"status" "submission_status" DEFAULT 'PENDING' NOT NULL,
	"summary" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "languages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "languages_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "mistakes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"content_item_id" uuid,
	"submission_id" uuid,
	"pattern" text NOT NULL,
	"severity" "mistake_severity" DEFAULT 'MEDIUM' NOT NULL,
	"description" text,
	"first_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_at" timestamp with time zone DEFAULT now() NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "mistakes_user_node_pattern" UNIQUE("user_id","node_id","pattern")
);
--> statement-breakpoint
CREATE TABLE "notification_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notification_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"status" "attempt_status" NOT NULL,
	"error" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"unique_key" text NOT NULL,
	"subject" text NOT NULL,
	"body" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "notification_status" DEFAULT 'QUEUED' NOT NULL,
	"scheduled_for" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_unique_key_unique" UNIQUE("unique_key")
);
--> statement-breakpoint
CREATE TABLE "progress_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "progress_snapshots_user_date" UNIQUE("user_id","date")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "streaks" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"current_length" integer DEFAULT 0 NOT NULL,
	"longest_length" integer DEFAULT 0 NOT NULL,
	"current_start" date,
	"last_completed_date" date,
	"broken_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"content_item_id" uuid NOT NULL,
	"session_id" uuid,
	"task_id" uuid,
	"kind" "content_kind" NOT NULL,
	"code" text,
	"answer" jsonb,
	"language" text DEFAULT 'cpp' NOT NULL,
	"status" "submission_status" DEFAULT 'PENDING' NOT NULL,
	"score" real,
	"results" jsonb,
	"hints_used" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_concept_state" (
	"user_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"state" "concept_state" DEFAULT 'NOT_STARTED' NOT NULL,
	"mastery" real DEFAULT 0 NOT NULL,
	"recall_strength" real DEFAULT 0 NOT NULL,
	"consecutive_success" integer DEFAULT 0 NOT NULL,
	"consecutive_fail" integer DEFAULT 0 NOT NULL,
	"total_attempts" integer DEFAULT 0 NOT NULL,
	"last_practiced_at" timestamp with time zone,
	"next_review_at" timestamp with time zone,
	"review_interval_days" integer DEFAULT 1 NOT NULL,
	"review_ease" real DEFAULT 2.5 NOT NULL,
	"review_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_concept_state_user_id_node_id_pk" PRIMARY KEY("user_id","node_id")
);
--> statement-breakpoint
CREATE TABLE "user_learning_path" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"status" "path_status" DEFAULT 'PLANNED' NOT NULL,
	"reason" text,
	"entered_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ulp_user_node" UNIQUE("user_id","node_id")
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"language_key" text DEFAULT 'cpp' NOT NULL,
	"track" text DEFAULT 'programming' NOT NULL,
	"experience_level" integer DEFAULT 0 NOT NULL,
	"difficulty_pref" integer DEFAULT 2 NOT NULL,
	"daily_minutes" integer DEFAULT 45 NOT NULL,
	"start_time_local" text DEFAULT '09:00' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"quiet_hours" jsonb DEFAULT '{"start":"22:00","end":"08:00"}'::jsonb,
	"weekly_schedule" jsonb DEFAULT 'null'::jsonb,
	"rest_days" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notification_channels" jsonb DEFAULT '["IN_APP"]'::jsonb NOT NULL,
	"escalation" jsonb DEFAULT '{"enabled":true,"stepsMinutes":[30,90,180],"strongAt":360,"windowEnd":"21:00"}'::jsonb NOT NULL,
	"recovery_policy" jsonb DEFAULT '{"enabled":true,"maxBacklog":3}'::jsonb NOT NULL,
	"accountability_policy" jsonb DEFAULT '{"mode":"soft","xpPenalty":true,"streakReset":true,"recoveryReviewBonus":10,"commitmentPerMiss":0,"commitmentPool":0,"currency":"INR"}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"total_xp" integer DEFAULT 0 NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "xp_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"reason" text NOT NULL,
	"ref_type" text,
	"ref_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "achievements" ADD CONSTRAINT "achievements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_node_id_domain_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."domain_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_completions" ADD CONSTRAINT "daily_completions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_completions" ADD CONSTRAINT "daily_completions_session_id_daily_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."daily_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_sessions" ADD CONSTRAINT "daily_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_sessions" ADD CONSTRAINT "daily_sessions_source_session_id_daily_sessions_id_fk" FOREIGN KEY ("source_session_id") REFERENCES "public"."daily_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_tasks" ADD CONSTRAINT "daily_tasks_session_id_daily_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."daily_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_tasks" ADD CONSTRAINT "daily_tasks_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_edges" ADD CONSTRAINT "domain_edges_from_id_domain_nodes_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."domain_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_edges" ADD CONSTRAINT "domain_edges_to_id_domain_nodes_id_fk" FOREIGN KEY ("to_id") REFERENCES "public"."domain_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mistakes" ADD CONSTRAINT "mistakes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mistakes" ADD CONSTRAINT "mistakes_node_id_domain_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."domain_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mistakes" ADD CONSTRAINT "mistakes_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mistakes" ADD CONSTRAINT "mistakes_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_attempts" ADD CONSTRAINT "notification_attempts_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_snapshots" ADD CONSTRAINT "progress_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "streaks" ADD CONSTRAINT "streaks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_session_id_daily_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."daily_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_task_id_daily_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."daily_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_concept_state" ADD CONSTRAINT "user_concept_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_concept_state" ADD CONSTRAINT "user_concept_state_node_id_domain_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."domain_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_learning_path" ADD CONSTRAINT "user_learning_path_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_learning_path" ADD CONSTRAINT "user_learning_path_node_id_domain_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."domain_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xp_ledger" ADD CONSTRAINT "xp_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_items_node_kind_idx" ON "content_items" USING btree ("node_id","kind");--> statement-breakpoint
CREATE INDEX "content_items_status_idx" ON "content_items" USING btree ("status");--> statement-breakpoint
CREATE INDEX "daily_sessions_user_status_idx" ON "daily_sessions" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "daily_sessions_due_idx" ON "daily_sessions" USING btree ("due_at");--> statement-breakpoint
CREATE INDEX "daily_tasks_session_idx" ON "daily_tasks" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "daily_tasks_status_idx" ON "daily_tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "domain_nodes_lang_idx" ON "domain_nodes" USING btree ("language_key");--> statement-breakpoint
CREATE INDEX "mistakes_active_idx" ON "mistakes" USING btree ("user_id","active");--> statement-breakpoint
CREATE INDEX "notifications_status_scheduled_idx" ON "notifications" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "submissions_user_created_idx" ON "submissions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ucs_user_next_review_idx" ON "user_concept_state" USING btree ("user_id","next_review_at");--> statement-breakpoint
CREATE INDEX "ucs_user_state_idx" ON "user_concept_state" USING btree ("user_id","state");--> statement-breakpoint
CREATE INDEX "ulp_user_pos_idx" ON "user_learning_path" USING btree ("user_id","position");--> statement-breakpoint
CREATE INDEX "xp_ledger_user_created_idx" ON "xp_ledger" USING btree ("user_id","created_at");