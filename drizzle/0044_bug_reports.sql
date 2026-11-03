-- Bug reports (Nov 2026). Also created on first use by src/lib/bugs/store.ts;
-- every statement is idempotent so either path is safe.
CREATE TABLE IF NOT EXISTS bug_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number bigserial UNIQUE,
  org_id uuid NOT NULL,
  reported_by uuid,
  reporter_email text,
  description text NOT NULL,
  expected text,
  page_url text,
  landscape_id uuid,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'new',
  area text,
  severity text,
  triage jsonb,
  diagnostics jsonb,
  duplicate_of uuid,
  resolution_note text,
  triaged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS bug_reports_org_status_idx ON bug_reports (org_id, status, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS bug_reports_org_created_idx ON bug_reports (org_id, created_at DESC);
