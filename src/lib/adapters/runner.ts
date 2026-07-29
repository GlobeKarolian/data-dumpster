/**
 * The ingestion orchestrator.
 *
 * One job: take a channel row, ask its adapter for a window of data, and land
 * that data in Postgres in a way that is safe to run again five minutes later.
 * Everything else in this file exists to serve one of four constraints.
 *
 * 1. **Idempotence is not optional.** Cron overlaps, humans click Refresh, and
 *    a run that dies halfway will be retried. Every write here is an upsert
 *    keyed on something the platform owns, so running twice produces the same
 *    database as running once. The only append-only table is
 *    post_metric_snapshots, and it is keyed on the run's capture timestamp so a
 *    retry within the same run overwrites rather than duplicates.
 *
 * 2. **The Neon HTTP driver has no multi-statement transactions.** Each
 *    statement is its own HTTP round trip, so db.transaction is unavailable.
 *    That rules out "delete then insert" as an atomic pattern and rules out
 *    wrapping a channel's writes in a rollback boundary. The design response is
 *    ordering: posts land first, then everything that references them, and
 *    every dependent write is itself an upsert. A partial failure leaves a
 *    consistent-if-incomplete picture that the next run repairs.
 *
 * 3. **Postgres binds at most 65,535 parameters per statement.** A 300-post
 *    channel would blow that in a single multi-row insert, so every batch is
 *    chunked by column count rather than by a guessed row count.
 *
 * 4. **One bad channel must never take down the batch.** A newsroom watching
 *    fourteen competitors cannot lose the night because one Instagram token
 *    expired. Failures are caught per channel, written to ingestion_runs, and
 *    reported in the summary.
 */
import { and, asc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  audienceSnapshots,
  channels,
  companies,
  ingestionRuns,
  orgs,
  postMetricSnapshots,
  postTagAssignments,
  postTags,
  postedUrls,
  posts,
  platformCredentials,
} from '@/db/schema';
import type { Platform } from '@/lib/types';
import { decrypt } from '@/lib/crypto';
import { getAdapter, hasAdapter } from './registry';
import { matchesRule, type TagRule } from './tagging';
import { computeEngagementTotal, toDayString } from './util/normalize';
import { AdapterError, type ChannelAdapter, type FetchResult, type NormalizedPost } from './types';

/* ----------------------------------------------------------------- knobs */

/**
 * Conservative ceiling on bind parameters per statement. The real Postgres
 * limit is 65,535; staying well under it leaves room for the driver's own
 * parameters and keeps a single HTTP request small enough to be fast.
 */
const MAX_BIND_PARAMS = 8_000;
/** Never send more rows than this in one statement, regardless of width. */
const MAX_CHUNK_ROWS = 500;

/** How far back a channel with no ingest history reaches on its first run. */
const FIRST_RUN_LOOKBACK_DAYS = 30;
/**
 * Overlap re-read on every incremental run.
 *
 * Engagement on social is not immutable: a post keeps collecting likes for days.
 * Starting each run strictly at last_ingested_at would freeze every post's
 * metrics at the moment we first saw it, which would make the velocity curves
 * this product sells actively wrong. Two days of overlap is cheap on the open
 * platforms and is bounded on the metered ones by the adapter's own cursor.
 */
const REFRESH_OVERLAP_DAYS = 2;

const DEFAULT_POST_LIMIT = 500;
const DEFAULT_CONCURRENCY = 4;
/** Assumed network calls per channel run, used to reserve rate-limit budget. */
const ESTIMATED_CALLS_PER_RUN = 4;
/** Longest a worker will wait for rate-limit budget before deferring a channel. */
const MAX_RATE_WAIT_MS = 60_000;

/* ----------------------------------------------------------------- types */

export interface RunChannelOptions {
  /** Overrides the computed window start. */
  since?: Date;
  until?: Date;
  limit?: number;
  /** Fetch and report, write nothing. */
  dryRun?: boolean;
  signal?: AbortSignal;
}

export type ChannelRunStatus = 'succeeded' | 'partial' | 'failed' | 'skipped';

export interface ChannelRunResult {
  channelId: string;
  platform: Platform;
  handle: string;
  companyName: string;
  status: ChannelRunStatus;
  postsUpserted: number;
  snapshotsUpserted: number;
  tagsAssigned: number;
  urlsRecorded: number;
  apiCalls: number;
  durationMs: number;
  hasMore: boolean;
  warnings: string[];
  error?: string;
}

export interface RunAllOptions extends RunChannelOptions {
  platforms?: Platform[];
  companySlug?: string;
  orgId?: string;
  channelIds?: string[];
  concurrency?: number;
  /** Cap on channels attempted in one batch. */
  maxChannels?: number;
}

export interface PlatformSummary {
  attempted: number;
  succeeded: number;
  failed: number;
  skipped: number;
  postsUpserted: number;
}

export interface RunAllSummary {
  attempted: number;
  succeeded: number;
  failed: number;
  skipped: number;
  postsUpserted: number;
  durationMs: number;
  byPlatform: Partial<Record<Platform, PlatformSummary>>;
  results: ChannelRunResult[];
}

/* ------------------------------------------------------------- utilities */

/**
 * Split rows so no statement exceeds the parameter budget.
 *
 * Chunking by row count alone is the bug this avoids: 500 audience snapshots is
 * 2,500 parameters and perfectly safe, while 500 posts is over 12,000 and gets
 * slower with every column anyone adds to the schema.
 */
