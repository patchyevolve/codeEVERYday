DROP INDEX "ai_requests_user_idx";--> statement-breakpoint
DROP INDEX "ai_requests_task_type_idx";--> statement-breakpoint
DROP INDEX "ai_requests_status_idx";--> statement-breakpoint
DROP INDEX "ai_requests_created_idx";--> statement-breakpoint
DROP INDEX "daily_completions_user_idx";--> statement-breakpoint
DROP INDEX "submissions_status_idx";--> statement-breakpoint
CREATE INDEX "ai_jobs_status_started_idx" ON "ai_jobs" USING btree ("status","started_at");--> statement-breakpoint
CREATE INDEX "ai_jobs_status_completed_idx" ON "ai_jobs" USING btree ("status","completed_at");--> statement-breakpoint
CREATE INDEX "ai_requests_user_created_idx" ON "ai_requests" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_requests_status_created_idx" ON "ai_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "daily_sessions_status_deadline_idx" ON "daily_sessions" USING btree ("status","deadline_at");--> statement-breakpoint
CREATE INDEX "domain_nodes_node_key_idx" ON "domain_nodes" USING btree ("node_key");--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "user_goals_user_status_idx" ON "user_goals" USING btree ("user_id","status");