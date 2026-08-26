/**
 * Data Dumpster database schema.
 *
 * Design notes:
 *  - Everything is scoped to an `org`. Multi-tenant from day one so this can host
 *    more than one Globe Media brand (Globe, BG.com, STAT, Boston.com) without forks.
 *  - `companies` are the entities being measured (us AND competitors).
 *  - `channels` are a company's presence on one platform. A company has 0..n channels.
 *  - `landscapes` are named competitive sets: one focus company + n competitors.
 *  - Post metrics are stored as an append-only time series (`post_metric_snapshots`)
 *    with a denormalized "latest" copy on `posts` for fast reads. Engagement on social
 *    is not immutable, so keeping history is how you get honest velocity curves.
 */
import {
  pgTable, pgEnum, text, timestamp, integer, bigint, boolean,
  jsonb, uniqueIndex, index, primaryKey, foreignKey, check, doublePrecision, date, uuid,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { COLLECTION_OUTCOMES } from '@/lib/adapters/types';

/* ------------------------------------------------------------------ enums */

export const platformEnum = pgEnum('platform', [
  'facebook', 'instagram', 'twitter', 'youtube', 'tiktok',
  'linkedin', 'bluesky', 'threads', 'reddit', 'truth_social', 'rss',
]);

export const postTypeEnum = pgEnum('post_type', [
  'photo', 'video', 'carousel', 'reel', 'short', 'story',
  'text', 'link', 'live', 'poll', 'repost', 'article', 'other',
]);

export const roleEnum = pgEnum('role', ['owner', 'admin', 'editor', 'viewer']);

export const ingestStatusEnum = pgEnum('ingest_status', [
  'queued', 'running', 'succeeded', 'partial', 'failed',
]);

export const collectionOutcomeEnum = pgEnum('collection_outcome', COLLECTION_OUTCOMES);

export const modelProviderEnum = pgEnum('model_provider', [
  'anthropic', 'openai', 'google', 'azure_openai',
  'bedrock', 'openrouter', 'openai_compatible', 'ollama',
]);

export const tagSourceEnum = pgEnum('tag_source', ['manual', 'rule', 'ai']);

export const alertKindEnum = pgEnum('alert_kind', [
  'competitor_outlier', 'audience_swing', 'volume_drop',
  'new_channel', 'keyword_hit', 'share_of_voice_shift', 'custom',
]);

/* ------------------------------------------------------------- tenancy */

export const orgs = pgTable('orgs', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  name: text('name'),
  image: text('image'),
  passwordHash: text('password_hash'),
  role: roleEnum('role').notNull().default('viewer'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
}, (t) => [uniqueIndex('users_email_uq').on(t.email)]);

export const sessions = pgTable('sessions', {
  sessionToken: text('session_token').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { withTimezone: true }).notNull(),
});

/**
 * Pending invitations.
 *
 * An invitation is a single-use credential whether it is delivered manually or
 * emailed after an access request is approved. Hence 32 random bytes rather than
 * a sequence, hence an expiry, and hence the single-statement accept in
 * lib/invites.ts.
 *
 * Rows are kept after acceptance rather than deleted. Who let whom into a
 * newsroom tool, and when, is exactly the question that gets asked six months
 * later, and a deleted row cannot answer it.
 */
export const invites = pgTable('invites', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  role: roleEnum('role').notNull().default('viewer'),
  /** URL-safe base64 of 32 random bytes. Written once, never regenerated. */
  token: text('token').notNull(),
  /** Nullable: removing an administrator must not erase the invites they sent. */
  invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  acceptedByUserId: uuid('accepted_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('invites_token_uq').on(t.token),
  index('invites_org_email_idx').on(t.orgId, t.email),
]);

/**
 * Public requests to join an organization.
 *
 * A request is not an account and grants no access. An admin must approve it,
 * at which point the approval is tied to a normal single-use invitation. Rows
 * are retained after a decision so the organization has an audit trail of who
 * asked, who decided, and when.
 */
export const accessRequests = pgTable('access_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  name: text('name').notNull(),
  team: text('team'),
  reason: text('reason'),
  status: text('status').notNull().default('pending'),
  reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  inviteId: uuid('invite_id').references(() => invites.id, { onDelete: 'set null' }),
  requestNotificationSentAt: timestamp('request_notification_sent_at', { withTimezone: true }),
  requestNotificationError: text('request_notification_error'),
  decisionNotificationSentAt: timestamp('decision_notification_sent_at', { withTimezone: true }),
  decisionNotificationError: text('decision_notification_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('access_requests_org_email_pending_uq')
    .on(t.orgId, t.email)
    .where(sql`${t.status} = 'pending'`),
  index('access_requests_org_status_created_idx').on(t.orgId, t.status, t.createdAt),
  check('access_requests_status_ck', sql`${t.status} IN ('pending', 'approved', 'declined')`),
]);

/* ----------------------------------------------------- entities measured */

/**
 * An outlet that exists in the world.
 *
 * POOLED, NOT OWNED. A company and everything hanging off it (channels, posts,
 * audience, URLs) is shared across organisations, because public social data is
 * identical regardless of who is looking. The Boston Globe's TikTok post has one
 * view count; two newsrooms tracking it do not have different views of it, so
 * storing it twice is waste rather than isolation.
 *
 * This is the mechanism that makes the incumbent cheap: collect a company once,
 * serve it to every customer who tracks it, and let a new customer inherit
 * however much history the earliest subscriber has accumulated. See
 * docs/DATA-POOLING.md for why this, and not better engineering, is how you
 * beat them on cost.
 *
 * `orgId` is retained but nullable and means "added by", not "owned by". It is
 * attribution and nothing reads it as a tenancy boundary. The boundary lives on
 * `landscapes`: which outlets you consider rivals is private, the outlets
 * themselves are not.
 */