function chunkRows<T>(rows: T[], columnsPerRow: number): T[][] {
  const perChunk = Math.max(1, Math.min(MAX_CHUNK_ROWS, Math.floor(MAX_BIND_PARAMS / Math.max(1, columnsPerRow))));
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += perChunk) out.push(rows.slice(i, i + perChunk));
  return out;
}

function daysAgo(days: number, from: Date = new Date()): Date {
  return new Date(from.getTime() - days * 86_400_000);
}

function errorMessage(err: unknown): string {
  if (err instanceof AdapterError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Keys the runner injects into the cursor for the adapter's benefit but must
 * never persist. Double underscore marks them; see the Instagram and TikTok
 * adapters, which read __isOwned to decide between an owned and a competitor
 * read path.
 */
function stripEphemeralCursorKeys(cursor: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cursor)) {
    if (k.startsWith('__')) continue;
    out[k] = v;
  }
  return out;
}

/* ----------------------------------------------------------- credentials */

/**
 * Environment fallbacks, documented in .env.example.
 *
 * Per-org credentials in the database always win. These exist so a single-org
 * deployment can be configured entirely from environment variables, which is
 * how this runs on Vercel Cron before anyone has opened the Settings page.
 *
 * Note: META_IG_USER_ID, TIKTOK_ACCESS_TOKEN and TIKTOK_REFRESH_TOKEN are read
 * here but are not yet listed in .env.example. They belong there; see
 * docs/DATA-ACCESS.md.
 */
function envCredentials(platform: Platform): Record<string, string> {
  const pick = (out: Record<string, string>, key: string, value: string | undefined): void => {
    const trimmed = value?.trim();
    if (trimmed) out[key] = trimmed;
  };
  const out: Record<string, string> = {};

  switch (platform) {
    case 'youtube':
      pick(out, 'apiKey', process.env.YOUTUBE_API_KEY);
      break;
    case 'facebook':
      pick(out, 'accessToken', process.env.META_ACCESS_TOKEN);
      pick(out, 'appId', process.env.META_APP_ID);
      pick(out, 'appSecret', process.env.META_APP_SECRET);
      pick(out, 'brightDataApiKey', process.env.BRIGHTDATA_API_KEY);
      break;
    case 'instagram':
      pick(out, 'accessToken', process.env.META_ACCESS_TOKEN);
      pick(out, 'igUserId', process.env.META_IG_USER_ID);
      pick(out, 'ensembleDataToken', process.env.ENSEMBLEDATA_TOKEN);
      pick(out, 'brightDataApiKey', process.env.BRIGHTDATA_API_KEY);
      break;
    case 'twitter':
      pick(out, 'bearerToken', process.env.TWITTER_BEARER_TOKEN);
      pick(out, 'brightDataApiKey', process.env.BRIGHTDATA_API_KEY);
      break;
    case 'tiktok':
      pick(out, 'clientKey', process.env.TIKTOK_CLIENT_KEY);
      pick(out, 'clientSecret', process.env.TIKTOK_CLIENT_SECRET);
      pick(out, 'accessToken', process.env.TIKTOK_ACCESS_TOKEN);
      pick(out, 'refreshToken', process.env.TIKTOK_REFRESH_TOKEN);
      // Competitor reads are served by a purchased vendor rather than TikTok.
      // Without this the credential gate skips every competitor channel before
      // the adapter ever gets a chance to route to the vendor path.
      pick(out, 'ensembleDataToken', process.env.ENSEMBLEDATA_TOKEN);
      pick(out, 'brightDataApiKey', process.env.BRIGHTDATA_API_KEY);
      break;
    case 'linkedin':
      pick(out, 'accessToken', process.env.LINKEDIN_ACCESS_TOKEN);
      break;
    case 'threads':
      // The only route to Threads is purchased. There is no owned path to fall
      // back to, so these keys are the whole credential set for the platform.
      pick(out, 'ensembleDataToken', process.env.ENSEMBLEDATA_TOKEN);
      pick(out, 'brightDataApiKey', process.env.BRIGHTDATA_API_KEY);
      break;
    case 'bluesky':
      pick(out, 'identifier', process.env.BLUESKY_IDENTIFIER);
      pick(out, 'appPassword', process.env.BLUESKY_APP_PASSWORD);
      break;
    default:
      break;
  }
  return out;
}

/**
 * Decrypt one platform_credentials row.
 *
 * The plaintext is normally a JSON object of credential-field key to value,
 * written by encryptJson. A bare string is also accepted and mapped onto the
 * adapter's first required field, because that is what a hand-written seed row
 * or an early migration looks like, and failing an entire org's ingest over an
 * envelope shape would be a poor trade.
 */
function parseCredentialBlob(plaintext: string, adapter: ChannelAdapter): Record<string, string> {
  const trimmed = plaintext.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (isRecord(parsed)) {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === 'string' && v.trim()) out[k] = v.trim();
          else if (typeof v === 'number' || typeof v === 'boolean') out[k] = String(v);
        }
        return out;
      }
    } catch {
      // Fall through: treat it as an opaque secret.
    }
  }

  const primary = adapter.credentialFields.find((f) => f.required) ?? adapter.credentialFields[0];
  return primary ? { [primary.key]: trimmed } : {};
}

/**
 * Every credential this org has for this platform, newest row last so a freshly
 * rotated token wins over a stale one.
 *
 * A credential that will not decrypt is skipped rather than thrown: it usually
 * means ENCRYPTION_KEY was rotated without re-encrypting, and in that case the
 * env fallback may still be able to run the channel.
 */
