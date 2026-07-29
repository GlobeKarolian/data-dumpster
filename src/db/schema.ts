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
  jsonb, uniqueIndex, index, primaryKey, doublePrecision, date, uuid,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

/* ------------------------------------------------------------------ enums */

export const platformEnum = pgEnum('platform', [
  'facebook', 'instagram', 'twitter', 'youtube', 'tiktok',
  'linkedin', 'bluesky', 'threads', 'reddit', 'rss',
]);

export const postTypeEnum = pgEnum('post_type', [
  'photo', 'video', 'carousel', 'reel', 'short', 'story',
  'text', 'link', 'live', 'poll', 'repost', 'article', 'other',
]);

export const roleEnum = pgEnum('role', ['owner', 'admin', 'editor', 'viewer']);

export const ingestStatusEnum = pgEnum('ingest_status', [
  'queued', 'running', 'succeeded', 'partial', 'failed',
]);

export const modelProviderEnum = pgEnum('model_provider', [
  'anthropic', 'openai', 'google', 'azure_openai',
  'bedrock', 'openai_compatible', 'ollama',
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
 * No email provider is configured for this deployment and no budget decision has
 * been made about one, so an invitation is a link an administrator hands over in
 * Slack or in person. That constraint is the whole design: the token in this row
 * IS the credential. Hence 32 random bytes rather than a sequence, hence an
 * expiry, and hence the single-statement accept in lib/invites.ts.
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

/* ----------------------------------------------------- entities measured */

export const companies = pgTable('companies', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  website: text('website'),
  logoUrl: text('logo_url'),
  /** Free-form classification used for peer grouping, e.g. "metro daily", "public radio". */
  segment: text('segment'),
  color: text('color'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('companies_org_slug_uq').on(t.orgId, t.slug)]);

export const channels = pgTable('channels', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  platform: platformEnum('platform').notNull(),
  /** Public handle, e.g. "bostonglobe". */
  handle: text('handle').notNull(),
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
  uniqueIndex('channels_platform_handle_uq').on(t.companyId, t.platform, t.handle),
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

  /** Raw platform payload, kept for reprocessing without re-fetching. */
  raw: jsonb('raw').$type<Record<string, unknown>>(),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  lastRefreshedAt: timestamp('last_refreshed_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('posts_channel_external_uq').on(t.channelId, t.externalId),
  index('posts_company_posted_idx').on(t.companyId, t.postedAt),
  index('posts_platform_posted_idx').on(t.platform, t.postedAt),
  index('posts_engagement_idx').on(t.postedAt, t.engagementTotal),
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
}, (t) => [primaryKey({ columns: [t.postId, t.capturedAt] })]);

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
}, (t) => [index('ingestion_runs_time_idx').on(t.startedAt)]);

/* ------------------------------------------------------------ relations */

export const orgsRelations = relations(orgs, ({ many }) => ({
  users: many(users), companies: many(companies), landscapes: many(landscapes),
}));

export const companiesRelations = relations(companies, ({ one, many }) => ({
  org: one(orgs, { fields: [companies.orgId], references: [orgs.id] }),
  channels: many(channels), posts: many(posts),
}));

export const channelsRelations = relations(channels, ({ one, many }) => ({
  company: one(companies, { fields: [channels.companyId], references: [companies.id] }),
  posts: many(posts), audience: many(audienceSnapshots),
}));

export const landscapesRelations = relations(landscapes, ({ one, many }) => ({
  org: one(orgs, { fields: [landscapes.orgId], references: [orgs.id] }),
  focusCompany: one(companies, { fields: [landscapes.focusCompanyId], references: [companies.id] }),
  members: many(landscapeCompanies),
}));

export const landscapeCompaniesRelations = relations(landscapeCompanies, ({ one }) => ({
  landscape: one(landscapes, { fields: [landscapeCompanies.landscapeId], references: [landscapes.id] }),
  company: one(companies, { fields: [landscapeCompanies.companyId], references: [companies.id] }),
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
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('weekly_reports_period_uq').on(t.orgId, t.periodStart, t.periodEnd),
  index('weekly_reports_org_idx').on(t.orgId, t.periodEnd),
]);
