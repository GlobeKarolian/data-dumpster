/**
 * Publishing tables. Created on first use with idempotent DDL (mirrored in
 * drizzle/0039_publishing.sql), the same pattern as Article Leakage: the
 * feature is new and additive, nothing else reads these tables, so a first
 * request creating them cannot break an existing screen.
 *
 * Everything here is organization-private. None of it joins the pooled
 * companies/channels/posts tables except the optional, read-only
 * channel_id link a target uses to learn its best posting hours.
 */
export const PUBLISHING_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS publish_targets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id uuid NOT NULL,
    brand text NOT NULL,
    platform text NOT NULL,
    label text NOT NULL,
    handle text,
    provider text NOT NULL DEFAULT 'mock',
    secret_enc text,
    channel_id uuid,
    utm jsonb NOT NULL DEFAULT '{}'::jsonb,
    rules jsonb NOT NULL DEFAULT '[]'::jsonb,
    min_gap_minutes integer NOT NULL DEFAULT 30,
    max_per_day integer,
    bio_page_id uuid,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS publish_targets_org_idx ON publish_targets (org_id, brand, platform)`,

  `CREATE TABLE IF NOT EXISTS publish_posts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id uuid NOT NULL,
    created_by uuid,
    created_by_email text,
    status text NOT NULL,
    origin text NOT NULL DEFAULT 'manual',
    feed_id uuid,
    base_copy text NOT NULL DEFAULT '',
    link_url text,
    link_title text,
    media_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
    timing jsonb NOT NULL,
    options jsonb NOT NULL DEFAULT '{}'::jsonb,
    notes text,
    approved_by_email text,
    approved_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS publish_posts_org_idx ON publish_posts (org_id, created_at DESC)`,

  `CREATE TABLE IF NOT EXISTS publish_deliveries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id uuid NOT NULL,
    post_id uuid NOT NULL REFERENCES publish_posts(id) ON DELETE CASCADE,
    target_id uuid NOT NULL REFERENCES publish_targets(id) ON DELETE CASCADE,
    copy text NOT NULL DEFAULT '',
    link_url text,
    final_text text NOT NULL DEFAULT '',
    link_mode text NOT NULL DEFAULT 'text',
    status text NOT NULL,
    scheduled_for timestamptz,
    slot_reason text,
    attempts integer NOT NULL DEFAULT 0,
    lease_until timestamptz,
    provider text,
    provider_post_id text,
    post_url text,
    last_error text,
    sent_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS publish_deliveries_due_idx ON publish_deliveries (status, scheduled_for)`,
  `CREATE INDEX IF NOT EXISTS publish_deliveries_target_idx ON publish_deliveries (target_id, scheduled_for)`,
  `CREATE INDEX IF NOT EXISTS publish_deliveries_post_idx ON publish_deliveries (post_id)`,

  `CREATE TABLE IF NOT EXISTS publish_attempts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id uuid NOT NULL,
    delivery_id uuid NOT NULL REFERENCES publish_deliveries(id) ON DELETE CASCADE,
    ok boolean NOT NULL,
    provider text NOT NULL,
    detail jsonb,
    at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS publish_attempts_delivery_idx ON publish_attempts (delivery_id, at DESC)`,

  `CREATE TABLE IF NOT EXISTS publish_bio_pages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id uuid NOT NULL,
    slug text NOT NULL UNIQUE,
    title text NOT NULL,
    brand text NOT NULL,
    avatar_url text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS publish_bio_links (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id uuid NOT NULL,
    page_id uuid NOT NULL REFERENCES publish_bio_pages(id) ON DELETE CASCADE,
    title text NOT NULL,
    url text NOT NULL,
    image_url text,
    starts_at timestamptz NOT NULL DEFAULT now(),
    ends_at timestamptz,
    pinned boolean NOT NULL DEFAULT false,
    delivery_id uuid REFERENCES publish_deliveries(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS publish_bio_links_page_idx ON publish_bio_links (page_id, starts_at DESC)`,

  `CREATE TABLE IF NOT EXISTS publish_feeds (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id uuid NOT NULL,
    label text NOT NULL,
    url text NOT NULL,
    target_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
    templates jsonb NOT NULL DEFAULT '{}'::jsonb,
    window_minutes integer NOT NULL DEFAULT 120,
    require_approval boolean NOT NULL DEFAULT false,
    active boolean NOT NULL DEFAULT true,
    last_polled_at timestamptz,
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS publish_feed_items (
    feed_id uuid NOT NULL REFERENCES publish_feeds(id) ON DELETE CASCADE,
    guid text NOT NULL,
    post_id uuid,
    seen_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (feed_id, guid)
  )`,

  // 0040: emergency pause, and newsroom feed filters.
  `CREATE TABLE IF NOT EXISTS publish_settings (
    org_id uuid PRIMARY KEY,
    paused boolean NOT NULL DEFAULT false,
    paused_by text,
    paused_at timestamptz
  )`,
  `ALTER TABLE publish_feeds ADD COLUMN IF NOT EXISTS include_categories jsonb NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE publish_feeds ADD COLUMN IF NOT EXISTS exclude_keywords jsonb NOT NULL DEFAULT '[]'::jsonb`,
];