async function loadCredentials(
  orgId: string,
  platform: Platform,
  adapter: ChannelAdapter,
): Promise<{ credentials: Record<string, string>; warnings: string[] }> {
  const warnings: string[] = [];
  const merged: Record<string, string> = envCredentials(platform);

  const rows = await db
    .select({ encrypted: platformCredentials.encrypted, label: platformCredentials.label, createdAt: platformCredentials.createdAt })
    .from(platformCredentials)
    .where(and(eq(platformCredentials.orgId, orgId), eq(platformCredentials.platform, platform)))
    .orderBy(asc(platformCredentials.createdAt));

  for (const row of rows) {
    let plaintext: string;
    try {
      plaintext = decrypt(row.encrypted);
    } catch (err) {
      warnings.push(
        'A stored ' + platform + ' credential could not be decrypted and was ignored: ' + errorMessage(err),
      );
      continue;
    }
    Object.assign(merged, parseCredentialBlob(plaintext, adapter));
  }

  return { credentials: merged, warnings };
}

/** True when the adapter has what it needs to run at all. */
function hasRequiredCredentials(adapter: ChannelAdapter, credentials: Record<string, string>): boolean {
  if (adapter.worksUnauthenticated) return true;
  const required = adapter.credentialFields.filter((f) => f.required);
  if (required.length === 0) return Object.keys(credentials).length > 0;
  return required.every((f) => Boolean(credentials[f.key]));
}

/* ---------------------------------------------------------- persistence */

/** Upsert one day of audience per channel. Re-running the same day overwrites. */
async function upsertAudience(
  channelId: string,
  audience: FetchResult['audience'],
): Promise<number> {
  if (audience.length === 0) return 0;

  // A single run can legitimately produce two rows for the same day if an
  // adapter reports both a cached and a live figure. Last one wins, and
  // de-duplicating here avoids "ON CONFLICT DO UPDATE cannot affect row a
  // second time", which Postgres raises for duplicate keys inside one statement.
  const byDay = new Map<string, FetchResult['audience'][number]>();
  for (const row of audience) byDay.set(row.day, row);

  const values = Array.from(byDay.values()).map((a) => ({
    channelId,
    day: a.day,
    followers: Math.max(0, Math.round(a.followers)),
    following: typeof a.following === 'number' ? Math.max(0, Math.round(a.following)) : null,
    extra: a.extra ?? {},
    capturedAt: new Date(),
  }));

  let written = 0;
  for (const batch of chunkRows(values, 6)) {
    await db.insert(audienceSnapshots).values(batch).onConflictDoUpdate({
      target: [audienceSnapshots.channelId, audienceSnapshots.day],
      set: {
        followers: sql`excluded.followers`,
        following: sql`excluded.following`,
        extra: sql`excluded.extra`,
        capturedAt: sql`excluded.captured_at`,
      },
    });
    written += batch.length;
  }
  return written;
}

interface FollowerPoint { day: string; followers: number }

/**
 * The follower timeline this channel has on record, oldest first.
 *
 * Loaded once per run and scanned in memory rather than issued as a correlated
 * subquery per post: a 300-post run would otherwise be 300 extra HTTP round
 * trips on the Neon driver.
 */
async function loadFollowerTimeline(channelId: string, fromDay: string, toDay: string): Promise<FollowerPoint[]> {
  const rows = await db
    .select({ day: audienceSnapshots.day, followers: audienceSnapshots.followers })
    .from(audienceSnapshots)
    .where(and(
      eq(audienceSnapshots.channelId, channelId),
      gte(audienceSnapshots.day, fromDay),
      lte(audienceSnapshots.day, toDay),
    ))
    .orderBy(asc(audienceSnapshots.day));
  return rows.map((r) => ({ day: r.day, followers: r.followers }));
}

/**
 * Followers at the moment a post went out.
 *
 * Primary rule: the nearest snapshot at or before the post. That is the honest
 * denominator, and it is what makes engagement rate comparable across accounts
 * of wildly different size.
 *
 * Bootstrap exception: on a channel's very first ingest there is no snapshot
 * older than the posts we just pulled, and a strict reading would zero the
 * headline metric for every historical post forever, since we can never
 * retroactively learn a follower count we did not record. In that case only, the
 * earliest snapshot we do have is used as an approximation. Follower counts move
 * slowly enough that this is a small error, and it is recorded in
 * posts.followers_at_post so the number is never invented at read time.
 */
function followersAt(postedAt: Date, timeline: FollowerPoint[]): number {
  if (timeline.length === 0) return 0;
  const day = toDayString(postedAt);
  let best = 0;
  for (const point of timeline) {
    if (point.day <= day) best = point.followers;
    else break;
  }
  return best > 0 ? best : timeline[0].followers;
}

interface PostRow {
  channelId: string;
  companyId: string;
  platform: Platform;
  externalId: string;
  postedAt: Date;
  type: NormalizedPost['type'];
  text: string | null;
  permalink: string | null;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  durationSec: number | null;
  language: string | null;
  hashtags: string[];
  mentions: string[];
  applause: number;
  conversation: number;
  amplification: number;
  saves: number;
  views: number;
  engagementTotal: number;
  engagementRateByFollower: number;
  engagementRateByView: number | null;
  followersAtPost: number | null;
  raw: Record<string, unknown> | null;
  lastRefreshedAt: Date;
}

/** Columns per post row, used to size the insert batches. */
const POST_COLUMNS = 25;

