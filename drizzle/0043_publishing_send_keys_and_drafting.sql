-- Publishing (Oct 2026): a new Ayrshare idempotency key when a person resends a failed post,
-- and the AI drafting model and prompts each org can edit in Publish settings.
-- Also applied on first use by src/lib/publishing/store.ts; idempotent.
ALTER TABLE publish_deliveries ADD COLUMN IF NOT EXISTS send_key_gen integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE publish_settings ADD COLUMN IF NOT EXISTS draft_model text;
--> statement-breakpoint
ALTER TABLE publish_settings ADD COLUMN IF NOT EXISTS draft_prompts jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint
ALTER TABLE publish_settings ADD COLUMN IF NOT EXISTS draft_updated_by text;
--> statement-breakpoint
ALTER TABLE publish_settings ADD COLUMN IF NOT EXISTS draft_updated_at timestamptz;
