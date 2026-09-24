-- Article Leakage saved runs (23-24 Sep 2026). Also created on first use by
-- src/lib/leakage/store.ts; every statement is idempotent so either path is safe.
CREATE TABLE IF NOT EXISTS leakage_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_by uuid,
  story_key text NOT NULL,
  story_url text NOT NULL,
  terms text[] NOT NULL DEFAULT '{}',
  window_label text NOT NULL,
  summary jsonb NOT NULL,
  queries jsonb NOT NULL,
  accounts jsonb NOT NULL,
  posts jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS leakage_runs_org_created_idx ON leakage_runs (org_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS leakage_runs_org_story_idx ON leakage_runs (org_id, story_key, created_at DESC);