function toPostRow(
  post: NormalizedPost,
  channelId: string,
  companyId: string,
  platform: Platform,
  timeline: FollowerPoint[],
  now: Date,
): PostRow {
  const engagementTotal = computeEngagementTotal(post);
  const followers = followersAt(post.postedAt, timeline);

  return {
    channelId,
    companyId,
    platform,
    externalId: post.externalId,
    postedAt: post.postedAt,
    type: post.type,
    text: post.text ?? null,
    permalink: post.permalink ?? null,
    mediaUrl: post.mediaUrl ?? null,
    thumbnailUrl: post.thumbnailUrl ?? null,
    durationSec: post.durationSec ?? null,
    language: post.language ?? null,
    hashtags: post.hashtags,
    mentions: post.mentions,
    applause: post.applause,
    conversation: post.conversation,
    amplification: post.amplification,
    saves: post.saves,
    views: post.views,
    engagementTotal,
    // Guarded twice on purpose: a zero follower count is common (hidden
    // subscriber counts on YouTube, a brand-new account) and dividing by it
    // would put Infinity in a leaderboard.
    engagementRateByFollower: followers > 0 ? engagementTotal / followers : 0,
    engagementRateByView: post.views > 0 ? engagementTotal / post.views : null,
    followersAtPost: followers > 0 ? followers : null,
    raw: post.raw ?? null,
    lastRefreshedAt: now,
  };
}

/**
 * Upsert posts and hand back their database ids.
 *
 * ON CONFLICT DO UPDATE, not DO NOTHING: the whole point of re-reading a window
 * is that engagement counts moved. RETURNING gives back conflicting rows too,
 * which is what makes the id map complete without a second SELECT.
 */
async function upsertPosts(rows: PostRow[]): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  if (rows.length === 0) return ids;

  // De-duplicate within the run: two pages of an adapter's feed occasionally
  // overlap, and Postgres refuses to update the same row twice in one statement.
  const byExternalId = new Map<string, PostRow>();
  for (const row of rows) byExternalId.set(row.externalId, row);

  for (const batch of chunkRows(Array.from(byExternalId.values()), POST_COLUMNS)) {
    const returned = await db.insert(posts).values(batch).onConflictDoUpdate({
      target: [posts.channelId, posts.externalId],
      set: {
        postedAt: sql`excluded.posted_at`,
        type: sql`excluded.type`,
        text: sql`excluded.text`,
        permalink: sql`excluded.permalink`,
        mediaUrl: sql`excluded.media_url`,
        thumbnailUrl: sql`excluded.thumbnail_url`,
        durationSec: sql`excluded.duration_sec`,
        language: sql`excluded.language`,
        hashtags: sql`excluded.hashtags`,
        mentions: sql`excluded.mentions`,
        applause: sql`excluded.applause`,
        conversation: sql`excluded.conversation`,
        amplification: sql`excluded.amplification`,
        saves: sql`excluded.saves`,
        views: sql`excluded.views`,
        engagementTotal: sql`excluded.engagement_total`,
        engagementRateByFollower: sql`excluded.engagement_rate_by_follower`,
        engagementRateByView: sql`excluded.engagement_rate_by_view`,
        followersAtPost: sql`excluded.followers_at_post`,
        raw: sql`excluded.raw`,
        lastRefreshedAt: sql`excluded.last_refreshed_at`,
      },
    }).returning({ id: posts.id, externalId: posts.externalId });

    for (const row of returned) ids.set(row.externalId, row.id);
  }

  return ids;
}

/**
 * Append one metrics observation per post.
 *
 * This table is what makes engagement velocity recoverable: posts holds only
 * the latest numbers, so without a snapshot per run there is no way to answer
 * "how fast did this take off" after the fact. The primary key is
 * (post_id, captured_at) and captured_at is the run's start instant, so a
 * retried run overwrites its own row instead of laying down a duplicate.
 */
async function insertMetricSnapshots(
  postRows: PostRow[],
  ids: Map<string, string>,
  capturedAt: Date,
): Promise<number> {
  const values = postRows
    .map((row) => {
      const postId = ids.get(row.externalId);
      if (!postId) return undefined;
      return {
        postId,
        capturedAt,
        applause: row.applause,
        conversation: row.conversation,
        amplification: row.amplification,
        saves: row.saves,
        views: row.views,
        engagementTotal: row.engagementTotal,
      };
    })
    .filter((v): v is NonNullable<typeof v> => v !== undefined);

  if (values.length === 0) return 0;

  let written = 0;
  for (const batch of chunkRows(values, 8)) {
    await db.insert(postMetricSnapshots).values(batch).onConflictDoUpdate({
      target: [postMetricSnapshots.postId, postMetricSnapshots.capturedAt],
      set: {
        applause: sql`excluded.applause`,
        conversation: sql`excluded.conversation`,
        amplification: sql`excluded.amplification`,
        saves: sql`excluded.saves`,
        views: sql`excluded.views`,
        engagementTotal: sql`excluded.engagement_total`,
      },
    });
    written += batch.length;
  }
  return written;
}

/** Tracking parameters that change nothing about where a link points. */
const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|igshid$|mc_cid$|mc_eid$|s_campaign$|ref$|ref_src$|s$|t$)/i;

interface UrlRow {
  postId: string;
  companyId: string;
  url: string;
  canonicalUrl: string | null;
  domain: string;
  pathSegments: string[];
}

/**
 * Canonicalise for grouping, keep the original for linking.
 *
 * Two posts pointing at the same article with different campaign tags are the
 * same story, and a posted-URL leaderboard that treats them as two rows is
 * useless. The raw URL is still stored so the UI can link to exactly what was
 * posted.
 */