export const companies = pgTable('companies', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Attribution only. Null for companies seeded before any org existed. */
  orgId: uuid('org_id').references(() => orgs.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  website: text('website'),
  logoUrl: text('logo_url'),
  /** Free-form classification used for peer grouping, e.g. "metro daily", "public radio". */
  segment: text('segment'),
  color: text('color'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // Global rather than per-org. Two newsrooms adding The Boston Globe must land
  // on one row, which is the entire point.
  uniqueIndex('companies_slug_uq').on(t.slug),
]);

export const channels = pgTable('channels', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  platform: platformEnum('platform').notNull(),
  /** Public handle, e.g. "bostonglobe". */
  handle: text('handle').notNull(),
  /** Canonical handle fallback; stable platform ids remain authoritative. */
  identityKey: text('identity_key').notNull(),
  /** Platform-native id once resolved (page id, channel id, user id). */
  externalId: text('external_id'),
  profileUrl: text('profile_url'),
  avatarUrl: text('avatar_url'),
  /** True when we hold an owner token and can read private/insights metrics. */
  isOwned: boolean('is_owned').notNull().default(false),
  active: boolean('active').notNull().default(true),
  lastIngestedAt: timestamp('last_ingested_at', { withTimezone: true }),
  /** Adapter cursor: page tokens, since-ids, etag, etc. Adapter-defined shape. */
  cursor: jsonb('cursor').$type<Record<string, unknown>>().notNull().default({}),
  meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('channels_platform_identity_uq').on(t.platform, t.identityKey),
  uniqueIndex('channels_platform_external_uq')
    .on(t.platform, t.externalId)
    .where(sql`${t.externalId} is not null`),
  // Supports the demand table's composite FK, proving the demanded channel
  // belongs to the same company as the landscape membership.
  uniqueIndex('channels_id_company_uq').on(t.id, t.companyId),
  check('channels_identity_key_ck', sql`${t.identityKey} = CASE
    WHEN ${t.platform} = 'youtube'::platform
      AND regexp_replace(btrim(${t.handle}), '^@', '') ~ '^UC[A-Za-z0-9_-]{22}$'
      THEN 'channel:' || regexp_replace(btrim(${t.handle}), '^@', '')
    WHEN ${t.platform} = 'reddit'::platform THEN
      CASE
        WHEN lower(regexp_replace(btrim(${t.handle}), '^/+|/+$', '', 'g')) ~ '^(u|user)/.+$'
          THEN 'user:' || regexp_replace(
            lower(regexp_replace(btrim(${t.handle}), '^/+|/+$', '', 'g')),
            '^(u|user)/', ''
          )
        WHEN lower(regexp_replace(btrim(${t.handle}), '^/+|/+$', '', 'g')) ~ '^r/.+$'
          THEN 'subreddit:' || regexp_replace(
            lower(regexp_replace(btrim(${t.handle}), '^/+|/+$', '', 'g')),
            '^r/', ''
          )
        ELSE 'subreddit:' || lower(
          regexp_replace(btrim(${t.handle}), '^/+|/+$', '', 'g')
        )
      END
    WHEN ${t.platform} = 'bluesky'::platform
      AND btrim(${t.handle}) ~* '^did:[^:]+:.+$'
      THEN 'did:' || lower(split_part(btrim(${t.handle}), ':', 2))
        || ':' || substring(btrim(${t.handle}) from '^[^:]+:[^:]+:(.+)$')
    ELSE 'handle:' || lower(regexp_replace(btrim(${t.handle}), '^@', ''))
  END`),
  index('channels_platform_idx').on(t.platform, t.active),
]);

export const landscapes = pgTable('landscapes', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  description: text('description'),
  /** The company this landscape is written from the point of view of. */
  focusCompanyId: uuid('focus_company_id').references(() => companies.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('landscapes_org_slug_uq').on(t.orgId, t.slug)]);

export const landscapeCompanies = pgTable('landscape_companies', {
  landscapeId: uuid('landscape_id').notNull().references(() => landscapes.id, { onDelete: 'cascade' }),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  sortOrder: integer('sort_order').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.landscapeId, t.companyId] })]);

/**
 * Explicit landscape access for restricted roles.
 *
 * Owners and admins always see every landscape in their organization, so rows
 * here are meaningful only for editors and viewers. Keeping the exception at
 * the role boundary avoids the dangerous state where an administrator can
 * accidentally remove their own route back into access settings.
 */
export const userLandscapeAccess = pgTable('user_landscape_access', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  landscapeId: uuid('landscape_id').notNull().references(() => landscapes.id, { onDelete: 'cascade' }),
  grantedBy: uuid('granted_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.landscapeId] }),
  index('user_landscape_access_landscape_idx').on(t.landscapeId),
]);

/* ---------------------------------------------------------- elections */

/**
 * A newsroom-defined race inside Election Center.
 *
 * The backing landscape is an internal collection scope. It lets election
 * candidates reuse the same pooled companies, channels, posts and scheduler as
 * every other Data Dumpster surface without forcing a race into the ordinary
 * landscape switcher. The race stays organization-private; public observations
 * remain pooled and are never purchased twice for two races.
 */
export const electionRaces = pgTable('election_races', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  landscapeId: uuid('landscape_id').notNull().references(() => landscapes.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  office: text('office').notNull(),
  jurisdiction: text('jurisdiction').notNull(),
  electionDate: date('election_date'),
  status: text('status').notNull().default('setup'),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('election_races_org_slug_uq').on(t.orgId, t.slug),
  uniqueIndex('election_races_landscape_uq').on(t.landscapeId),
  index('election_races_org_status_idx').on(t.orgId, t.status, t.electionDate),
  check('election_races_status_ck', sql`${t.status} IN ('setup', 'active', 'archived')`),
]);

/**
 * A candidate is a race-specific reference to one pooled company row.
 *
 * Candidate metadata such as party and ballot status belongs to the race. The
 * candidate's public social profiles and observations stay on the shared
 * company/channel tables so the same person can appear in several races or
 * landscapes without duplicating collection.
 */
export const electionCandidates = pgTable('election_candidates', {
  id: uuid('id').primaryKey().defaultRandom(),
  raceId: uuid('race_id').notNull().references(() => electionRaces.id, { onDelete: 'cascade' }),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
  party: text('party'),
  candidateStatus: text('candidate_status').notNull().default('tracking'),
  /**
   * Canonical English Wikipedia article title, e.g. "Cory_Booker". Resolved
   * once through the Wikipedia search API and stored so attention data joins
   * on a stable key; null means no article was confidently matched and the
   * candidate simply has no attention series rather than a guessed one.
   */
  wikipediaTitle: text('wikipedia_title'),
  incumbent: boolean('incumbent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('election_candidates_race_company_uq').on(t.raceId, t.companyId),
  index('election_candidates_race_status_idx').on(t.raceId, t.candidateStatus),
  check(
    'election_candidates_status_ck',
    sql`${t.candidateStatus} IN ('tracking', 'declared', 'filed', 'withdrawn')`,
  ),
]);

/**
 * A candidate profile URL supplied by an editor before it becomes a channel.
 *
 * Source intake is intentionally separate from the pooled channel table. A URL
 * from a spreadsheet is a claim; the platform adapter must resolve it before
 * the system creates a shared identity and begins collection. Once connected,
 * the optional channel id records which pooled account satisfied the request.
 */
export const electionProfileSources = pgTable('election_profile_sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  candidateId: uuid('candidate_id').notNull().references(() => electionCandidates.id, { onDelete: 'cascade' }),
  platform: platformEnum('platform').notNull(),
  url: text('url').notNull(),
  /**
   * Editor-supplied disambiguation for candidates with several accounts on one
   * platform, e.g. "personal", "campaign", "official". Purely presentational;
   * identity and collection stay on the platform/url pair.
   */
  label: text('label'),
  status: text('status').notNull().default('pending'),
  channelId: uuid('channel_id').references(() => channels.id, { onDelete: 'set null' }),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('election_profile_sources_candidate_platform_url_uq').on(t.candidateId, t.platform, t.url),
  index('election_profile_sources_status_idx').on(t.status, t.platform),
  check(
    'election_profile_sources_status_ck',
    sql`${t.status} IN ('pending', 'connecting', 'connected', 'review', 'paused', 'skipped', 'error')`,
  ),
]);

/**
 * One landscape's explicit request for one pooled public account.
 *
 * Demand is private and may differ by window. Collection state remains global:
 * the scheduler aggregates these rows to one required window and one job per
 * channel. Including companyId lets membership deletion cascade the demand.
 */
export const landscapeChannelDemands = pgTable('landscape_channel_demands', {
  landscapeId: uuid('landscape_id').notNull(),
  companyId: uuid('company_id').notNull(),
  channelId: uuid('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  requiredSince: timestamp('required_since', { withTimezone: true }).notNull(),
  requiredUntil: timestamp('required_until', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.landscapeId, t.channelId] }),
  foreignKey({
    columns: [t.landscapeId, t.companyId],
    foreignColumns: [landscapeCompanies.landscapeId, landscapeCompanies.companyId],
    name: 'landscape_channel_demands_membership_fk',
  }).onDelete('cascade'),
  foreignKey({
    columns: [t.channelId, t.companyId],
    foreignColumns: [channels.id, channels.companyId],
    name: 'landscape_channel_demands_channel_company_fk',
  }).onDelete('cascade'),
  check(
    'landscape_channel_demands_window_ck',
    sql`${t.requiredSince} <= ${t.requiredUntil}`,
  ),
  index('landscape_channel_demands_channel_idx').on(t.channelId),
]);

