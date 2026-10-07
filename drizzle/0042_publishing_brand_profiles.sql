-- Publishing (Oct 2026): one Ayrshare profile per brand for account onboarding.
-- Also created on first use by src/lib/publishing/store.ts; idempotent.
CREATE TABLE IF NOT EXISTS publish_brand_profiles (
  org_id uuid NOT NULL,
  brand text NOT NULL,
  provider text NOT NULL DEFAULT 'ayrshare',
  profile_key_enc text NOT NULL,
  ref_id text,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, brand)
);
