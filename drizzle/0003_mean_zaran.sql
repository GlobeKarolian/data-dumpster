ALTER TABLE "audience_snapshots" ADD COLUMN "source_run_id" uuid;--> statement-breakpoint
ALTER TABLE "audience_snapshots" ADD COLUMN "visibility" text;--> statement-breakpoint
ALTER TABLE "ingestion_runs" ADD COLUMN "source_key" text DEFAULT 'legacy-unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "ingestion_runs" ADD COLUMN "visibility" text DEFAULT 'legacy-unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "post_metric_snapshots" ADD COLUMN "source_run_id" uuid;--> statement-breakpoint
ALTER TABLE "post_metric_snapshots" ADD COLUMN "visibility" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "source_run_id" uuid;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "visibility" text;