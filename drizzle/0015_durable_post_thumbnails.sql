-- Preserve post posters independently of expiring social-network CDN URLs.
-- The stored object remains private and is served only through the existing
-- workspace/report-capability preview route.
ALTER TABLE "posts" ADD COLUMN "archived_thumbnail_url" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "archived_thumbnail_content_type" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "archived_thumbnail_bytes" integer;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "archived_thumbnail_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "thumbnail_archive_attempted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "thumbnail_archive_error" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "thumbnail_archive_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "posts_thumbnail_archive_queue_idx" ON "posts" USING btree ("thumbnail_archive_attempted_at", "posted_at") WHERE "posts"."archived_thumbnail_url" IS NULL AND ("posts"."thumbnail_url" IS NOT NULL OR "posts"."permalink" IS NOT NULL);
