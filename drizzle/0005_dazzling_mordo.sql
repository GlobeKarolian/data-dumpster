ALTER TABLE "refresh_jobs" ADD COLUMN "request_fingerprint" text;--> statement-breakpoint
UPDATE "refresh_jobs" SET "request_fingerprint" = "scope_key" WHERE "request_fingerprint" IS NULL;--> statement-breakpoint
ALTER TABLE "refresh_jobs" ALTER COLUMN "request_fingerprint" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "refresh_jobs" ADD COLUMN "next_wake_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "refresh_jobs" ADD COLUMN "final_snapshot" jsonb;--> statement-breakpoint
CREATE INDEX "refresh_jobs_recovery_idx" ON "refresh_jobs" USING btree ("status","next_wake_at","created_at");
