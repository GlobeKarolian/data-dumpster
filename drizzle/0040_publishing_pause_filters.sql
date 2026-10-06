-- Publishing (Oct 2026): emergency pause per org, and RSS feed filters.
-- Also created on first use by src/lib/publishing/store.ts; idempotent.
CREATE TABLE IF NOT EXISTS publish_settings (
  org_id uuid PRIMARY KEY,
  paused boolean NOT NULL DEFAULT false,
  paused_by text,
  paused_at timestamptz
);
--> statement-breakpoint
ALTER TABLE publish_feeds ADD COLUMN IF NOT EXISTS include_categories jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE publish_feeds ADD COLUMN IF NOT EXISTS exclude_keywords jsonb NOT NULL DEFAULT '[]'::jsonb;
