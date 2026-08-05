DO $$
BEGIN
ALTER TABLE "channels" ADD CONSTRAINT "channels_identity_key_ck" CHECK ("channels"."identity_key" = CASE
    WHEN "channels"."platform" = 'youtube'::platform
      AND regexp_replace(btrim("channels"."handle"), '^@', '') ~ '^UC[A-Za-z0-9_-]{22}$'
      THEN 'channel:' || regexp_replace(btrim("channels"."handle"), '^@', '')
    WHEN "channels"."platform" = 'reddit'::platform THEN
      CASE
        WHEN lower(regexp_replace(btrim("channels"."handle"), '^/+|/+$', '', 'g')) ~ '^(u|user)/.+$'
          THEN 'user:' || regexp_replace(
            lower(regexp_replace(btrim("channels"."handle"), '^/+|/+$', '', 'g')),
            '^(u|user)/', ''
          )
        WHEN lower(regexp_replace(btrim("channels"."handle"), '^/+|/+$', '', 'g')) ~ '^r/.+$'
          THEN 'subreddit:' || regexp_replace(
            lower(regexp_replace(btrim("channels"."handle"), '^/+|/+$', '', 'g')),
            '^r/', ''
          )
        ELSE 'subreddit:' || lower(
          regexp_replace(btrim("channels"."handle"), '^/+|/+$', '', 'g')
        )
      END
    WHEN "channels"."platform" = 'bluesky'::platform
      AND btrim("channels"."handle") ~* '^did:[^:]+:.+$'
      THEN 'did:' || lower(split_part(btrim("channels"."handle"), ':', 2))
        || ':' || substring(btrim("channels"."handle") from '^[^:]+:[^:]+:(.+)$')
    ELSE 'handle:' || lower(regexp_replace(btrim("channels"."handle"), '^@', ''))
  END);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
