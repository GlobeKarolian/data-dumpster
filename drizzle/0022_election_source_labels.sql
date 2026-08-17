-- Replay-safe as of 17 Aug 2026. This column is already present in production
-- but the migration ledger never recorded 0022, so the next `drizzle-kit
-- migrate` replays it. A bare ADD COLUMN would abort that run before it
-- reached any later migration. IF NOT EXISTS changes nothing on a fresh
-- database and makes the replay a no-op.
ALTER TABLE "election_profile_sources" ADD COLUMN IF NOT EXISTS "label" text;