/* --------------------------------------------------------- measurements */

/**
 * Daily audience size per channel. One row per channel per day.
 * `followers` is the universal audience number; platform extras live in `extra`.
 */
export const audienceSnapshots = pgTable('audience_snapshots', {
  channelId: uuid('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  day: date('day').notNull(),
  followers: bigint('followers', { mode: 'number' }).notNull(),
  following: bigint('following', { mode: 'number' }),
  /** Platform-specific: subscribers, page_likes, total_views, etc. */
  extra: jsonb('extra').$type<Record<string, number>>().notNull().default({}),
  capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
  /** Provenance for new pooled observations; legacy rows remain null until re-collected. */
  sourceRunId: uuid('source_run_id'),
  visibility: text('visibility'),
}, (t) => [
  primaryKey({ columns: [t.channelId, t.day] }),
  index('audience_day_idx').on(t.day),
]);

/**
 * A single public post. `metrics` holds the latest known engagement snapshot so
 * the read path never has to join history. History lives in post_metric_snapshots.
 */
export const posts = pgTable('posts', {
  id: uuid('id').primaryKey().defaultRandom(),
  channelId: uuid('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  platform: platformEnum('platform').notNull(),
  externalId: text('external_id').notNull(),
  postedAt: timestamp('posted_at', { withTimezone: true }).notNull(),
  type: postTypeEnum('type').notNull().default('other'),
  text: text('text'),
  permalink: text('permalink'),
  mediaUrl: text('media_url'),
  thumbnailUrl: text('thumbnail_url'),
  /**
   * Private object-storage copy of the display poster. Social-network CDN URLs
   * are references, not durable assets; several providers expire them within
   * days. Browser-facing reads stay behind the authenticated preview route.
   */
  archivedThumbnailUrl: text('archived_thumbnail_url'),
  archivedThumbnailContentType: text('archived_thumbnail_content_type'),
  archivedThumbnailBytes: integer('archived_thumbnail_bytes'),
  archivedThumbnailAt: timestamp('archived_thumbnail_at', { withTimezone: true }),
  thumbnailArchiveAttemptedAt: timestamp('thumbnail_archive_attempted_at', { withTimezone: true }),
  thumbnailArchiveError: text('thumbnail_archive_error'),
  thumbnailArchiveAttempts: integer('thumbnail_archive_attempts').notNull().default(0),
  durationSec: integer('duration_sec'),
  language: text('language'),
  hashtags: jsonb('hashtags').$type<string[]>().notNull().default([]),
  mentions: jsonb('mentions').$type<string[]>().notNull().default([]),

  /* ---- denormalized latest metrics (see lib/metrics for definitions) ---- */
  applause: bigint('applause', { mode: 'number' }).notNull().default(0),
  conversation: bigint('conversation', { mode: 'number' }).notNull().default(0),
  amplification: bigint('amplification', { mode: 'number' }).notNull().default(0),
  saves: bigint('saves', { mode: 'number' }).notNull().default(0),
  views: bigint('views', { mode: 'number' }).notNull().default(0),
  engagementTotal: bigint('engagement_total', { mode: 'number' }).notNull().default(0),
  /** engagementTotal / followers-at-post-time. Stored so leaderboards stay cheap. */
  engagementRateByFollower: doublePrecision('engagement_rate_by_follower').notNull().default(0),
  engagementRateByView: doublePrecision('engagement_rate_by_view'),
  followersAtPost: bigint('followers_at_post', { mode: 'number' }),

  /** Minimal public-safe preview metadata. The pooled runner drops arbitrary vendor payload keys. */
  raw: jsonb('raw').$type<Record<string, unknown>>(),
  /** Provenance for new pooled observations; legacy rows remain null until re-collected. */
  sourceRunId: uuid('source_run_id'),
  visibility: text('visibility'),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  lastRefreshedAt: timestamp('last_refreshed_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('posts_channel_external_uq').on(t.channelId, t.externalId),
  index('posts_company_posted_idx').on(t.companyId, t.postedAt),
  index('posts_platform_posted_idx').on(t.platform, t.postedAt),
  index('posts_engagement_idx').on(t.postedAt, t.engagementTotal),
  index('posts_thumbnail_archive_queue_idx')
    .on(t.thumbnailArchiveAttemptedAt, t.postedAt)
    .where(sql`${t.archivedThumbnailUrl} IS NULL AND (${t.thumbnailUrl} IS NOT NULL OR ${t.permalink} IS NOT NULL)`),
]);

export const postMetricSnapshots = pgTable('post_metric_snapshots', {
  postId: uuid('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
  applause: bigint('applause', { mode: 'number' }).notNull().default(0),
  conversation: bigint('conversation', { mode: 'number' }).notNull().default(0),
  amplification: bigint('amplification', { mode: 'number' }).notNull().default(0),
  saves: bigint('saves', { mode: 'number' }).notNull().default(0),
  views: bigint('views', { mode: 'number' }).notNull().default(0),
  engagementTotal: bigint('engagement_total', { mode: 'number' }).notNull().default(0),
  sourceRunId: uuid('source_run_id'),
  visibility: text('visibility'),
}, (t) => [
  primaryKey({ columns: [t.postId, t.capturedAt] }),
  index('post_metric_snapshots_captured_idx').on(t.capturedAt),
]);

/** Links found inside posts. Powers "what are they driving traffic to". */
export const postedUrls = pgTable('posted_urls', {
  id: uuid('id').primaryKey().defaultRandom(),
  postId: uuid('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  canonicalUrl: text('canonical_url'),
  domain: text('domain').notNull(),
  pathSegments: jsonb('path_segments').$type<string[]>().notNull().default([]),
  title: text('title'),
}, (t) => [
  index('posted_urls_post_idx').on(t.postId),
  index('posted_urls_domain_idx').on(t.domain),
  index('posted_urls_company_idx').on(t.companyId),
]);

/* ------------------------------------------------------- tagging layer */

export const postTags = pgTable('post_tags', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  color: text('color'),
  /** Optional auto-tag rule. Evaluated at ingest time. */
  rule: jsonb('rule').$type<{
    anyKeywords?: string[];
    allKeywords?: string[];
    noneKeywords?: string[];
    hashtags?: string[];
    platforms?: string[];
    postTypes?: string[];
    urlDomains?: string[];
    urlPathContains?: string[];
    regex?: string;
  }>(),
  /** Natural-language description used by the AI tagger when rule is absent. */
  aiPrompt: text('ai_prompt'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('post_tags_org_name_uq').on(t.orgId, t.name)]);

export const postTagAssignments = pgTable('post_tag_assignments', {
  postId: uuid('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  tagId: uuid('tag_id').notNull().references(() => postTags.id, { onDelete: 'cascade' }),
  source: tagSourceEnum('source').notNull().default('rule'),
  confidence: doublePrecision('confidence'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.postId, t.tagId] }),
  index('pta_tag_idx').on(t.tagId),
]);

/* ------------------------------------------------ credentials + BYO model */

/**
 * Platform API credentials (per org). Value is AES-256-GCM encrypted at rest by
 * lib/crypto.ts; the plaintext never leaves the server.
 */
export const platformCredentials = pgTable('platform_credentials', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  platform: platformEnum('platform').notNull(),
  label: text('label'),
  encrypted: text('encrypted').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  scopes: jsonb('scopes').$type<string[]>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('platform_creds_org_idx').on(t.orgId, t.platform)]);

/**
 * Bring-your-own-model. An org points Data Dumpster at whatever inference it is
 * already paying for, or at a self-hosted endpoint. No vendor lock, and no
 * customer data flowing to a model the newsroom did not choose.
 */
export const modelConnections = pgTable('model_connections', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  provider: modelProviderEnum('provider').notNull(),
  model: text('model').notNull(),
  /** For openai_compatible / ollama / azure: the endpoint root. */
  baseUrl: text('base_url'),
  encryptedApiKey: text('encrypted_api_key'),
  /** Per-1M-token prices so the app can show real spend, not vibes. */
  inputCostPerMtok: doublePrecision('input_cost_per_mtok'),
  outputCostPerMtok: doublePrecision('output_cost_per_mtok'),
  maxOutputTokens: integer('max_output_tokens').notNull().default(4096),
  isDefault: boolean('is_default').notNull().default(false),
  enabled: boolean('enabled').notNull().default(true),
  /** Last health check result so Settings can show green/red honestly. */
  lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
  lastCheckOk: boolean('last_check_ok'),
  lastCheckError: text('last_check_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('model_conn_org_idx').on(t.orgId)]);

export const aiUsage = pgTable('ai_usage', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  connectionId: uuid('connection_id').references(() => modelConnections.id, { onDelete: 'set null' }),
  feature: text('feature').notNull(),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  costUsd: doublePrecision('cost_usd').notNull().default(0),
  latencyMs: integer('latency_ms'),
  ok: boolean('ok').notNull().default(true),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('ai_usage_org_time_idx').on(t.orgId, t.createdAt)]);

/* ------------------------------------------------- AI output + workflow */

export const briefs = pgTable('briefs', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  landscapeId: uuid('landscape_id').notNull().references(() => landscapes.id, { onDelete: 'cascade' }),
  periodStart: date('period_start').notNull(),
  periodEnd: date('period_end').notNull(),
  title: text('title').notNull(),
  /** Markdown body. */
  body: text('body').notNull(),
  /** The verified fact sheet the model was given. Enables audit of every claim. */
  facts: jsonb('facts').$type<Record<string, unknown>>().notNull().default({}),
  modelUsed: text('model_used'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('briefs_landscape_idx').on(t.landscapeId, t.periodEnd)]);

export const dashboards = pgTable('dashboards', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  landscapeId: uuid('landscape_id').references(() => landscapes.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  /** Ordered widget definitions; shape validated by lib/dashboards/schema.ts. */
  widgets: jsonb('widgets').$type<unknown[]>().notNull().default([]),
  /** When set, the dashboard is readable at /public/<shareToken> without auth. */
  shareToken: text('share_token'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('dashboards_org_slug_uq').on(t.orgId, t.slug),
  uniqueIndex('dashboards_share_uq').on(t.shareToken),
]);

export const alertRules = pgTable('alert_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  landscapeId: uuid('landscape_id').references(() => landscapes.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  kind: alertKindEnum('kind').notNull(),
  config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
  /** Delivery targets: [{type:'slack',webhookUrl}, {type:'email',to}] */
  destinations: jsonb('destinations').$type<Record<string, unknown>[]>().notNull().default([]),
  enabled: boolean('enabled').notNull().default(true),
  lastFiredAt: timestamp('last_fired_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const alertEvents = pgTable('alert_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  ruleId: uuid('rule_id').notNull().references(() => alertRules.id, { onDelete: 'cascade' }),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  body: text('body'),
  severity: text('severity').notNull().default('info'),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('alert_events_org_time_idx').on(t.orgId, t.createdAt)]);

export const ingestionRuns = pgTable('ingestion_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  channelId: uuid('channel_id').references(() => channels.id, { onDelete: 'cascade' }),
  platform: platformEnum('platform').notNull(),
  status: ingestStatusEnum('status').notNull().default('queued'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  postsUpserted: integer('posts_upserted').notNull().default(0),
  snapshotsUpserted: integer('snapshots_upserted').notNull().default(0),
  apiCalls: integer('api_calls').notNull().default(0),
  error: text('error'),
  detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
  /** Exact deployment-wide source that won this run; unselected:* is pre-fetch only. */
  sourceKey: text('source_key').notNull().default('legacy-unknown'),
  visibility: text('visibility').notNull().default('legacy-unknown'),
}, (t) => [
  index('ingestion_runs_time_idx').on(t.startedAt),
  index('ingestion_runs_channel_started_idx').on(t.channelId, t.startedAt.desc()),
]);

/**
 * Durable work and coverage state for pooled public profiles.
 *
 * A channel row says what to collect; this row says whether the requested
 * historical window has actually finished. Keeping it separate from
 * `last_ingested_at` prevents a one-page or `hasMore` response from certifying
 * a landscape as complete. The lease makes overlapping cron/manual runs safe.
 */
export const channelCollectionState = pgTable('channel_collection_state', {
  channelId: uuid('channel_id').primaryKey().references(() => channels.id, { onDelete: 'cascade' }),
  requestedByOrgId: uuid('requested_by_org_id').references(() => orgs.id, { onDelete: 'set null' }),
  requiredSince: timestamp('required_since', { withTimezone: true }).notNull(),
  requiredUntil: timestamp('required_until', { withTimezone: true }).notNull(),
  coverageSince: timestamp('coverage_since', { withTimezone: true }),
  coverageUntil: timestamp('coverage_until', { withTimezone: true }),
  /**
   * Latest requested upper bound the source actually answered, even when that
   * source could not certify the historical window. This is a freshness
   * watermark only; it must never be read as certified coverage.
   */
  attemptedUntil: timestamp('attempted_until', { withTimezone: true }),
  status: ingestStatusEnum('status').notNull().default('queued'),
  /** Precise durable outcome used by the scheduler after the latest attempt. */
  outcome: collectionOutcomeEnum('outcome'),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).defaultNow(),
  leaseToken: uuid('lease_token'),
  leaseUntil: timestamp('lease_until', { withTimezone: true }),
  hasMore: boolean('has_more').notNull().default(true),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('channel_collection_runnable_idx').on(t.status, t.nextAttemptAt, t.leaseUntil),
  index('channel_collection_coverage_idx').on(t.coverageUntil),
]);

/**
 * Cursor and freshness state for one deployment-wide public source.
 *
 * Logical pooled coverage remains in `channel_collection_state`. This table
 * keeps source mechanics separate so a Bright Data receipt can never replace
 * an EnsembleData or official-API cursor for the same public channel.
 */
export const publicChannelSourceState = pgTable('public_channel_source_state', {
  channelId: uuid('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  sourceKey: text('source_key').notNull(),
  cursor: jsonb('cursor').$type<Record<string, unknown>>().notNull().default({}),
  /** Last source-certified window used for incremental overlap. */
  lastIngestedAt: timestamp('last_ingested_at', { withTimezone: true }),
  /** Most recent time the runner was ready to call this exact source. */
  lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
  /** Most recent response whose source cursor was durably saved. */
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({
    name: 'public_channel_source_state_pk',
    columns: [t.channelId, t.sourceKey],
  }),
  check('public_channel_source_state_source_key_ck', sql`btrim(${t.sourceKey}) <> ''`),
]);

/**
 * A user-visible refresh coordinator.
 *
 * The channel queue above remains the source of truth for collection and
 * retries. This row only snapshots the requested scope, prevents a double
 * click from buying the same refresh twice, and gives the UI a durable handle
 * it can rediscover after navigation or a browser restart.
 */
export const refreshJobs = pgTable('refresh_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  landscapeId: uuid('landscape_id').notNull().references(() => landscapes.id, { onDelete: 'cascade' }),
  requestedByUserId: uuid('requested_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  /** Stable across retries when the browser loses the initial 202 response. */
  idempotencyKey: text('idempotency_key').notNull(),
  /** Immutable fingerprint bound to the idempotency key. */
  requestFingerprint: text('request_fingerprint').notNull(),
  /** One canonical active scope per landscape; overlapping requests coalesce here. */
  scopeKey: text('scope_key').notNull(),
  /** Exact platform/window requests folded into this coordinator. */
  requestScopes: jsonb('request_scopes').$type<unknown>().notNull().default([]),
  platforms: jsonb('platforms').$type<string[]>().notNull().default([]),
  channelIds: jsonb('channel_ids').$type<string[]>().notNull().default([]),
  requiredSince: timestamp('required_since', { withTimezone: true }).notNull(),
  requiredUntil: timestamp('required_until', { withTimezone: true }).notNull(),
  status: text('status').notNull().default('queued'),
  totalProfiles: integer('total_profiles').notNull().default(0),
  /** Token-fenced coordinator lease; channel work keeps its own finer lease. */
  workerLeaseToken: uuid('worker_lease_token'),
  workerLeaseUntil: timestamp('worker_lease_until', { withTimezone: true }),
  /** Earliest time the lightweight recovery dispatcher should nudge this job. */
  nextWakeAt: timestamp('next_wake_at', { withTimezone: true }),
  /** Frozen terminal counters and activity; pooled queue state keeps changing later. */
  finalSnapshot: jsonb('final_snapshot').$type<unknown>(),
  lastError: text('last_error'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('refresh_jobs_org_idempotency_uq').on(t.orgId, t.idempotencyKey),
  uniqueIndex('refresh_jobs_active_scope_uq')
    .on(t.orgId, t.scopeKey)
    .where(sql`${t.status} IN ('queued', 'running')`),
  index('refresh_jobs_landscape_time_idx').on(t.orgId, t.landscapeId, t.createdAt),
  index('refresh_jobs_recovery_idx').on(t.status, t.nextWakeAt, t.createdAt),
  check(
    'refresh_jobs_status_ck',
    sql`${t.status} IN ('queued', 'running', 'completed', 'completed_with_issues', 'failed')`,
  ),
  check('refresh_jobs_window_ck', sql`${t.requiredSince} <= ${t.requiredUntil}`),
  check('refresh_jobs_total_profiles_ck', sql`${t.totalProfiles} >= 0`),
]);

/* ------------------------------------------------------------ relations */

export const orgsRelations = relations(orgs, ({ many }) => ({
  users: many(users), companies: many(companies), landscapes: many(landscapes),
  accessRequests: many(accessRequests), electionRaces: many(electionRaces),
}));

export const companiesRelations = relations(companies, ({ one, many }) => ({
  org: one(orgs, { fields: [companies.orgId], references: [orgs.id] }),
  channels: many(channels), posts: many(posts), electionCandidates: many(electionCandidates),
}));

export const channelsRelations = relations(channels, ({ one, many }) => ({
  company: one(companies, { fields: [channels.companyId], references: [companies.id] }),
  posts: many(posts), audience: many(audienceSnapshots), demands: many(landscapeChannelDemands),
  publicSourceStates: many(publicChannelSourceState),
}));

export const landscapesRelations = relations(landscapes, ({ one, many }) => ({
  org: one(orgs, { fields: [landscapes.orgId], references: [orgs.id] }),
  focusCompany: one(companies, { fields: [landscapes.focusCompanyId], references: [companies.id] }),
  members: many(landscapeCompanies), demands: many(landscapeChannelDemands),
  electionRace: one(electionRaces, {
    fields: [landscapes.id],
    references: [electionRaces.landscapeId],
  }),
}));

export const landscapeCompaniesRelations = relations(landscapeCompanies, ({ one }) => ({
  landscape: one(landscapes, { fields: [landscapeCompanies.landscapeId], references: [landscapes.id] }),
  company: one(companies, { fields: [landscapeCompanies.companyId], references: [companies.id] }),
}));

export const electionRacesRelations = relations(electionRaces, ({ one, many }) => ({
  org: one(orgs, { fields: [electionRaces.orgId], references: [orgs.id] }),
  landscape: one(landscapes, {
    fields: [electionRaces.landscapeId],
    references: [landscapes.id],
  }),
  candidates: many(electionCandidates),
}));

export const electionCandidatesRelations = relations(electionCandidates, ({ one, many }) => ({
  race: one(electionRaces, {
    fields: [electionCandidates.raceId],
    references: [electionRaces.id],
  }),
  company: one(companies, {
    fields: [electionCandidates.companyId],
    references: [companies.id],
  }),
  profileSources: many(electionProfileSources),
}));

export const electionProfileSourcesRelations = relations(electionProfileSources, ({ one }) => ({
  candidate: one(electionCandidates, {
    fields: [electionProfileSources.candidateId],
    references: [electionCandidates.id],
  }),
  channel: one(channels, {
    fields: [electionProfileSources.channelId],
    references: [channels.id],
  }),
}));

export const landscapeChannelDemandsRelations = relations(landscapeChannelDemands, ({ one }) => ({
  landscape: one(landscapes, {
    fields: [landscapeChannelDemands.landscapeId],
    references: [landscapes.id],
  }),
  company: one(companies, {
    fields: [landscapeChannelDemands.companyId],
    references: [companies.id],
  }),
  channel: one(channels, {
    fields: [landscapeChannelDemands.channelId],
    references: [channels.id],
  }),
}));

export const publicChannelSourceStateRelations = relations(publicChannelSourceState, ({ one }) => ({
  channel: one(channels, {
    fields: [publicChannelSourceState.channelId],
    references: [channels.id],
  }),
}));

export const postsRelations = relations(posts, ({ one, many }) => ({
  channel: one(channels, { fields: [posts.channelId], references: [channels.id] }),
  company: one(companies, { fields: [posts.companyId], references: [companies.id] }),
  tags: many(postTagAssignments), urls: many(postedUrls),
}));

export const postTagAssignmentsRelations = relations(postTagAssignments, ({ one }) => ({
  post: one(posts, { fields: [postTagAssignments.postId], references: [posts.id] }),
  tag: one(postTags, { fields: [postTagAssignments.tagId], references: [postTags.id] }),
}));

export { sql };

/**
 * Weekly reports.
 *
 * Modelled on the Platforms Dashboard and Digest that already goes out every
 * Monday. Two kinds of content live here and they are deliberately separated:
 *
 *  - `computed` is everything Pressbox can derive from ingested data. It is
 *    regenerated on demand and never hand-edited, so a stale number cannot
 *    survive a refresh.
 *  - `manual` is everything that lives in systems Pressbox does not read:
 *    Search Console clicks, referral traffic by subscriptions driven, paid
 *    promotion cost per start, Apple News. Those get paste boxes rather than a
 *    fake integration, because a box someone fills in ninety seconds is better
 *    than a connector nobody maintains.
 *
 * `narrative` holds the so-what commentary, which is the part leadership
 * actually reads and the part a table cannot supply.
 */
export const weeklyReports = pgTable('weekly_reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  landscapeId: uuid('landscape_id').references(() => landscapes.id, { onDelete: 'set null' }),
  periodStart: date('period_start').notNull(),
  periodEnd: date('period_end').notNull(),
  title: text('title').notNull(),
  /** Banner note, e.g. a broken data stream that omits a brand this week. */
  dataNote: text('data_note'),
  computed: jsonb('computed').$type<Record<string, unknown>>().notNull().default({}),
  manual: jsonb('manual').$type<Record<string, unknown>>().notNull().default({}),
  narrative: jsonb('narrative').$type<Record<string, string>>().notNull().default({}),
  status: text('status').notNull().default('draft'),
  /** Capability token for an explicitly published, read-only report snapshot. */
  shareToken: text('share_token'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('weekly_reports_period_uq').on(
    t.orgId, t.landscapeId, t.periodStart, t.periodEnd,
  ),
  uniqueIndex('weekly_reports_share_uq').on(t.shareToken),
  index('weekly_reports_org_idx').on(t.orgId, t.periodEnd),
]);

/**
 * Scheduled report delivery.
 *
 * A schedule is intentionally weekly and deliberately does not turn on a
 * Vercel cron by itself. The route can be exercised manually before vendor
 * spend is approved; adding it to vercel.json is a separate operating decision.
 * `dayOfWeek` uses ISO numbering (Monday 1 through Sunday 7).
 */
export const reportSchedules = pgTable('report_schedules', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  landscapeId: uuid('landscape_id').notNull().references(() => landscapes.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  recipients: jsonb('recipients').$type<string[]>().notNull().default([]),
  formats: jsonb('formats').$type<Array<'pptx' | 'csv'>>().notNull().default(['pptx', 'csv']),
  includeSlack: boolean('include_slack').notNull().default(false),
  dayOfWeek: integer('day_of_week').notNull().default(1),
  hour: integer('hour').notNull().default(8),
  timeZone: text('time_zone').notNull().default('America/New_York'),
  enabled: boolean('enabled').notNull().default(true),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  lastError: text('last_error'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('report_schedules_org_idx').on(t.orgId, t.enabled),
  index('report_schedules_landscape_idx').on(t.landscapeId),
]);

/**
 * Immutable-enough delivery audit trail. Failed rows are retried in place for
 * the same schedule window so the unique key is also the double-send guard.
 */
export const reportDeliveries = pgTable('report_deliveries', {
  id: uuid('id').primaryKey().defaultRandom(),
  claimToken: uuid('claim_token').notNull().defaultRandom(),
  scheduleId: uuid('schedule_id').references(() => reportSchedules.id, { onDelete: 'set null' }),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  landscapeIdSnapshot: uuid('landscape_id_snapshot'),
  reportPeriodStart: date('report_period_start'),
  reportPeriodEnd: date('report_period_end'),
  reportId: uuid('report_id').references(() => weeklyReports.id, { onDelete: 'set null' }),
  scheduledFor: text('scheduled_for').notNull(),
  formats: jsonb('formats').$type<Array<'pptx' | 'csv'>>().notNull().default([]),
  recipients: jsonb('recipients').$type<string[]>().notNull().default([]),
  includeSlack: boolean('include_slack').notNull().default(false),
  status: text('status').notNull().default('running'),
  attemptCount: integer('attempt_count').notNull().default(1),
  emailStatus: text('email_status').notNull().default('not_requested'),
  emailProviderMessageId: text('provider_message_id'),
  emailError: text('email_error'),
  emailAttemptedAt: timestamp('email_attempted_at', { withTimezone: true }),
  emailFinishedAt: timestamp('email_finished_at', { withTimezone: true }),
  slackStatus: text('slack_status').notNull().default('not_requested'),
  slackError: text('slack_error'),
  slackAttemptedAt: timestamp('slack_attempted_at', { withTimezone: true }),
  slackFinishedAt: timestamp('slack_finished_at', { withTimezone: true }),
  error: text('error'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('report_deliveries_schedule_window_uq').on(t.scheduleId, t.scheduledFor),
  index('report_deliveries_org_time_idx').on(t.orgId, t.startedAt),
]);

/**
 * Vendor-supplied brand-week metrics that predate our own collection.
 *
 * Everything else in this schema is measured by us: posts we fetched, audience
 * readings we took. This table is deliberately separate because these numbers
 * are a third party's arithmetic over a week we never observed, at brand grain
 * rather than channel grain. Keeping them out of `posts` and out of
 * `audience_snapshots` is what stops a vendor's weekly engagement total from
 * being silently mixed into an engagement number the product computed from
 * individual posts, which would make the two impossible to reconcile.
 *
 * `metric` uses the product's own MetricKey vocabulary so a chart can ask for
 * the same name it uses everywhere else. `source` is part of the key so a
 * second vendor, or a corrected re-export, lands beside the original instead
 * of overwriting history.
 */
export const externalBrandMetrics = pgTable('external_brand_metrics', {
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  platform: platformEnum('platform').notNull(),
  /** MetricKey-compatible name, e.g. 'engagementTotal', 'views'. */
  metric: text('metric').notNull(),
  /** First day of the reported period, matching the vendor's week start. */
  periodStart: date('period_start').notNull(),
  /** Length of the reported period; 7 for a vendor week. */
  periodDays: integer('period_days').notNull().default(7),
  value: bigint('value', { mode: 'number' }).notNull(),
  /** Who reported it. Part of the key: vendors are not interchangeable. */
  source: text('source').notNull(),
  capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({
    name: 'external_brand_metrics_pk',
    columns: [t.companyId, t.platform, t.metric, t.periodStart, t.source],
  }),
  index('external_brand_metrics_period_idx').on(t.periodStart),
  check('external_brand_metrics_period_days_ck', sql`${t.periodDays} > 0`),
]);

/**
 * Landscape scoping for tags: which landscapes a tag applies to.
 *
 * No rows means org-wide, which keeps every existing tag's behavior. Rows
 * restrict: a "Sports" beat scoped to the news landscapes never fires on an
 * MLB team's feed, where tagging every post "Sports" is trivially true,
 * analytically useless, and a budget furnace. The junction shape (rather than
 * a single landscape column) is what lets one beat serve several news
 * landscapes without duplicating the tag and splitting its analytics.
 */
export const postTagLandscapes = pgTable('post_tag_landscapes', {
  tagId: uuid('tag_id').notNull().references(() => postTags.id, { onDelete: 'cascade' }),
  landscapeId: uuid('landscape_id').notNull().references(() => landscapes.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ name: 'post_tag_landscapes_pk', columns: [t.tagId, t.landscapeId] }),
  index('post_tag_landscapes_landscape_idx').on(t.landscapeId),
]);

/**
 * Durable AI-tagging state, one row per (org, post).
 *
 * Posts are pooled; taxonomies are per-org, so "has the model read this post"
 * is an org-scoped fact. The row records WHICH taxonomy the answer was for:
 * `taxonomy_fingerprint` hashes the org's AI-eligible tags (id, name,
 * aiPrompt, sorted), and any edit to the taxonomy moves the fingerprint,
 * making every older row stale. The tag cron drains stale rows newest-post
 * first within a daily spend ceiling — that is the entire recompute story,
 * with no invalidation bookkeeping to forget.
 *
 * Assignments themselves stay in post_tag_assignments with source='ai'; this
 * table is only the queue and the audit of what was read when, by which
 * model, against which taxonomy. See docs/AI-TAGGING.md.
 */
export const aiTagState = pgTable('ai_tag_state', {
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  postId: uuid('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  taxonomyFingerprint: text('taxonomy_fingerprint').notNull(),
  model: text('model'),
  status: ingestStatusEnum('status').notNull().default('queued'),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).defaultNow(),
  taggedAt: timestamp('tagged_at', { withTimezone: true }),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ name: 'ai_tag_state_pk', columns: [t.orgId, t.postId] }),
  index('ai_tag_state_org_fingerprint_idx').on(t.orgId, t.taxonomyFingerprint),
  index('ai_tag_state_next_attempt_idx').on(t.nextAttemptAt),
]);

/**
 * Tagging for group posts.
 *
 * Group posts cannot use `ai_tag_state` or `post_tag_assignments`: both carry a
 * foreign key to `posts`, and a group post is not a brand post. It has no
 * company, so it has no landscape, which also means it is not scoped by the
 * landscape rules that shape the brand taxonomy — every AI-eligible tag in the
 * org applies.
 *
 * Everything else is deliberately identical to the brand path: same taxonomy in
 * `post_tags`, same model, same validation. Only the storage differs, so a tag
 * means the same thing on both sides of the product.
 */
export const groupTagState = pgTable('group_tag_state', {
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  groupPostId: uuid('group_post_id').notNull().references(() => groupPosts.id, { onDelete: 'cascade' }),
  taxonomyFingerprint: text('taxonomy_fingerprint').notNull(),
  model: text('model'),
  status: ingestStatusEnum('status').notNull().default('queued'),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).defaultNow(),
  taggedAt: timestamp('tagged_at', { withTimezone: true }),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ name: 'group_tag_state_pk', columns: [t.orgId, t.groupPostId] }),
  index('group_tag_state_next_attempt_idx').on(t.nextAttemptAt),
]);

export const groupPostTagAssignments = pgTable('group_post_tag_assignments', {
  groupPostId: uuid('group_post_id').notNull().references(() => groupPosts.id, { onDelete: 'cascade' }),
  tagId: uuid('tag_id').notNull().references(() => postTags.id, { onDelete: 'cascade' }),
  source: tagSourceEnum('source').notNull().default('ai'),
  confidence: doublePrecision('confidence'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.groupPostId, t.tagId] }),
  index('gpta_tag_idx').on(t.tagId),
]);