function canonicalise(raw: string): { url: URL; canonical: string } | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;

  const canonical = new URL(url.toString());
  canonical.hash = '';
  for (const key of Array.from(canonical.searchParams.keys())) {
    if (TRACKING_PARAMS.test(key)) canonical.searchParams.delete(key);
  }
  canonical.hostname = canonical.hostname.toLowerCase().replace(/^www\./, '');
  if (canonical.pathname.length > 1) canonical.pathname = canonical.pathname.replace(/\/+$/, '');

  return { url, canonical: canonical.toString() };
}

/**
 * Replace the URL rows for the posts we just touched.
 *
 * posted_urls has no unique constraint to upsert against, so idempotence comes
 * from delete-then-insert scoped to the affected post ids. Without a
 * transaction there is a window where a post has no URLs; it is measured in
 * milliseconds, it only affects posts being refreshed, and the alternative
 * (accumulating a duplicate row set on every run) would corrupt every
 * posted-URL count in the product.
 */
async function replacePostedUrls(
  normalized: NormalizedPost[],
  ids: Map<string, string>,
  companyId: string,
): Promise<number> {
  const touched = normalized
    .map((p) => ids.get(p.externalId))
    .filter((id): id is string => id !== undefined);
  if (touched.length === 0) return 0;

  for (const batch of chunkRows(touched, 1)) {
    await db.delete(postedUrls).where(inArray(postedUrls.postId, batch));
  }

  const values: UrlRow[] = [];
  for (const post of normalized) {
    const postId = ids.get(post.externalId);
    if (!postId) continue;
    const seen = new Set<string>();
    for (const rawUrl of post.urls) {
      const parsed = canonicalise(rawUrl);
      if (!parsed) continue;
      if (seen.has(parsed.canonical)) continue;
      seen.add(parsed.canonical);
      values.push({
        postId,
        companyId,
        url: rawUrl,
        canonicalUrl: parsed.canonical,
        domain: parsed.url.hostname.toLowerCase().replace(/^www\./, ''),
        pathSegments: parsed.url.pathname.split('/').filter(Boolean).slice(0, 10),
      });
    }
  }

  if (values.length === 0) return 0;

  let written = 0;
  for (const batch of chunkRows(values, 6)) {
    await db.insert(postedUrls).values(batch);
    written += batch.length;
  }
  return written;
}

/**
 * Evaluate every rule-bearing tag in the org against this run's posts.
 *
 * Rules are re-evaluated on every run rather than only for new posts, because a
 * tag created today should attach itself to the posts that arrive in the same
 * window as the edit. ON CONFLICT DO NOTHING is deliberate: if a human already
 * assigned this tag by hand, that assignment carries source 'manual' and must
 * not be silently demoted to 'rule'.
 */
async function applyTagRules(
  orgId: string,
  platform: Platform,
  normalized: NormalizedPost[],
  ids: Map<string, string>,
): Promise<number> {
  if (normalized.length === 0) return 0;

  const tags = await db
    .select({ id: postTags.id, rule: postTags.rule })
    .from(postTags)
    .where(and(eq(postTags.orgId, orgId), sql`${postTags.rule} is not null`));

  const withRules = tags.filter((t): t is { id: string; rule: TagRule } => t.rule !== null);
  if (withRules.length === 0) return 0;

  const values: { postId: string; tagId: string; source: 'rule' }[] = [];
  for (const post of normalized) {
    const postId = ids.get(post.externalId);
    if (!postId) continue;
    for (const tag of withRules) {
      const matched = matchesRule(tag.rule, {
        text: post.text,
        hashtags: post.hashtags,
        mentions: post.mentions,
        urls: post.urls,
        platform,
        type: post.type,
      });
      if (matched) values.push({ postId, tagId: tag.id, source: 'rule' });
    }
  }

  if (values.length === 0) return 0;

  let written = 0;
  for (const batch of chunkRows(values, 3)) {
    await db.insert(postTagAssignments).values(batch).onConflictDoNothing({
      target: [postTagAssignments.postId, postTagAssignments.tagId],
    });
    written += batch.length;
  }
  return written;
}

/* ------------------------------------------------------- channel loading */

interface ChannelContext {
  channelId: string;
  platform: Platform;
  handle: string;
  externalId: string | null;
  isOwned: boolean;
  cursor: Record<string, unknown>;
  lastIngestedAt: Date | null;
  companyId: string;
  companyName: string;
  companySlug: string;
  orgId: string;
}

const CHANNEL_SELECTION = {
  channelId: channels.id,
  platform: channels.platform,
  handle: channels.handle,
  externalId: channels.externalId,
  isOwned: channels.isOwned,
  cursor: channels.cursor,
  lastIngestedAt: channels.lastIngestedAt,
  companyId: companies.id,
  companyName: companies.name,
  companySlug: companies.slug,
  orgId: orgs.id,
} as const;

async function loadChannel(channelId: string): Promise<ChannelContext | undefined> {
  const rows = await db
    .select(CHANNEL_SELECTION)
    .from(channels)
    .innerJoin(companies, eq(channels.companyId, companies.id))
    .innerJoin(orgs, eq(companies.orgId, orgs.id))
    .where(eq(channels.id, channelId))
    .limit(1);
  return rows[0];
}

