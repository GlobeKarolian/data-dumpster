ALTER TABLE "channels" ADD COLUMN IF NOT EXISTS "identity_key" text;
--> statement-breakpoint
UPDATE "channels"
   SET "external_id" = nullif(btrim("external_id"), ''),
       "identity_key" = CASE
         WHEN "platform" = 'youtube'::platform
           AND regexp_replace(btrim("handle"), '^@', '') ~ '^UC[A-Za-z0-9_-]{22}$'
           THEN 'channel:' || regexp_replace(btrim("handle"), '^@', '')
         WHEN "platform" = 'reddit'::platform THEN
           CASE
             WHEN lower(regexp_replace(btrim("handle"), '^/+|/+$', '', 'g'))
               ~ '^(u|user)/.+$'
               THEN 'user:' || regexp_replace(
                 lower(regexp_replace(btrim("handle"), '^/+|/+$', '', 'g')),
                 '^(u|user)/', ''
               )
             WHEN lower(regexp_replace(btrim("handle"), '^/+|/+$', '', 'g')) ~ '^r/.+$'
               THEN 'subreddit:' || regexp_replace(
                 lower(regexp_replace(btrim("handle"), '^/+|/+$', '', 'g')),
                 '^r/', ''
               )
             ELSE 'subreddit:' || lower(
               regexp_replace(btrim("handle"), '^/+|/+$', '', 'g')
             )
           END
         WHEN "platform" = 'bluesky'::platform
           AND btrim("handle") ~* '^did:[^:]+:.+$'
           THEN 'did:' || lower(split_part(btrim("handle"), ':', 2))
             || ':' || substring(btrim("handle") from '^[^:]+:[^:]+:(.+)$')
         ELSE 'handle:' || lower(regexp_replace(btrim("handle"), '^@', ''))
       END;
--> statement-breakpoint
DO $$
DECLARE
  identity_conflicts jsonb;
  external_conflicts jsonb;
