CREATE TABLE "public_channel_source_state" (
	"channel_id" uuid NOT NULL,
	"source_key" text NOT NULL,
	"cursor" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_ingested_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "public_channel_source_state_pk" PRIMARY KEY("channel_id","source_key"),
	CONSTRAINT "public_channel_source_state_source_key_ck" CHECK (btrim("public_channel_source_state"."source_key") <> '')
);
--> statement-breakpoint
ALTER TABLE "public_channel_source_state" ADD CONSTRAINT "public_channel_source_state_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Backfill only platforms whose pooled public source cannot switch. Vendor
-- cursors are migrated lazily by the runner immediately before its first
-- source call. This avoids freezing a stale vendor cursor between this
-- migration and the matching code deployment while preserving legacy reads.
WITH legacy_source_state AS (
	SELECT
		"id" AS "channel_id",
		CASE
			WHEN "platform" = 'bluesky'::platform
				AND coalesce(lower(nullif(btrim("cursor"->>'source'), '')), '')
					IN ('', 'bluesky', 'bluesky-public-appview')
				THEN 'bluesky-public-appview'
			WHEN "platform" = 'youtube'::platform
				AND coalesce(lower(nullif(btrim("cursor"->>'source'), '')), '')
					IN ('', 'youtube', 'youtube-data-api-v3')
				THEN 'youtube-data-api-v3'
			WHEN "platform" = 'reddit'::platform
				AND coalesce(lower(nullif(btrim("cursor"->>'source'), '')), '')
					IN ('', 'ensembledata')
				THEN 'ensembledata'
		END AS "source_key",
		"cursor" - '__isOwned' AS "cursor",
		"last_ingested_at"
	FROM "channels"
)
INSERT INTO "public_channel_source_state" (
	"channel_id",
	"source_key",
	"cursor",
	"last_ingested_at",
	"last_success_at"
)
SELECT
	"channel_id",
	"source_key",
	"cursor",
	"last_ingested_at",
	"last_ingested_at"
FROM legacy_source_state
WHERE "source_key" IS NOT NULL
ON CONFLICT ("channel_id", "source_key") DO NOTHING;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ingestion_runs_channel_started_idx" ON "ingestion_runs" USING btree ("channel_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "post_metric_snapshots_captured_idx" ON "post_metric_snapshots" USING btree ("captured_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "posted_urls_post_idx" ON "posted_urls" USING btree ("post_id");