/** Record the outcome of a run. Never throws: a failed audit write must not mask a failed ingest. */
async function recordRun(
  channel: Pick<ChannelContext, 'channelId' | 'platform'>,
  result: Omit<ChannelRunResult, 'channelId' | 'platform' | 'handle' | 'companyName'>,
  startedAt: Date,
): Promise<void> {
  const status = result.status === 'skipped'
    ? 'failed'
    : result.status === 'partial' ? 'partial' : result.status === 'failed' ? 'failed' : 'succeeded';

  try {
    await db.insert(ingestionRuns).values({
      channelId: channel.channelId,
      platform: channel.platform,
      status,
      startedAt,
      finishedAt: new Date(startedAt.getTime() + result.durationMs),
      postsUpserted: result.postsUpserted,
      snapshotsUpserted: result.snapshotsUpserted,
      apiCalls: result.apiCalls,
      error: result.error ?? null,
      detail: {
        durationMs: result.durationMs,
        warnings: result.warnings,
        hasMore: result.hasMore,
        tagsAssigned: result.tagsAssigned,
        urlsRecorded: result.urlsRecorded,
        outcome: result.status,
      },
    });
  } catch {
    // The run itself already happened; losing its audit row is not worth
    // failing over, and the caller still gets the result.
  }
}

/* --------------------------------------------------------- the main path */

/**
 * Ingest one channel end to end.
 *
 * Ordering is load-bearing. Audience lands before posts because posts need a
 * follower denominator; posts land before snapshots, URLs and tags because all
 * three reference post ids; the channel cursor is written last so a crash
 * anywhere earlier means the next run re-reads the same window rather than
 * skipping it. With no transaction available, "re-read on failure" is the only
 * safe direction to fail in.
 */
export async function runChannelIngest(
  channelId: string,
  opts: RunChannelOptions = {},
): Promise<ChannelRunResult> {
  const startedAt = new Date();
  const channel = await loadChannel(channelId);

  if (!channel) {
    return {
      channelId,
      platform: 'rss',
      handle: '',
      companyName: '',
      status: 'failed',
      postsUpserted: 0, snapshotsUpserted: 0, tagsAssigned: 0, urlsRecorded: 0,
      apiCalls: 0, durationMs: Date.now() - startedAt.getTime(), hasMore: false,
      warnings: [],
      error: 'No channel with id ' + channelId,
    };
  }

  const base = {
    channelId: channel.channelId,
    platform: channel.platform,
    handle: channel.handle,
    companyName: channel.companyName,
  };

  let apiCalls = 0;
  const warnings: string[] = [];
  const fail = async (message: string, status: ChannelRunStatus = 'failed'): Promise<ChannelRunResult> => {
    const partial = {
      status,
      postsUpserted: 0, snapshotsUpserted: 0, tagsAssigned: 0, urlsRecorded: 0,
      apiCalls, durationMs: Date.now() - startedAt.getTime(), hasMore: false,
      warnings, error: message,
    };
    if (!opts.dryRun) await recordRun(channel, partial, startedAt);
    return { ...base, ...partial };
  };

  let adapter: ChannelAdapter;
  try {
    adapter = getAdapter(channel.platform);
  } catch (err) {
    return fail(errorMessage(err));
  }

  const { credentials, warnings: credentialWarnings } = await loadCredentials(
    channel.orgId, channel.platform, adapter,
  );
  warnings.push(...credentialWarnings);

  if (!hasRequiredCredentials(adapter, credentials)) {
    const missing = adapter.credentialFields.filter((f) => f.required && !credentials[f.key]).map((f) => f.key);
    return fail(
      'No usable credentials for ' + adapter.displayName + '. Missing: '
      + (missing.length > 0 ? missing.join(', ') : 'all fields') + '.',
      'skipped',
    );
  }

  // Incremental by default, with deliberate overlap so engagement counts on
  // recent posts keep moving. A caller-supplied window always wins.
  const until = opts.until ?? new Date();
  const since = opts.since
    ?? (channel.lastIngestedAt
      ? daysAgo(REFRESH_OVERLAP_DAYS, channel.lastIngestedAt)
      : daysAgo(FIRST_RUN_LOOKBACK_DAYS, until));

  let fetched: FetchResult;
  try {
    fetched = await adapter.fetch({
      handle: channel.handle,
      externalId: channel.externalId,
      // __isOwned is read by the Instagram, TikTok and LinkedIn adapters to
      // choose between an owned and a competitor read path. It is stripped
      // before the cursor is persisted.
      cursor: { ...channel.cursor, __isOwned: channel.isOwned },
      since,
      until,
      credentials,
      limit: opts.limit ?? DEFAULT_POST_LIMIT,
      onApiCall: () => { apiCalls++; },
      signal: opts.signal,
    });
  } catch (err) {
    return fail(errorMessage(err));
  }

  warnings.push(...(fetched.warnings ?? []));

  if (opts.dryRun) {
    return {
      ...base,
      status: 'succeeded',
      postsUpserted: fetched.posts.length,
      snapshotsUpserted: fetched.audience.length,
      tagsAssigned: 0,
      urlsRecorded: fetched.posts.reduce((n, p) => n + p.urls.length, 0),
      apiCalls,
      durationMs: Date.now() - startedAt.getTime(),
      hasMore: fetched.hasMore ?? false,
      warnings,
    };
  }

  let snapshotsUpserted = 0;
  let postsUpserted = 0;
  let tagsAssigned = 0;
  let urlsRecorded = 0;
  let status: ChannelRunStatus = 'succeeded';

  try {
    snapshotsUpserted = await upsertAudience(channel.channelId, fetched.audience);

    if (fetched.posts.length > 0) {
      const days = fetched.posts.map((p) => toDayString(p.postedAt)).sort();
      const timeline = await loadFollowerTimeline(
        channel.channelId,
        // Reach back beyond the oldest post so a channel ingested last month
        // still finds a denominator for a post from the start of this window.
        toDayString(daysAgo(FIRST_RUN_LOOKBACK_DAYS, new Date(days[0] + 'T00:00:00Z'))),
        toDayString(until),
      );

      const rows = fetched.posts.map((p) => toPostRow(
        p, channel.channelId, channel.companyId, channel.platform, timeline, startedAt,
      ));

      const ids = await upsertPosts(rows);
      postsUpserted = ids.size;

      snapshotsUpserted += await insertMetricSnapshots(rows, ids, startedAt);
      urlsRecorded = await replacePostedUrls(fetched.posts, ids, channel.companyId);
      tagsAssigned = await applyTagRules(channel.orgId, channel.platform, fetched.posts, ids);
    }
  } catch (err) {
    // Some writes may have landed. The run is marked partial rather than
    // failed, the cursor is deliberately NOT advanced, and the next run
    // re-reads the same window and completes the missing writes.
    const message = errorMessage(err);
    const partial = {
      status: 'partial' as ChannelRunStatus,
      postsUpserted, snapshotsUpserted, tagsAssigned, urlsRecorded, apiCalls,
      durationMs: Date.now() - startedAt.getTime(),
      hasMore: fetched.hasMore ?? false,
      warnings,
      error: message,
    };
    await recordRun(channel, partial, startedAt);
    return { ...base, ...partial };
  }

  // Cursor and watermark last, so any failure above leaves the window unclaimed.
  try {
    const mergedCursor = stripEphemeralCursorKeys({ ...channel.cursor, ...(fetched.cursor ?? {}) });
    const profile = fetched.profile;
    await db.update(channels).set({
      cursor: mergedCursor,
      lastIngestedAt: startedAt,
      ...(profile?.externalId ? { externalId: profile.externalId } : {}),
      ...(profile?.profileUrl ? { profileUrl: profile.profileUrl } : {}),
      ...(profile?.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
    }).where(eq(channels.id, channel.channelId));
  } catch (err) {
    status = 'partial';
    warnings.push('Data landed but the channel cursor could not be saved: ' + errorMessage(err));
  }

  const result = {
    status,
    postsUpserted, snapshotsUpserted, tagsAssigned, urlsRecorded, apiCalls,
    durationMs: Date.now() - startedAt.getTime(),
    hasMore: fetched.hasMore ?? false,
    warnings,
  };
  await recordRun(channel, result, startedAt);
  return { ...base, ...result };
}

/* ------------------------------------------------------- batch scheduling */

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0) { resolve(); return; }
    const timer = setTimeout(() => { cleanup(); resolve(); }, ms);
    const onAbort = () => { cleanup(); resolve(); };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * A token bucket per platform, sized from the adapter's declared rateLimit.
 *
 * Why this rather than a fixed delay: the quotas differ by four orders of
 * magnitude. Bluesky allows 3,000 calls per 5 minutes and should never wait;
 * X on the Basic tier allows 5 calls per 15 minutes and must. One mechanism
 * parameterised by the adapter's own declaration handles both, and an adapter
 * author only has to state the truth about their platform.
 *
 * Channels whose budget will not arrive within MAX_RATE_WAIT_MS are deferred
 * rather than queued: a nightly batch that blocks for 40 minutes on one
 * platform is worse than one that skips four X channels and picks them up on
 * the next pass, because the staleness ordering will put them first.
 */