BEGIN
  SELECT jsonb_agg(conflict ORDER BY conflict->>'platform', conflict->>'identity')
    INTO identity_conflicts
    FROM (
      SELECT jsonb_build_object(
        'platform', channel.platform::text,
        'identity', channel.identity_key,
        'channels', jsonb_agg(jsonb_build_object(
          'channelId', channel.id,
          'companyId', channel.company_id,
          'companyName', company.name,
          'handle', channel.handle,
          'externalId', channel.external_id
        ) ORDER BY company.name, channel.id)
      ) AS conflict
      FROM channels channel
      JOIN companies company ON company.id = channel.company_id
     GROUP BY channel.platform, channel.identity_key
    HAVING count(*) > 1
    ) grouped;

  SELECT jsonb_agg(conflict ORDER BY conflict->>'platform', conflict->>'externalId')
    INTO external_conflicts
    FROM (
      SELECT jsonb_build_object(
        'platform', channel.platform::text,
        'externalId', channel.external_id,
        'channels', jsonb_agg(jsonb_build_object(
          'channelId', channel.id,
          'companyId', channel.company_id,
          'companyName', company.name,
          'handle', channel.handle
        ) ORDER BY company.name, channel.id)
      ) AS conflict
      FROM channels channel
      JOIN companies company ON company.id = channel.company_id
     WHERE channel.external_id IS NOT NULL
     GROUP BY channel.platform, channel.external_id
    HAVING count(*) > 1
    ) grouped;

  IF identity_conflicts IS NOT NULL OR external_conflicts IS NOT NULL THEN
    RAISE EXCEPTION 'Global channel identity migration blocked by duplicate pooled accounts'
      USING DETAIL = jsonb_build_object(
        'normalizedIdentityConflicts', coalesce(identity_conflicts, '[]'::jsonb),
        'externalIdConflicts', coalesce(external_conflicts, '[]'::jsonb)
      )::text,
      HINT = 'Run npm run db:audit-channel-identities, reconcile the listed channel histories, then retry the migration.';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "channels" ALTER COLUMN "identity_key" SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "channels_platform_identity_uq"
  ON "channels" USING btree ("platform", "identity_key");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "channels_platform_external_uq"
  ON "channels" USING btree ("platform", "external_id")
  WHERE "channels"."external_id" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "channels_id_company_uq"
  ON "channels" USING btree ("id", "company_id");
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "channels" ADD CONSTRAINT "channels_identity_key_ck" CHECK (
    "identity_key" = CASE
      WHEN "platform" = 'youtube'::platform
        AND regexp_replace(btrim("handle"), '^@', '') ~ '^UC[A-Za-z0-9_-]{22}$'
        THEN 'channel:' || regexp_replace(btrim("handle"), '^@', '')
      WHEN "platform" = 'reddit'::platform THEN
        CASE
          WHEN lower(regexp_replace(btrim("handle"), '^/+|/+$', '', 'g')) ~ '^(u|user)/.+$'
            THEN 'user:' || regexp_replace(
              lower(regexp_replace(btrim("handle"), '^/+|/+$', '', 'g')),
              '^(u|user)/', ''
            )
          WHEN lower(regexp_replace(btrim("handle"), '^/+|/+$', '', 'g')) ~ '^r/.+$'
            THEN 'subreddit:' || regexp_replace(
              lower(regexp_replace(btrim("handle"), '^/+|/+$', '', 'g')),
              '^r/', ''
            )
          ELSE 'subreddit:' || lower(
            regexp_replace(btrim("handle"), '^/+|/+$', '', 'g')
          )
        END
      WHEN "platform" = 'bluesky'::platform
        AND btrim("handle") ~* '^did:[^:]+:.+$'
        THEN 'did:' || lower(split_part(btrim("handle"), ':', 2))
          || ':' || substring(btrim("handle") from '^[^:]+:[^:]+:(.+)$')
      ELSE 'handle:' || lower(regexp_replace(btrim("handle"), '^@', ''))
    END
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DROP INDEX IF EXISTS "channels_platform_handle_uq";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "landscape_channel_demands" (
  "landscape_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "channel_id" uuid NOT NULL,
  "required_since" timestamp with time zone NOT NULL,
  "required_until" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "landscape_channel_demands_landscape_id_channel_id_pk"
    PRIMARY KEY("landscape_id", "channel_id"),
  CONSTRAINT "landscape_channel_demands_window_ck"
    CHECK ("required_since" <= "required_until")
);
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "landscape_channel_demands"
    ADD CONSTRAINT "landscape_channel_demands_channel_id_channels_id_fk"
    FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "landscape_channel_demands"
    ADD CONSTRAINT "landscape_channel_demands_membership_fk"
    FOREIGN KEY ("landscape_id", "company_id")
    REFERENCES "public"."landscape_companies"("landscape_id", "company_id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "landscape_channel_demands"
    ADD CONSTRAINT "landscape_channel_demands_channel_company_fk"
    FOREIGN KEY ("channel_id", "company_id")
    REFERENCES "public"."channels"("id", "company_id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "landscape_channel_demands"
    ADD CONSTRAINT "landscape_channel_demands_window_ck"
    CHECK ("required_since" <= "required_until");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "landscape_channel_demands_channel_idx"
  ON "landscape_channel_demands" USING btree ("channel_id");
--> statement-breakpoint
INSERT INTO "landscape_channel_demands" (
  "landscape_id",
  "company_id",
  "channel_id",
  "required_since",
  "required_until"
)
SELECT membership.landscape_id,
       membership.company_id,
       channel.id,
       coalesce(state.required_since, now() - interval '90 days'),
       coalesce(state.required_until, now())
  FROM landscape_companies membership
  JOIN channels channel ON channel.company_id = membership.company_id
  LEFT JOIN channel_collection_state state ON state.channel_id = channel.id
 WHERE channel.active
ON CONFLICT (landscape_id, channel_id) DO NOTHING;
