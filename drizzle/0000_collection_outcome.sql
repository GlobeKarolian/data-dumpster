-- The production database predates committed Drizzle migrations. This first
-- artifact is intentionally additive: its snapshot baselines the existing
-- schema while the SQL adds only the two collection-state fields introduced by
-- this change.
DO $$ BEGIN
  CREATE TYPE "public"."collection_outcome" AS ENUM(
    'certified_complete',
    'continuation',
    'terminal_source_limitation',
    'retryable_operational_failure',
    'permanent_failure'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER TABLE "channel_collection_state"
  ADD COLUMN IF NOT EXISTS "attempted_until" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "channel_collection_state"
  ADD COLUMN IF NOT EXISTS "outcome" "collection_outcome";
--> statement-breakpoint
-- The legacy adapter contract omitted completeness. Only the official Bluesky
-- and YouTube pagers had authoritative end-of-feed/window signals and durable
-- continuations, so only their settled coverage can be preserved. A green
-- legacy status from a capped/recent-feed vendor is not evidence.
UPDATE "channel_collection_state" AS state
   SET "attempted_until" = state."coverage_until",
       "outcome" = 'certified_complete'
  FROM "channels" AS channel
 WHERE channel."id" = state."channel_id"
   AND channel."platform" IN ('bluesky', 'youtube')
   AND state."status" = 'succeeded'
   AND NOT state."has_more";
--> statement-breakpoint
-- Retain the freshness watermark for every other settled legacy row, but clear
-- coverage that the old runtime could not prove. These sources keep refreshing
-- recent data without repeatedly buying the same historical window.
UPDATE "channel_collection_state" AS state
   SET "attempted_until" = coalesce(state."coverage_until", state."required_until"),
       "coverage_since" = NULL,
       "coverage_until" = NULL,
       "status" = 'partial',
       "outcome" = 'terminal_source_limitation',
       "next_attempt_at" = NULL,
       "lease_token" = NULL,
       "lease_until" = NULL,
       "has_more" = false,
       "last_error" = 'Legacy collection did not record proof that the requested window was exhaustive; historical coverage is unverified.'
  FROM "channels" AS channel
 WHERE channel."id" = state."channel_id"
   AND channel."platform" NOT IN ('bluesky', 'youtube')
   AND state."status" = 'succeeded'
   AND NOT state."has_more";
--> statement-breakpoint
UPDATE "channel_collection_state"
   SET "attempted_until" = "required_until",
       "outcome" = 'continuation'
 WHERE "status" = 'partial'
   AND "has_more";
--> statement-breakpoint
UPDATE "channel_collection_state"
   SET "outcome" = CASE
         WHEN "next_attempt_at" IS NULL THEN 'permanent_failure'::"collection_outcome"
         ELSE 'retryable_operational_failure'::"collection_outcome"
       END
 WHERE "status" = 'failed';
--> statement-breakpoint
-- EnsembleData's X endpoint is a Twitter-selected Highlights feed, not a
-- chronological timeline. Earlier code certified these rows anyway. Remove
-- that false coverage without affecting X API v2 or other configured sources.
UPDATE "channel_collection_state" AS state
   SET "attempted_until" = state."required_until",
       "coverage_since" = NULL,
       "coverage_until" = NULL,
       "status" = 'partial',
       "outcome" = 'terminal_source_limitation',
       "next_attempt_at" = NULL,
       "lease_token" = NULL,
       "lease_until" = NULL,
       "has_more" = false,
       "last_error" = 'X returned a selected Highlights feed rather than a chronological timeline; historical post coverage is unverified.'
  FROM "channels" AS channel
 WHERE channel."id" = state."channel_id"
   AND channel."platform" = 'twitter'
   AND channel."cursor" ->> 'source' = 'ensembledata';
--> statement-breakpoint
-- Settle only Facebook runs whose own latest audit row proves the vendor hit
-- its cursorless 200-post cap. Other Facebook failures retain their retry or
-- permanent-failure disposition.
WITH latest_facebook_run AS (
  SELECT DISTINCT ON (run."channel_id")
         run."channel_id",
         run."status",
         run."detail"
    FROM "ingestion_runs" AS run
    JOIN "channels" AS channel ON channel."id" = run."channel_id"
   WHERE channel."platform" = 'facebook'
   ORDER BY run."channel_id", run."started_at" DESC
)
UPDATE "channel_collection_state" AS state
   SET "attempted_until" = coalesce(
         nullif(latest."detail" ->> 'requestedUntil', '')::timestamptz,
         state."required_until"
       ),
       "coverage_since" = NULL,
       "coverage_until" = NULL,
       "status" = 'partial',
       "outcome" = 'terminal_source_limitation',
       "next_attempt_at" = NULL,
       "lease_token" = NULL,
       "lease_until" = NULL,
       "has_more" = false,
       "last_error" = 'Facebook reached its 200-post cap without a continuation cursor; historical post coverage is incomplete.'
  FROM latest_facebook_run AS latest
 WHERE latest."channel_id" = state."channel_id"
   AND latest."status" = 'partial'
   AND coalesce((latest."detail" ->> 'hasMore')::boolean, false) = false
   AND latest."detail"::text ILIKE '%200-post Facebook cap%';