class RateGate {
  private tokens: number;
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private lastRefill = Date.now();

  constructor(callsPerWindow: number, windowSeconds: number) {
    this.capacity = Math.max(1, callsPerWindow);
    this.tokens = this.capacity;
    this.refillPerMs = this.capacity / Math.max(1, windowSeconds * 1000);
  }

  private refill(): void {
    const now = Date.now();
    this.tokens = Math.min(this.capacity, this.tokens + (now - this.lastRefill) * this.refillPerMs);
    this.lastRefill = now;
  }

  /** Milliseconds until `cost` tokens exist. 0 when they already do. */
  waitFor(cost: number): number {
    this.refill();
    const need = Math.min(cost, this.capacity) - this.tokens;
    return need <= 0 ? 0 : Math.ceil(need / this.refillPerMs);
  }

  take(cost: number): void {
    this.refill();
    this.tokens = Math.max(0, this.tokens - cost);
  }
}

interface DueChannel {
  channelId: string;
  platform: Platform;
  handle: string;
  companyName: string;
}

/**
 * Channels to consider, staleest first.
 *
 * NULLS FIRST is the important part: a channel that has never been ingested is
 * infinitely stale and must lead the queue, otherwise adding a competitor to a
 * landscape produces an empty column until every existing channel has been
 * refreshed.
 */
async function selectDueChannels(opts: RunAllOptions): Promise<DueChannel[]> {
  const filters = [eq(channels.active, true)];
  if (opts.platforms && opts.platforms.length > 0) filters.push(inArray(channels.platform, opts.platforms));
  if (opts.channelIds && opts.channelIds.length > 0) filters.push(inArray(channels.id, opts.channelIds));
  if (opts.companySlug) filters.push(eq(companies.slug, opts.companySlug));
  if (opts.orgId) filters.push(eq(orgs.id, opts.orgId));

  const rows = await db
    .select({
      channelId: channels.id,
      platform: channels.platform,
      handle: channels.handle,
      companyName: companies.name,
    })
    .from(channels)
    .innerJoin(companies, eq(channels.companyId, companies.id))
    .innerJoin(orgs, eq(companies.orgId, orgs.id))
    .where(and(...filters))
    .orderBy(sql`${channels.lastIngestedAt} asc nulls first`, asc(channels.id))
    .limit(opts.maxChannels ?? 1_000);

  return rows;
}

function emptyPlatformSummary(): PlatformSummary {
  return { attempted: 0, succeeded: 0, failed: 0, skipped: 0, postsUpserted: 0 };
}