/**
 * What the tagger wished it could say.
 *
 * While applying the org's taxonomy, the tagging model may name up to two
 * topics per post that deserve a tag but have none ("Xander Bogaerts",
 * "commercial real estate"). Suggestions are NEVER assignments — they carry
 * no analytical weight and appear on no chart. They are evidence, keyed by
 * normalized label so repeated sightings of the same topic pile up, and the
 * curator pass turns piles into verdicts. This is the drift sensor: a story
 * the taxonomy has no word for shows up here before anyone asks why the
 * charts missed it.
 */
export const tagSuggestions = pgTable('tag_suggestions', {
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  postId: uuid('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  /** The model's words, verbatim, for the audit trail. */
  label: text('label').notNull(),
  /** Lowercased/collapsed key that groups sightings of the same topic. */
  labelNorm: text('label_norm').notNull(),
  status: text('status').notNull().default('open'),
  /** covered | created | rejected — how the curator resolved this sighting. */
  resolution: text('resolution'),
  resolvedTagId: uuid('resolved_tag_id').references(() => postTags.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
}, (t) => [
  primaryKey({ name: 'tag_suggestions_pk', columns: [t.orgId, t.postId, t.labelNorm] }),
  index('tag_suggestions_open_idx').on(t.orgId, t.status, t.labelNorm),
]);

/**
 * Group View: local Facebook groups a newsroom watches for community signal.
 *
 * These are PUBLIC groups. Bright Data's group dataset reads public group
 * posts and cannot reach a members-only group; a private URL registered here
 * settles as `ineligible` rather than being worked around. See
 * docs/GROUP-VIEW.md.
 *
 * Groups are org-private, unlike the pooled brand `channels`: a group one
 * newsroom finds worth watching is that newsroom's editorial choice, and the
 * post records collected from it are stored per-org rather than shared.
 */
export const watchedGroups = pgTable('watched_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  /** The group's public Facebook URL, the collection input. */
  url: text('url').notNull(),
  /** Editor-supplied label, e.g. "Somerville Neighborhood News". */
  name: text('name').notNull(),
  /** Optional grouping, e.g. a town or neighborhood, for roll-ups. */
  area: text('area'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('watched_groups_org_url_idx').on(t.orgId, t.url),
  index('watched_groups_org_active_idx').on(t.orgId, t.active),
]);

/**
 * A post collected from a watched group.
 *
 * Full records are stored, including author identity, because that is the
 * decision the operator made. Display of identity is a separate concern: the
 * Group View surfaces are aggregate by default, and any screen that shows an
 * author name or profile link is gated behind the admin role AND the
 * GROUP_IDENTITIES_VISIBLE flag, so "we collected it" and "anyone browsed it"
 * are distinct facts with distinct controls. `raw` keeps the untouched vendor
 * record for audit.
 */
export const groupPosts = pgTable('group_posts', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  groupId: uuid('group_id').notNull().references(() => watchedGroups.id, { onDelete: 'cascade' }),
  /** Bright Data's stable id for the post, the idempotency key. */
  externalId: text('external_id').notNull(),
  postedAt: timestamp('posted_at', { withTimezone: true }),
  content: text('content'),
  /** Author display name and profile URL, stored, display-gated. */
  authorName: text('author_name'),
  authorProfileUrl: text('author_profile_url'),
  likes: integer('likes').notNull().default(0),
  comments: integer('comments').notNull().default(0),
  shares: integer('shares').notNull().default(0),
  permalink: text('permalink'),
  /** Outbound links found in the post, for distribution analysis. */
  urls: jsonb('urls').notNull().default(sql`'[]'::jsonb`),
  raw: jsonb('raw'),
  collectedAt: timestamp('collected_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('group_posts_dedupe_idx').on(t.orgId, t.groupId, t.externalId),
  index('group_posts_group_time_idx').on(t.groupId, t.postedAt),
]);

/**
 * Durable collection state for one watched group, mirroring the shape proven by
 * channel_collection_state: claim under a lease, settle with an outcome, resume
 * an unfinished Bright Data snapshot by its receipt.
 */
export const groupCollectionState = pgTable('group_collection_state', {
  groupId: uuid('group_id').primaryKey().references(() => watchedGroups.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('idle'),
  /** covered | ineligible | failed | collecting — the last settled outcome. */
  outcome: text('outcome'),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).defaultNow(),
  /** Bright Data snapshot receipt for a run that outlived its invocation. */
  resumeSnapshotId: text('resume_snapshot_id'),
  lastError: text('last_error'),
  lastCollectedAt: timestamp('last_collected_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('group_collection_state_next_idx').on(t.nextAttemptAt),
]);

/**
 * Every record we bought from a metered vendor, and what it cost.
 *
 * This table exists because of a $232 invoice nobody saw coming. The group
 * collector asked for fifty posts per group inside a two-day window, using
 * input fields the dataset silently ignores, and was delivered 57,037 records
 * reaching back to 2018 — per round, every six hours. Nothing in the product
 * knew, because nothing was counting. The vendor's own dashboard was the only
 * place the number existed, and it is a lagging indicator by a day.
 *
 * So a purchase is now written down at the moment it happens, and the collector
 * reads its own recent spend before deciding whether to buy more. A budget that
 * is not measured is a hope, and a runaway scraper outruns hope inside an hour.
 *
 * `records` is what the vendor delivered and billed, which is not the same as
 * what we stored: duplicates we already had still cost money. Both are kept, so
 * a widening gap between them shows up as waste rather than as nothing.
 */
/**
 * Comments under pooled posts. Instagram first; the table is platform-agnostic
 * because the post it hangs off already knows its platform.
 *
 * Pooled, not org-scoped, for the same reason posts are: a comment on a public
 * Boston Globe post is one fact, not one fact per tenant. Author identity is
 * stored because the vendor sends it and deleting it is irreversible, but
 * display is a separate product decision, the same split Group View proved out.
 *
 * Why comments at all: the earliest signal of an emerging theme lives under
 * the posts, not in them. The Lindsay Clancy conspiracy narrative was visible
 * in comment sections roughly two weeks before it broke as a story, and nobody
 * can read fifty comment sections a day. The reader can.
 */
export const postComments = pgTable('post_comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  postId: uuid('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  /** Vendor's stable comment id, the idempotency key. */
  externalId: text('external_id').notNull(),
  authorName: text('author_name'),
  authorUrl: text('author_url'),
  text: text('text'),
  likes: integer('likes').notNull().default(0),
  replies: integer('replies').notNull().default(0),
  commentedAt: timestamp('commented_at', { withTimezone: true }),
  collectedAt: timestamp('collected_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('post_comments_dedupe_idx').on(t.postId, t.externalId),
  index('post_comments_post_time_idx').on(t.postId, t.commentedAt),
]);

/**
 * Durable comment-collection state, one row per post, the fourth copy of the
 * claim-under-lease / settle-with-outcome shape (channels, groups, tagging,
 * now comments). v1 policy is a single pass per post once its comments have
 * had half a day to accrue; a settled post is never bought again.
 */
export const commentCollectionState = pgTable('comment_collection_state', {
  postId: uuid('post_id').primaryKey().references(() => posts.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('idle'),
  /** covered | failed — the last settled outcome. */
  outcome: text('outcome'),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).defaultNow(),
  resumeSnapshotId: text('resume_snapshot_id'),
  lastError: text('last_error'),
  lastCollectedAt: timestamp('last_collected_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('comment_collection_state_next_idx').on(t.nextAttemptAt),
]);

/**
 * One glanceable summary per commented post, written by a model that read the
 * section so the newsroom does not have to. NULL summary is a deliberate
 * verdict: the section had too few text comments to be worth a paragraph, and
 * recording that stops the job from re-judging it every tick.
 */
export const commentSummaries = pgTable('comment_summaries', {
  postId: uuid('post_id').primaryKey().references(() => posts.id, { onDelete: 'cascade' }),
  summary: text('summary'),
  commentsConsidered: integer('comments_considered').notNull().default(0),
  model: text('model'),
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const vendorSpend = pgTable('vendor_spend', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => orgs.id, { onDelete: 'cascade' }),
  /** brightdata, openrouter, and so on. */
  vendor: text('vendor').notNull(),
  /** Dataset or model id, so one runaway source is attributable. */
  resource: text('resource').notNull(),
  /** Free text naming what was collected, e.g. a group name. */
  subject: text('subject'),
  /** Records the vendor delivered, which is what the vendor bills for. */
  records: integer('records').notNull().default(0),
  /** Rows we actually kept. Below `records` when the window overlaps itself. */
  stored: integer('stored').notNull().default(0),
  /** Vendor receipt, for reconciling against their invoice. */
  snapshotId: text('snapshot_id'),
  /**
   * Estimated cost in cents, from a rate we hold in code. Deliberately labelled
   * an estimate: the authoritative number is the vendor's invoice, and a figure
   * we computed ourselves must never be presented as the bill.
   */
  estimatedCents: integer('estimated_cents').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('vendor_spend_window_idx').on(t.vendor, t.createdAt),
]);

/**
 * What drove one day of one story, in words.
 *
 * A bar on a lifecycle chart says a day was big; it cannot say why. These
 * narratives are written by a model that reads every post carrying the tag
 * that day and summarises what moved — the testimony, the ruling, the trade,
 * the storm — so a reader hovering a spike gets the reason rather than a
 * number they must go and investigate.
 *
 * Stored rather than generated on read for three reasons: the same day is
 * re-read by every window that contains it, a page render must not wait on a
 * model, and a day's posts stop changing once they mature, so the answer is
 * stable. `posts_considered` and `engagement_at_write` record what the
 * narrative was based on, which is how staleness is detected when a day is
 * still accruing.
 */
export const storyNarratives = pgTable('story_narratives', {
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  tagId: uuid('tag_id').notNull().references(() => postTags.id, { onDelete: 'cascade' }),
  /** Report-zone bucket this narrative describes. */
  bucketDate: date('bucket_date').notNull(),
  granularity: text('granularity').notNull().default('day'),
  narrative: text('narrative').notNull(),
  postsConsidered: integer('posts_considered').notNull().default(0),
  engagementAtWrite: doublePrecision('engagement_at_write').notNull().default(0),
  model: text('model'),
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ name: 'story_narratives_pk', columns: [t.orgId, t.tagId, t.bucketDate, t.granularity] }),
  index('story_narratives_lookup_idx').on(t.orgId, t.granularity, t.bucketDate),
]);

/**
 * The curator's rulings, one row per label it judged.
 *
 * A stronger model reads a suggestion group (label + evidence posts + the
 * full existing taxonomy) and rules: covered by an existing tag, worth
 * creating (with a drafted name, definition and parent), or rejected as
 * one-off noise. Rulings are the audit trail for every auto-created tag —
 * the evidence column holds the post ids and outlet spread that justified
 * it, so "why does this tag exist" always has an answer.
 */
export const tagProposals = pgTable('tag_proposals', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  labelNorm: text('label_norm').notNull(),
  /** covered | created | rejected | queued (awaiting operator approval). */
  verdict: text('verdict').notNull(),
  name: text('name'),
  definition: text('definition'),
  parentTagId: uuid('parent_tag_id').references(() => postTags.id, { onDelete: 'set null' }),
  coveredByTagId: uuid('covered_by_tag_id').references(() => postTags.id, { onDelete: 'set null' }),
  confidence: doublePrecision('confidence'),
  rationale: text('rationale'),
  supportPosts: integer('support_posts').notNull().default(0),
  supportCompanies: integer('support_companies').notNull().default(0),
  evidence: jsonb('evidence'),
  createdTagId: uuid('created_tag_id').references(() => postTags.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
}, (t) => [
  index('tag_proposals_org_time_idx').on(t.orgId, t.createdAt),
  index('tag_proposals_org_label_idx').on(t.orgId, t.labelNorm),
]);

/**
 * Daily Wikipedia pageviews per article, from the official Wikimedia API.
 *
 * This is LOOKUP ATTENTION, not search volume: how many humans opened the
 * article that day. The API's "user" agent filter excludes bots and spiders —
 * without it, crawler storms register as public interest. Keyed by article
 * title rather than candidate so two races tracking the same person share one
 * series, the same pooling argument the rest of the schema makes. Data is a
 * republication of Wikimedia's own numbers and can be rebuilt from their API
 * at any time; rows exist so charts do not re-fetch a year of history per
 * page load.
 */
export const wikipediaAttention = pgTable('wikipedia_attention', {
  pageTitle: text('page_title').notNull(),
  day: date('day').notNull(),
  views: bigint('views', { mode: 'number' }).notNull(),
  capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ name: 'wikipedia_attention_pk', columns: [t.pageTitle, t.day] }),
  index('wikipedia_attention_day_idx').on(t.day),
]);
