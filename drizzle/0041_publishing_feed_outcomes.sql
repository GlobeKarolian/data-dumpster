-- Publishing (Oct 2026): record what Autopilot did with each story it saw.
-- Also created on first use by src/lib/publishing/store.ts; idempotent.
ALTER TABLE publish_feed_items ADD COLUMN IF NOT EXISTS title text;
--> statement-breakpoint
ALTER TABLE publish_feed_items ADD COLUMN IF NOT EXISTS link text;
--> statement-breakpoint
ALTER TABLE publish_feed_items ADD COLUMN IF NOT EXISTS outcome text;