function skippedResult(channel: DueChannel, reason: string): ChannelRunResult {
  return {
    ...channel,
    status: 'skipped',
    postsUpserted: 0, snapshotsUpserted: 0, tagsAssigned: 0, urlsRecorded: 0,
    apiCalls: 0, durationMs: 0, hasMore: false,
    warnings: [], error: reason,
  };
}

/**
 * Run every due channel with bounded concurrency.
 *
 * The pool is hand-rolled rather than pulled from a dependency because it is
 * fifteen lines and the semantics have to be exact: workers pull from a shared
 * index, a channel failure is absorbed into a result rather than rejecting the
 * pool, and the pool drains completely even when every channel fails. A library
 * that rejects on first error would defeat the entire point.
 */
export async function runAllDue(opts: RunAllOptions = {}): Promise<RunAllSummary> {
  const startedAt = Date.now();
  const candidates = await selectDueChannels(opts);
  const results: ChannelRunResult[] = [];

  // Adapter presence is decided once per platform, not once per channel.
  const gates = new Map<Platform, RateGate>();
  const credentialCache = new Map<string, boolean>();

  const runnable: DueChannel[] = [];
  for (const channel of candidates) {
    if (!hasAdapter(channel.platform)) {
      results.push(skippedResult(channel, 'No adapter is implemented for ' + channel.platform + '.'));
      continue;
    }
    const adapter = getAdapter(channel.platform);
    if (!gates.has(channel.platform)) {
      gates.set(channel.platform, new RateGate(adapter.rateLimit.callsPerWindow, adapter.rateLimit.windowSeconds));
    }
    runnable.push(channel);
  }

  /**
   * Credential availability is checked before dispatch so a platform with no
   * token costs nothing: no worker slot, no rate-limit budget, no ingestion_runs
   * row for something that was never attempted. The check is memoised per
   * org-platform pair because a landscape typically has many channels on the
   * same platform under one org.
   */
  const canRun = async (channel: DueChannel): Promise<string | undefined> => {
    const adapter = getAdapter(channel.platform);
    if (adapter.worksUnauthenticated) return undefined;

    const context = await loadChannel(channel.channelId);
    if (!context) return 'Channel disappeared before it could run.';

    const cacheKey = context.orgId + ':' + channel.platform;
    const cached = credentialCache.get(cacheKey);
    if (cached === false) return 'No credentials configured for ' + adapter.displayName + '.';
    if (cached === true) return undefined;

    const { credentials } = await loadCredentials(context.orgId, channel.platform, adapter);
    const ok = hasRequiredCredentials(adapter, credentials);
    credentialCache.set(cacheKey, ok);
    return ok ? undefined : 'No credentials configured for ' + adapter.displayName + '.';
  };

  let cursor = 0;
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? DEFAULT_CONCURRENCY, Math.max(1, runnable.length)));

  const worker = async (): Promise<void> => {
    for (;;) {
      if (opts.signal?.aborted) return;
      const index = cursor++;
      if (index >= runnable.length) return;
      const channel = runnable[index];

      const blocked = await canRun(channel);
      if (blocked) {
        results.push(skippedResult(channel, blocked));
        continue;
      }

      const gate = gates.get(channel.platform);
      if (gate) {
        const wait = gate.waitFor(ESTIMATED_CALLS_PER_RUN);
        if (wait > MAX_RATE_WAIT_MS) {
          results.push(skippedResult(
            channel,
            'Deferred: ' + channel.platform + ' rate budget is exhausted for roughly '
            + String(Math.ceil(wait / 1000)) + 's. It will lead the next run.',
          ));
          continue;
        }
        if (wait > 0) await sleep(wait, opts.signal);
        gate.take(ESTIMATED_CALLS_PER_RUN);
      }

      try {
        const result = await runChannelIngest(channel.channelId, {
          since: opts.since, until: opts.until, limit: opts.limit,
          dryRun: opts.dryRun, signal: opts.signal,
        });
        // Charge the gate for what the run actually cost, not the estimate.
        gate?.take(Math.max(0, result.apiCalls - ESTIMATED_CALLS_PER_RUN));
        results.push(result);
      } catch (err) {
        // runChannelIngest is written not to throw, so this is the belt to its
        // braces: an unexpected throw from the driver must not kill the pool.
        results.push({
          ...channel,
          status: 'failed',
          postsUpserted: 0, snapshotsUpserted: 0, tagsAssigned: 0, urlsRecorded: 0,
          apiCalls: 0, durationMs: 0, hasMore: false,
          warnings: [], error: errorMessage(err),
        });
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const byPlatform: Partial<Record<Platform, PlatformSummary>> = {};
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  let postsUpserted = 0;

  for (const result of results) {
    const bucket = byPlatform[result.platform] ?? emptyPlatformSummary();
    bucket.attempted++;
    bucket.postsUpserted += result.postsUpserted;
    postsUpserted += result.postsUpserted;

    if (result.status === 'skipped') { bucket.skipped++; skipped++; }
    else if (result.status === 'failed') { bucket.failed++; failed++; }
    else { bucket.succeeded++; succeeded++; }

    byPlatform[result.platform] = bucket;
  }

  return {
    // "Attempted" counts channels we actually tried, which is the number an
    // operator cares about; skipped channels are reported separately so a
    // missing token never looks like a failure.
    attempted: succeeded + failed,
    succeeded,
    failed,
    skipped,
    postsUpserted,
    durationMs: Date.now() - startedAt,
    byPlatform,
    results,
  };
}
