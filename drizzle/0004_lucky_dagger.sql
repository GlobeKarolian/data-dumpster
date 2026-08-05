CREATE TABLE "refresh_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"landscape_id" uuid NOT NULL,
	"requested_by_user_id" uuid,
	"idempotency_key" text NOT NULL,
	"scope_key" text NOT NULL,
	"platforms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"channel_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required_since" timestamp with time zone NOT NULL,
	"required_until" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"total_profiles" integer DEFAULT 0 NOT NULL,
	"worker_lease_token" uuid,
	"worker_lease_until" timestamp with time zone,
	"last_error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_jobs_status_ck" CHECK ("refresh_jobs"."status" IN ('queued', 'running', 'completed', 'completed_with_issues', 'failed')),
	CONSTRAINT "refresh_jobs_window_ck" CHECK ("refresh_jobs"."required_since" <= "refresh_jobs"."required_until"),
	CONSTRAINT "refresh_jobs_total_profiles_ck" CHECK ("refresh_jobs"."total_profiles" >= 0)
);
--> statement-breakpoint
ALTER TABLE "refresh_jobs" ADD CONSTRAINT "refresh_jobs_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_jobs" ADD CONSTRAINT "refresh_jobs_landscape_id_landscapes_id_fk" FOREIGN KEY ("landscape_id") REFERENCES "public"."landscapes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_jobs" ADD CONSTRAINT "refresh_jobs_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "refresh_jobs_org_idempotency_uq" ON "refresh_jobs" USING btree ("org_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "refresh_jobs_active_scope_uq" ON "refresh_jobs" USING btree ("org_id","scope_key") WHERE "refresh_jobs"."status" IN ('queued', 'running');--> statement-breakpoint
CREATE INDEX "refresh_jobs_landscape_time_idx" ON "refresh_jobs" USING btree ("org_id","landscape_id","created_at");