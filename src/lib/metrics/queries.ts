/**
 * Data Dumpster analytics query engine -- the only place in the app that turns a
 * question into SQL.
 *
 * Three rules govern everything below.
 *
 * 1. AGGREGATE IN POSTGRES, NOT IN NODE. A busy landscape is tens of thousands of
 *    posts per window. Every function here pushes its GROUP BY into the database and
 *    brings back at most (companies x platforms) or (companies x buckets) rows -- a
 *    few hundred -- which are then folded into the shapes the contract asks for.
 *    Nothing in this file ever streams a post table into JavaScript to reduce it.
 *
 * 2. EVERY QUERY IS ORG-SCOPED. `resolveScope` turns a landscapeId (+ optional
 *    orgId guard) into a verified member list, and every downstream statement is
 *    restricted to that explicit list of company ids. A caller cannot reach another
 *    tenant's rows even by guessing a landscape id, because the landscape lookup
 *    itself is filtered by org.
 *
 * 3. AN HONEST BLANK BEATS A CONFIDENT LIE. Percent changes against a zero baseline
 *    are null, not Infinity. Rates with a zero denominator are null or zero, never
 *    NaN. Anything we could not measure is reported as a caveat rather than silently
 *    folded into an average.
 *
 * Index notes: the post-side filters are written as `company_id IN (...) AND
 * posted_at BETWEEN ...` so Postgres can use `posts_company_posted_idx`
 * (company_id, posted_at). Platform-only sweeps hit `posts_platform_posted_idx`,
 * and the "top posts" ordering rides `posts_engagement_idx` (posted_at,
 * engagement_total). Audience reads use the `audience_snapshots` primary key
 * (channel_id, day). Tag lookups use `pta_tag_idx`.
 */
import { sql, type SQL } from 'drizzle-orm';
import { db } from '@/db';
import {
  PLATFORM_LABELS,
  type AnalyticsQuery,
  type CompanyRef,
  type DateRange,
  type Granularity,
  type MetricKey,
  type MetricRow,
  type Paged,
  type Platform,
  type PostType,
  type TimeSeriesPoint,
} from '@/lib/types';
import { autoGranularity, daysIn, parseLocalDay, previousRange, toDayString, addZoneDays, endOfZoneMonth, startOfZoneDay } from '@/lib/dates';
import { changeIsRounded } from './source-rounding';
import type {
  FactSheet,
  HeadlineStat,
  MetricsApi,
  PostDetailDto,
  PostDto,
  PostTypeRow,
  PostingCadenceCell,
  PostsQuery,
  SortKey,
  SummaryResult,
  TagRow,
  TopPostsQuery,
  TimeSeriesResult,
  UrlRow,
} from './contract';

/* ------------------------------------------------------------------ scope */

/**
 * Every public function takes the contract's query shape plus an optional `orgId`.
 * When present it is enforced as a hard guard on the landscape lookup; when absent
 * the org is derived from the landscape itself. Optional-ness keeps these
 * assignable to `MetricsApi`, whose signatures the contract fixes.
 */
export type Scoped<Q> = Q & { orgId?: string };

interface Scope {
  orgId: string;
  landscapeId: string;
  landscapeName: string;
  focusCompanyId: string | null;
  /** Landscape members, already narrowed by `companyIds` if the caller passed one. */
  companies: CompanyRef[];
  companyIds: string[];
  byId: Map<string, CompanyRef>;
  /** All members regardless of the companyIds filter -- needed for landscape totals. */
  allCompanyIds: string[];
}

type ScopeRow = {
  landscape_id: string;
  landscape_name: string;
  org_id: string;
  focus_company_id: string | null;
  company_id: string | null;
  company_name: string | null;
  company_slug: string | null;
  logo_url: string | null;
  color: string | null;
  segment: string | null;
};

/**
 * One round trip resolves tenancy, membership and company metadata. Doing this up
 * front means the analytical statements that follow never have to join `landscapes`
 * or re-check `org_id` -- they filter on a list of ids that has already been proven
 * to belong to the caller's org.
 */
async function resolveScope(q: Scoped<AnalyticsQuery>): Promise<Scope> {
  /*
   * The org guard is mandatory. It used to be conditional on q.orgId being
   * present, which meant a caller who forgot it got a query scoped by nothing
   * but a landscape id from a URL. Every call site does pass it today, and one
   * of them had to be fixed once already; a tenancy check that silently
   * degrades to no check is a footgun aimed at the next person.
   */
  if (!q.orgId) {
    throw new Error('resolveScope requires an orgId. Scoping a landscape by id alone is '
      + 'not a tenancy boundary.');
  }
  const orgGuard = sql` AND l.org_id = ${q.orgId}::uuid`;
  // The guarded landscape and its membership rows are the tenancy boundary.
  // companies.org_id records who added a pooled company and must not filter it.
  const { rows } = await db.execute<ScopeRow>(sql`
    SELECT l.id            AS landscape_id,
           l.name          AS landscape_name,
           l.org_id        AS org_id,
           l.focus_company_id,
           c.id            AS company_id,
           c.name          AS company_name,
           c.slug          AS company_slug,
           c.logo_url,
           c.color,
           c.segment
      FROM landscapes l
      LEFT JOIN landscape_companies lc ON lc.landscape_id = l.id
      LEFT JOIN companies c ON c.id = lc.company_id
     WHERE l.id = ${q.landscapeId}::uuid${orgGuard}
     ORDER BY lc.sort_order NULLS LAST, c.name
  `);

  if (rows.length === 0) {
    throw new Error(
      `Landscape ${q.landscapeId} was not found in this organization. ` +
      'This is a tenancy guard, not a missing-data condition.',
    );
  }

  const head = rows[0];
  const all: CompanyRef[] = [];
  for (const r of rows) {
    if (!r.company_id || !r.company_name || !r.company_slug) continue;
    all.push({
      id: r.company_id,
      name: r.company_name,
      slug: r.company_slug,
      logoUrl: r.logo_url,
      color: r.color,
      segment: r.segment,
    });
  }

  const requested = q.companyIds && q.companyIds.length > 0 ? new Set(q.companyIds) : null;
  const companies = requested ? all.filter((c) => requested.has(c.id)) : all;

  return {
    orgId: head.org_id,
    landscapeId: head.landscape_id,
    landscapeName: head.landscape_name,
    focusCompanyId: head.focus_company_id,
    companies,
    companyIds: companies.map((c) => c.id),
    byId: new Map(companies.map((c) => [c.id, c])),
    allCompanyIds: all.map((c) => c.id),
  };
}

/**
 * Resolve one organization-private landscape membership without exposing its
 * observations or relying on the globally pooled company attribution field.
 * Reports use this to mark the brands that belong to the BGM portfolio even
 * when the report itself is scoped to the wider Boston News Market landscape.
 */
export async function getLandscapeCompanyIdsBySlug(
  orgId: string,
  slug: string,
): Promise<string[]> {
  const { rows } = await db.execute<{ company_id: string }>(sql`
    SELECT lc.company_id
      FROM landscapes l
      JOIN landscape_companies lc ON lc.landscape_id = l.id
     WHERE l.org_id = ${orgId}::uuid
       AND l.slug = ${slug}
     ORDER BY lc.sort_order, lc.company_id
  `);
  return rows.map((row) => row.company_id);
}

/* ---------------------------------------------------------------- helpers */

/**
 * Postgres returns bigint and numeric as strings over the wire so precision is not
 * silently lost. Everything numeric coming out of `db.execute` goes through here.
 */
function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/** Division that refuses to produce Infinity or NaN. Zero denominator yields 0. */
function safeDiv(numerator: number, denominator: number): number {
  if (!denominator || !Number.isFinite(denominator)) return 0;
  const r = numerator / denominator;
  return Number.isFinite(r) ? r : 0;
}

/** Division where "we could not measure this" is meaningfully different from zero. */
function safeDivNull(numerator: number, denominator: number): number | null {
  if (!denominator || !Number.isFinite(denominator)) return null;
  const r = numerator / denominator;
  return Number.isFinite(r) ? r : null;
}

/**
 * Fractional period-over-period change: 0.27 means +27%.
 *
 * DELIBERATE CORRECTNESS STANCE: when the previous value is zero this returns
 * `null`, not Infinity and not some enormous integer. Rival IQ will happily print
 * "+265,000%" when a competitor went from 1 engagement to 2,650 -- a figure that is
 * arithmetically defensible and analytically worthless, because it tells you about
 * the size of the denominator rather than about the business. Growth from nothing is
 * not a percentage; it is a new-activity event, and Data Dumpster surfaces it as a
 * caveat and an anomaly instead of as a headline number. The UI renders `null` as an
 * em dash with "no prior activity" on hover.
 */
export function changePct(current: number, previous: number | null | undefined): number | null {
  if (previous === null || previous === undefined) return null;
  if (previous === 0) return null;
  /*
   * Divided by the MAGNITUDE of the baseline, so the sign always means
   * direction of travel.
   *
   * This divided by the raw baseline, which is identical for every
   * non-negative metric and inverted for the one metric that is routinely
   * negative. audienceNetChange goes negative whenever a platform purges bots.
   * A brand improving from -1,000 net followers to -200 produced
   * (-200 - -1000) / -1000 = -0.8, rendered as "-80%" in red: an improvement
   * displayed as a decline. The report's own movement() already used the
   * magnitude, so the same document disagreed with itself depending on which
   * table you read.
   */
  const pct = (current - previous) / Math.abs(previous);
  return Number.isFinite(pct) ? pct : null;
}

type AudienceSnapshotReading = {
  channelId: string;
  /** ISO calendar date (`YYYY-MM-DD`), matching audience_snapshots.day. */
  day: string;
  followers: number;
};

/**
 * Executable specification for the audience stock rule used by the SQL below.
 * Production reads stay aggregated in Postgres; this pure form exists so the
 * latest-per-channel behavior can be protected without a database fixture.
 */
function audienceStockTotal(snapshots: readonly AudienceSnapshotReading[]): number {
  const latestByChannel = new Map<string, AudienceSnapshotReading>();

  for (const snapshot of snapshots) {
    const latest = latestByChannel.get(snapshot.channelId);
    if (!latest || snapshot.day > latest.day) {
      latestByChannel.set(snapshot.channelId, snapshot);
    }
  }

  let total = 0;
  for (const snapshot of latestByChannel.values()) total += snapshot.followers;
  return total;
}

/**
 * Availability rule shared by leaderboard, fact-sheet and time-series paths.
 * A single audience snapshot establishes a stock, but it cannot establish
 * change. Growth also needs a non-zero measured baseline.
 */
function audienceMetricAvailable(
  key: MetricKey,
  observedDays: number,
  firstFollowers: number,
): boolean {
  if (key === 'audience') return observedDays >= 1;
  if (key === 'audienceNetChange') return observedDays >= 2;
  if (key === 'audienceGrowthRate') return observedDays >= 2 && firstFollowers !== 0;
  return true;
}

function metricAvailabilityForCoverage(
  key: MetricKey,
  applicablePlatforms: number,
  minimumObservedDays: number,
  maximumObservedDays: number,
  firstFollowers: number,
): boolean {
  if (applicablePlatforms === 0) return false;
  return audienceMetricAvailable(
    key,
    key === 'audience' ? maximumObservedDays : minimumObservedDays,
    firstFollowers,
  );
}

function mergeMinimumObservedDays(
  currentMinimum: number,
  applicablePlatforms: number,
  nextObservedDays: number,
): number {
  return applicablePlatforms === 0
    ? nextObservedDays
    : Math.min(currentMinimum, nextObservedDays);
}

/**
 * Reddit user profiles do not expose a follower stock through the account-post
 * source. They are still valid post sources, but they must not count as missing
 * audience coverage for a measured subreddit channel on the same company.
 */
function channelProvidesAudience(platform: Platform, handle: string): boolean {
  return platform !== 'reddit' || !handle.toLowerCase().startsWith('u/');
}

/**
 * A company-platform total is only comparable after every configured profile
 * has completed collection. One successful profile out of several would make
 * the partial sum look like a real total, which is worse than leaving it blank.
 */
function platformHasCompleteFlow(trackedChannels: number, ingestedChannels: number): boolean {
  return trackedChannels > 0 && ingestedChannels >= trackedChannels;
}

/**
 * Useful post observations are still measurements when a capped source cannot
 * certify the whole window. A certified empty read is also a measured zero.
 * The caller carries completeness separately so partial totals never acquire a
 * confident comparison merely because they are non-empty.
 */
function platformHasMeasuredFlow(
  trackedChannels: number,
  certifiedChannels: number,
  posts: number,
): boolean {
  return trackedChannels > 0 && (posts > 0 || certifiedChannels >= trackedChannels);
}

function followerRateContribution(
  followerRateSum: number,
  ratedPosts: number,
): { numerator: number; posts: number } {
  if (ratedPosts <= 0) return { numerator: 0, posts: 0 };
  return {
    numerator: followerRateSum,
    posts: ratedPosts,
  };
}

function followerRateAvailable(ratedPosts: number): boolean {
  return ratedPosts > 0;
}

/**
 * Executable specification for the source-scoped percentile used by `loadPosts`.
 * PostgreSQL's percentile_cont interpolates the middle pair, hence the average
 * for an even-sized source.
 */
function sourceMedianEngagement(
  rows: readonly { sourceId: string; engagementTotal: number }[],
): Map<string, number> {
  const grouped = new Map<string, number[]>();
  for (const row of rows) {
    const values = grouped.get(row.sourceId) ?? [];
    values.push(row.engagementTotal);
    grouped.set(row.sourceId, values);
  }

  const medians = new Map<string, number>();
  for (const [sourceId, values] of grouped) {
    values.sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2);
    medians.set(
      sourceId,
      values.length % 2 === 0
        ? (values[middle - 1] + values[middle]) / 2
        : values[middle],
    );
  }
  return medians;
}

/** Narrow test seam for arithmetic that otherwise stays private to this module. */
export const metricTestHelpers = {
  safeDiv,
  audienceStockTotal,
  audienceMetricAvailable,
  metricAvailabilityForCoverage,
  mergeMinimumObservedDays,
  channelProvidesAudience,
  platformHasCompleteFlow,
  platformHasMeasuredFlow,
  followerRateContribution,
  followerRateAvailable,
  sourceMedianEngagement,
  aggregateTagPerformanceRows,
  platformAudienceCoverageCaveats,
};

/** `a, b, c` as uuid-cast literals. Never call with an empty array. */
function idList(ids: readonly string[]): SQL {
  return sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
}

function platformList(ps: readonly Platform[]): SQL {
  return sql.join(ps.map((p) => sql`${p}::platform`), sql`, `);
}

function postTypeList(ts: readonly PostType[]): SQL {
  return sql.join(ts.map((t) => sql`${t}::post_type`), sql`, `);
}

/** Timestamps are passed as ISO text and cast, so driver date handling is not load-bearing. */
function tsParam(d: Date): SQL {
  return sql`${d.toISOString()}::timestamptz`;
}

function dayParam(d: Date): SQL {
  return sql`${toDayString(d)}::date`;
}

/**
 * All day/hour bucketing happens in America/New_York. Data Dumpster is built for a
 * Boston newsroom: "Tuesday morning" has to mean Tuesday morning in Boston, not in
 * UTC, or every cadence heatmap is wrong by four or five hours depending on the
 * season.
 */
const TZ = sql`'America/New_York'`;

/* --------------------------------------------------------------- filtering */

interface PostFilters {
  platforms?: Platform[];
  postTypes?: PostType[];
  tagIds?: string[];
  search?: string;
}

/**
 * The WHERE clause shared by every post-derived query. It always assumes the posts
 * table is aliased `p`, so callers can wrap it in a CTE and then join against that.
 *
 * Ordering matters for the planner: company + posted_at come first because that is
 * the leading edge of `posts_company_posted_idx`.
 */
function postWhere(scope: Scope, range: DateRange, f: PostFilters): SQL {
  const parts: SQL[] = [
    sql`p.company_id IN (${idList(scope.companyIds)})`,
    sql`p.posted_at >= ${tsParam(range.start)}`,
    sql`p.posted_at <= ${tsParam(range.end)}`,
  ];
  if (f.platforms?.length) parts.push(sql`p.platform IN (${platformList(f.platforms)})`);
  if (f.postTypes?.length) parts.push(sql`p.type IN (${postTypeList(f.postTypes)})`);
  if (f.tagIds?.length) {
    // Scoped to the org. post_tags is org-private, but the assignment table is
    // keyed on pooled posts, so an unscoped tag id let a caller filter their
    // own posts by ANOTHER org's tag and learn what that org had tagged.
    // EXISTS rather than a JOIN: a post with three matching tags must still count once.
    parts.push(sql`EXISTS (
      SELECT 1 FROM post_tag_assignments pta
       JOIN post_tags pt ON pt.id = pta.tag_id AND pt.org_id = ${scope.orgId}::uuid
       WHERE pta.post_id = p.id AND pta.tag_id IN (${idList(f.tagIds)})
    )`);
  }
  if (f.search && f.search.trim()) {
    const needle = `%${f.search.trim()}%`;
    parts.push(sql`(
      p.text ILIKE ${needle}
      OR p.permalink ILIKE ${needle}
      OR EXISTS (
        SELECT 1
          FROM posted_urls search_url
         WHERE search_url.post_id = p.id
           AND (
             search_url.url ILIKE ${needle}
             OR search_url.domain ILIKE ${needle}
             OR search_url.title ILIKE ${needle}
           )
      )
    )`);
  }
  return sql.join(parts, sql` AND `);
}

function filtersOf(q: AnalyticsQuery): PostFilters {
  return {
    platforms: q.platforms,
    postTypes: q.postTypes,
    tagIds: q.tagIds,
    search: q.search,
  };
}

/* ----------------------------------------------------- the core aggregate */

type AggRow = {
  company_id: string;
  platform: Platform;
  post_count: string | number | null;
  engagement_total: string | number | null;
  applause: string | number | null;
  conversation: string | number | null;
  amplification: string | number | null;
  saves: string | number | null;
  views: string | number | null;
  posts_missing_followers: string | number | null;
  follower_rate_sum: string | number | null;
  rated_post_count: string | number | null;
  followers_last: string | number | null;
  followers_first: string | number | null;
  audience_days: string | number | null;
  audience_max_days: string | number | null;
  audience_tracked_channels: string | number | null;
  audience_observed_channels: string | number | null;
  audience_change_channels: string | number | null;
  tracked_channels: string | number | null;
  ingested_channels: string | number | null;
};

interface PlatformAgg {
  platform: Platform;
  posts: number;
  engagementTotal: number;
  applause: number;
  conversation: number;
  amplification: number;
  saves: number;
  views: number;
  postsMissingFollowers: number;
  /** Sum of each rated post's engagement / followers-at-post. */
  followerRateSum: number;
  /** Posts with a real followers-at-post denominator. */
  ratedPosts: number;
  /** Latest follower reading inside the window -- a stock. */
  followersLast: number;
  /** Earliest follower reading inside the window. */
  followersFirst: number;
  /** How many days of the window actually have an audience reading. */
  audienceDays: number;
  /** Most-observed included channel, used to establish stock presence. */
  audienceMaxDays: number;
  /** Active profiles whose platform exposes an audience stock. */
  audienceTrackedChannels: number;
  /** Audience-bearing profiles with a stock reading in the selected window. */
  audienceObservedChannels: number;
  /** Audience-bearing profiles with at least two readings in the selected window. */
  audienceChangeChannels: number;
  /** Active channels represented by this company+platform aggregate. */
  trackedChannels: number;
  /** Active channels with at least one completed ingest. */
  ingestedChannels: number;
}

interface CompanyAgg {
  companyId: string;
  posts: number;
  engagementTotal: number;
  applause: number;
  conversation: number;
  amplification: number;
  saves: number;
  views: number;
  postsMissingFollowers: number;
  followersLast: number;
  followersFirst: number;
  /** Latest/earliest audience totals; availability decides whether change may use them. */
  audienceChangeLast: number;
  audienceChangeFirst: number;
  /** Minimum observed days across every applicable channel/platform. */
  audienceDays: number;
  /** Maximum observed days on any included audience channel. */
  audienceMaxDays: number;
  trackedChannels: number;
  ingestedChannels: number;
  audienceTrackedChannels: number;
  audienceObservedChannels: number;
  audienceChangeChannels: number;
  /** Number of platform rows that are actually applicable to this company. */
  applicablePlatforms: number;
  /**
   * Sum of each post's own engagement/followers-at-post rate. Divide by
   * `erfPosts` for the canonical mean of per-post rates. The denominator travels
   * with the post, so a large account cannot swamp a smaller account's result.
   */
  erfNumerator: number;
  erfPosts: number;
  byPlatform: Map<Platform, PlatformAgg>;
}

function emptyCompanyAgg(companyId: string): CompanyAgg {
  return {
    companyId,
    posts: 0, engagementTotal: 0, applause: 0, conversation: 0,
    amplification: 0, saves: 0, views: 0, postsMissingFollowers: 0,
    followersLast: 0, followersFirst: 0,
    audienceChangeLast: 0, audienceChangeFirst: 0,
    audienceDays: 0, audienceMaxDays: 0,
    trackedChannels: 0, ingestedChannels: 0,
    audienceTrackedChannels: 0, audienceObservedChannels: 0,
    audienceChangeChannels: 0,
    applicablePlatforms: 0,
    erfNumerator: 0, erfPosts: 0,
    byPlatform: new Map(),
  };
}

/**
 * One statement, one round trip, everything the leaderboards and the summary need.
 *
 * The audience side is deliberately two levels of aggregation. `aud_channel` picks
 * the LAST reading per channel inside the window -- audience is a stock, a level you
 * measure on a given day, not something you accumulate. `aud` then sums those
 * per-channel levels up to company+platform. Summing raw snapshot rows instead
 * would multiply a company's followers by the number of days in the window, which is
 * the single most common way this metric gets reported wrong.
 *
 * Posts, by contrast, are a flow, and are genuinely summed over the window.
 *
 * The `keys` union keeps companies that have audience with no posts, posts with
 * no audience reading, or only configured channels. Those states mean different
 * things, so none may disappear as a side effect of a join.
 */
async function companyPlatformAgg(
  scope: Scope,
  range: DateRange,
  f: PostFilters,
): Promise<Map<string, CompanyAgg>> {
  const out = new Map<string, CompanyAgg>();
  if (scope.companyIds.length === 0) return out;

  const { rows } = await db.execute<AggRow>(sql`
    WITH tracked AS (
      SELECT ch.company_id,
             ch.platform,
             count(*)::int AS tracked_channels,
             count(*) FILTER (
               WHERE EXISTS (
                 SELECT 1
                   FROM channel_collection_state state
                  WHERE state.channel_id = ch.id
                    AND state.status = 'succeeded'
                    AND state.outcome = 'certified_complete'
                    AND NOT state.has_more
                    AND state.coverage_since::date <= ${dayParam(range.start)}
                    AND state.coverage_until::date >= ${dayParam(range.end)}
               )
             )::int
               AS ingested_channels
        FROM channels ch
       WHERE ch.company_id IN (${idList(scope.companyIds)})
         AND ch.active
         ${f.platforms?.length
           ? sql`AND ch.platform IN (${platformList(f.platforms)})`
           : sql``}
       GROUP BY ch.company_id, ch.platform
    ),
    /*
     * Same carry-forward stance as the bucketed series: a channel's stock at
     * the window's edges is its last reading on or before that edge, within
     * the carry bound. A channel with no reading by the window end — never
     * tracked yet, or dark past the bound — is not tracked for this window,
     * so a channel born in 2026 does not blank a company's 2025 history.
     */
    aud_channel AS (
      SELECT ch.company_id,
             ch.platform,
             ch.id AS channel_id,
             last_r.followers AS f_last,
             coalesce(seed_r.followers, inw.f_in_first) AS baseline,
             (seed_r.followers IS NOT NULL) AS has_seed,
             coalesce(inw.days_observed, 0) AS days_observed
        FROM channels ch
        LEFT JOIN LATERAL (
          SELECT a.followers
            FROM audience_snapshots a
           WHERE a.channel_id = ch.id
             AND a.day <= ${dayParam(range.end)}
             AND a.day >= ${dayParam(range.start)}::date - ${AUDIENCE_CARRY_DAYS}::int
           ORDER BY a.day DESC
           LIMIT 1
        ) last_r ON true
        LEFT JOIN LATERAL (
          SELECT a.followers
            FROM audience_snapshots a
           WHERE a.channel_id = ch.id
             AND a.day < ${dayParam(range.start)}
             AND a.day >= ${dayParam(range.start)}::date - ${AUDIENCE_CARRY_DAYS}::int
           ORDER BY a.day DESC
           LIMIT 1
        ) seed_r ON true
        LEFT JOIN LATERAL (
          SELECT (array_agg(a.followers ORDER BY a.day ASC))[1] AS f_in_first,
                 count(*)::int AS days_observed
            FROM audience_snapshots a
           WHERE a.channel_id = ch.id
             AND a.day >= ${dayParam(range.start)}
             AND a.day <= ${dayParam(range.end)}
        ) inw ON true
       WHERE ch.company_id IN (${idList(scope.companyIds)})
         AND ch.active
         AND NOT (ch.platform = 'reddit'::platform AND lower(ch.handle) LIKE 'u/%')
         ${f.platforms?.length
           ? sql`AND ch.platform IN (${platformList(f.platforms)})`
           : sql``}
    ),
    aud AS (
      SELECT company_id,
             platform,
             coalesce(sum(f_last), 0) AS followers_last,
             /*
              * Net change pairs each channel's end value with its start value:
              * the pre-window carried seed, or for a channel born inside the
              * window its first reading once a second one exists. Sums are
              * restricted to paired channels so both ends compare the same
              * set; availability still demands every tracked channel pair up.
              */
             coalesce(sum(baseline) FILTER (
               WHERE f_last IS NOT NULL AND baseline IS NOT NULL
                 AND (has_seed OR days_observed >= 2)
             ), 0) AS followers_first,
             coalesce(min(days_observed) FILTER (WHERE days_observed > 0), 0)
               AS audience_days,
             coalesce(max(days_observed), 0) AS audience_max_days,
             count(*) FILTER (WHERE f_last IS NOT NULL)::int
               AS audience_tracked_channels,
             count(*) FILTER (WHERE f_last IS NOT NULL)::int
               AS audience_observed_channels,
             count(*) FILTER (
               WHERE f_last IS NOT NULL AND baseline IS NOT NULL
                 AND (has_seed OR days_observed >= 2)
             )::int AS audience_change_channels
        FROM aud_channel
       GROUP BY company_id, platform
    ),
    pa AS (
      SELECT p.company_id,
             p.platform,
             count(*)::int                       AS post_count,
             coalesce(sum(p.engagement_total), 0) AS engagement_total,
             coalesce(sum(p.applause), 0)         AS applause,
             coalesce(sum(p.conversation), 0)     AS conversation,
             coalesce(sum(p.amplification), 0)    AS amplification,
             coalesce(sum(p.saves), 0)            AS saves,
             coalesce(sum(p.views), 0)            AS views,
             count(*) FILTER (
               WHERE p.followers_at_post IS NULL OR p.followers_at_post = 0
             )::int                               AS posts_missing_followers,
             coalesce(sum(
               p.engagement_total::numeric / nullif(p.followers_at_post, 0)
             ) FILTER (WHERE p.followers_at_post > 0), 0) AS follower_rate_sum,
             count(*) FILTER (
               WHERE p.followers_at_post > 0
             )::int                               AS rated_post_count
        FROM posts p
       WHERE ${postWhere(scope, range, f)}
       GROUP BY p.company_id, p.platform
    ),
    keys AS (
      SELECT company_id, platform FROM tracked
      UNION
      SELECT company_id, platform FROM pa
      UNION
      SELECT company_id, platform FROM aud
    )
    SELECT keys.company_id,
           keys.platform,
           coalesce(pa.post_count, 0)              AS post_count,
           coalesce(pa.engagement_total, 0)        AS engagement_total,
           coalesce(pa.applause, 0)                AS applause,
           coalesce(pa.conversation, 0)            AS conversation,
           coalesce(pa.amplification, 0)           AS amplification,
           coalesce(pa.saves, 0)                   AS saves,
           coalesce(pa.views, 0)                   AS views,
           coalesce(pa.posts_missing_followers, 0) AS posts_missing_followers,
           coalesce(pa.follower_rate_sum, 0)       AS follower_rate_sum,
           coalesce(pa.rated_post_count, 0)        AS rated_post_count,
           aud.followers_last,
           aud.followers_first,
           aud.audience_days,
           aud.audience_max_days,
           coalesce(aud.audience_tracked_channels, 0) AS audience_tracked_channels,
           coalesce(aud.audience_observed_channels, 0) AS audience_observed_channels,
           coalesce(aud.audience_change_channels, 0) AS audience_change_channels,
           coalesce(tracked.tracked_channels, 0)   AS tracked_channels,
           coalesce(tracked.ingested_channels, 0)  AS ingested_channels
      FROM keys
      LEFT JOIN tracked
        ON tracked.company_id = keys.company_id AND tracked.platform = keys.platform
      LEFT JOIN pa
        ON pa.company_id = keys.company_id AND pa.platform = keys.platform
      LEFT JOIN aud
        ON aud.company_id = keys.company_id AND aud.platform = keys.platform
  `);

  for (const r of rows) {
    if (!r.company_id) continue;
    let agg = out.get(r.company_id);
    if (!agg) { agg = emptyCompanyAgg(r.company_id); out.set(r.company_id, agg); }

    const p: PlatformAgg = {
      platform: r.platform,
      posts: num(r.post_count),
      engagementTotal: num(r.engagement_total),
      applause: num(r.applause),
      conversation: num(r.conversation),
      amplification: num(r.amplification),
      saves: num(r.saves),
      views: num(r.views),
      postsMissingFollowers: num(r.posts_missing_followers),
      followerRateSum: num(r.follower_rate_sum),
      ratedPosts: num(r.rated_post_count),
      followersLast: num(r.followers_last),
      followersFirst: num(r.followers_first),
      audienceDays: num(r.audience_days),
      audienceMaxDays: num(r.audience_max_days),
      audienceTrackedChannels: num(r.audience_tracked_channels),
      audienceObservedChannels: num(r.audience_observed_channels),
      audienceChangeChannels: num(r.audience_change_channels),
      trackedChannels: num(r.tracked_channels),
      ingestedChannels: num(r.ingested_channels),
    };
    agg.byPlatform.set(p.platform, p);

    agg.posts += p.posts;
    agg.engagementTotal += p.engagementTotal;
    agg.applause += p.applause;
    agg.conversation += p.conversation;
    agg.amplification += p.amplification;
    agg.saves += p.saves;
    agg.views += p.views;
    agg.postsMissingFollowers += p.postsMissingFollowers;
    agg.trackedChannels += p.trackedChannels;
    agg.ingestedChannels += p.ingestedChannels;
    agg.audienceTrackedChannels += p.audienceTrackedChannels;
    agg.audienceObservedChannels += p.audienceObservedChannels;
    agg.audienceChangeChannels += p.audienceChangeChannels;
    agg.followersLast += p.followersLast;
    agg.followersFirst += p.followersFirst;
    const applicable = platformHasMeasuredFlow(
      p.trackedChannels,
      p.ingestedChannels,
      p.posts,
    );
    if (applicable) {
      agg.audienceDays = mergeMinimumObservedDays(
        agg.audienceDays,
        agg.applicablePlatforms,
        p.audienceDays,
      );
      agg.applicablePlatforms += 1;
    }
    agg.audienceMaxDays = Math.max(agg.audienceMaxDays, p.audienceMaxDays);
    agg.audienceChangeLast += p.followersLast;
    agg.audienceChangeFirst += p.followersFirst;

    // Only posts that captured their own denominator participate. This keeps
    // audience-less Reddit user posts from borrowing a sibling subreddit's members.
    const erf = followerRateContribution(
      p.followerRateSum,
      p.ratedPosts,
    );
    agg.erfNumerator += erf.numerator;
    agg.erfPosts += erf.posts;
  }

  // Companies with no rows at all still belong in a leaderboard, at zero.
  for (const id of scope.companyIds) {
    if (!out.has(id)) out.set(id, emptyCompanyAgg(id));
  }
  return out;
}

/* ------------------------------------------------- metric interpretation */

interface LandscapeTotals { posts: number; engagementTotal: number; audience: number }

function totalsOf(aggs: Iterable<CompanyAgg>): LandscapeTotals {
  let posts = 0, engagementTotal = 0, audience = 0;
  for (const a of aggs) {
    posts += a.posts;
    engagementTotal += a.engagementTotal;
    audience += a.followersLast;
  }
  return { posts, engagementTotal, audience };
}

/**
 * A scope covering the whole landscape, ignoring any company filter.
 *
 * Share of voice is defined against every company in the landscape. It was
 * being divided by the totals of whatever subset the user had filtered to, so
 * selecting three companies pushed each one toward 33% and the number silently
 * changed meaning: not "share of the market" but "share of the three you
 * happened to tick". `allCompanyIds` had been captured on the scope for exactly
 * this and was never read anywhere in the codebase.
 *
 * Both share metrics also reach the AI fact sheet, where a shrunken denominator
 * would have been unmarked.
 */
function landscapeWideScope(scope: Scope): Scope {
  if (scope.companyIds.length === scope.allCompanyIds.length) return scope;
  return { ...scope, companyIds: scope.allCompanyIds };
}

/** True when this metric's denominator is the landscape rather than the filter. */
function usesLandscapeDenominator(key: MetricKey): boolean {
  return key === 'shareOfVoice' || key === 'shareOfEngagement';
}

/**
 * Turn a rolled-up aggregate into one metric. This is the single definition of
 * every metric in the product; `definitions.ts` describes these formulas in prose
 * and the two must always agree.
 */
/**
 * Did any channel's audience endpoints arrive pre-rounded by their source?
 *
 * Judged per platform, because rounding is a property of one vendor's feed:
 * Facebook rounds large pages to 100k while X and Instagram report exact
 * figures for the same brand. A single rounded platform is enough to make the
 * brand's total movement suspect, since that platform's bucket flip lands
 * whole in the sum.
 */
function audienceChangeIsRounded(a: CompanyAgg, key: MetricKey): boolean {
  if (key !== 'audience' && key !== 'audienceNetChange' && key !== 'audienceGrowthRate') {
    return false;
  }
  for (const platform of a.byPlatform.values()) {
    if (platform.followersLast <= 0 || platform.followersFirst <= 0) continue;
    if (changeIsRounded(platform.followersFirst, platform.followersLast)) return true;
  }
  return false;
}

function metricAvailable(a: CompanyAgg, key: MetricKey): boolean {
  if (key === 'audience') {
    return a.audienceTrackedChannels > 0
      && a.audienceObservedChannels >= a.audienceTrackedChannels;
  }
  if (key === 'audienceNetChange' || key === 'audienceGrowthRate') {
    const completeHistory = a.audienceTrackedChannels > 0
      && a.audienceChangeChannels >= a.audienceTrackedChannels;
    return completeHistory && (key !== 'audienceGrowthRate' || a.audienceChangeFirst !== 0);
  }

  if (!platformHasMeasuredFlow(a.trackedChannels, a.ingestedChannels, a.posts)) return false;
  if (key === 'engagementRateByFollower') return followerRateAvailable(a.erfPosts);
  /*
   * A rate needs a denominator.
   *
   * engagementRateByView fell through to the audience-only availability check,
   * which returns true for every non-audience key, so a company with no video
   * anywhere rendered a confident "0.00%" instead of a blank. definitions.ts
   * promises the opposite in as many words: it "goes blank for them rather than
   * reporting a misleading zero".
   */
  if (key === 'engagementRateByView') return a.views > 0;
  return metricAvailabilityForCoverage(
    key,
    a.applicablePlatforms,
    a.audienceDays,
    a.audienceMaxDays,
    a.audienceChangeFirst,
  );
}

/**
 * Availability answers whether a number exists; completeness answers whether
 * it is safe to compare as a full-window total. Keep these questions separate.
 */
function metricComplete(a: CompanyAgg, key: MetricKey): boolean {
  if (!metricAvailable(a, key)) return false;
  if (key === 'audience') {
    return a.audienceTrackedChannels > 0
      && a.audienceObservedChannels >= a.audienceTrackedChannels;
  }
  if (key === 'audienceNetChange' || key === 'audienceGrowthRate') {
    return a.audienceTrackedChannels > 0
      && a.audienceChangeChannels >= a.audienceTrackedChannels;
  }
  return platformHasCompleteFlow(a.trackedChannels, a.ingestedChannels);
}

function metricValue(a: CompanyAgg, key: MetricKey, days: number, t: LandscapeTotals): number {
  switch (key) {
    case 'audience': return a.followersLast;
    case 'audienceNetChange': return a.audienceChangeLast - a.audienceChangeFirst;
    case 'audienceGrowthRate':
      return safeDiv(a.audienceChangeLast - a.audienceChangeFirst, a.audienceChangeFirst);
    case 'posts': return a.posts;
    case 'postsPerDay': return safeDiv(a.posts, days);
    case 'postsPerWeek': return safeDiv(a.posts, days) * 7;
    case 'engagementTotal': return a.engagementTotal;
    case 'engagementPerPost': return safeDiv(a.engagementTotal, a.posts);
    case 'engagementRateByFollower': return safeDiv(a.erfNumerator, a.erfPosts);
    case 'engagementRateByView': return safeDiv(a.engagementTotal, a.views);
    case 'applause': return a.applause;
    case 'conversation': return a.conversation;
    case 'amplification': return a.amplification;
    case 'saves': return a.saves;
    case 'views': return a.views;
    case 'viewsPerPost': return safeDiv(a.views, a.posts);
    case 'shareOfVoice': return safeDiv(a.posts, t.posts);
    case 'shareOfEngagement': return safeDiv(a.engagementTotal, t.engagementTotal);
  }
}

/** The same arithmetic restricted to one platform, for cross-channel breakdowns. */
function platformMetricValue(p: PlatformAgg, key: MetricKey, days: number, t: LandscapeTotals): number {
  const erf = followerRateContribution(
    p.followerRateSum,
    p.ratedPosts,
  );
  const asCompany: CompanyAgg = {
    companyId: '',
    posts: p.posts,
    engagementTotal: p.engagementTotal,
    applause: p.applause,
    conversation: p.conversation,
    amplification: p.amplification,
    saves: p.saves,
    views: p.views,
    postsMissingFollowers: p.postsMissingFollowers,
    followersLast: p.followersLast,
    followersFirst: p.followersFirst,
    // Paired-channel counts gate change math now that carry-forward exists;
    // a platform where every observed channel has a baseline is comparable.
    audienceChangeLast: p.audienceChangeChannels > 0
      && p.audienceChangeChannels >= p.audienceObservedChannels ? p.followersLast : 0,
    audienceChangeFirst: p.audienceChangeChannels > 0
      && p.audienceChangeChannels >= p.audienceObservedChannels ? p.followersFirst : 0,
    audienceDays: p.audienceDays,
    audienceMaxDays: p.audienceMaxDays,
    trackedChannels: p.trackedChannels,
    ingestedChannels: p.ingestedChannels,
    audienceTrackedChannels: p.audienceTrackedChannels,
    audienceObservedChannels: p.audienceObservedChannels,
    audienceChangeChannels: p.audienceChangeChannels,
    applicablePlatforms: platformHasMeasuredFlow(
      p.trackedChannels,
      p.ingestedChannels,
      p.posts,
    ) ? 1 : 0,
    erfNumerator: erf.numerator,
    erfPosts: erf.posts,
    byPlatform: new Map(),
  };
  return metricValue(asCompany, key, days, t);
}

function breakdownOf(a: CompanyAgg, key: MetricKey, days: number, t: LandscapeTotals):
  Partial<Record<Platform, number>> {
  const out: Partial<Record<Platform, number>> = {};
  for (const [platform, p] of a.byPlatform) out[platform] = platformMetricValue(p, key, days, t);
  return out;
}

function breakdownAvailabilityOf(a: CompanyAgg, key: MetricKey):
  Partial<Record<Platform, boolean>> {
  const out: Partial<Record<Platform, boolean>> = {};
  for (const [platform, p] of a.byPlatform) {
    const erf = followerRateContribution(
      p.followerRateSum,
      p.ratedPosts,
    );
    const asCompany: CompanyAgg = {
      companyId: '',
      posts: p.posts,
      engagementTotal: p.engagementTotal,
      applause: p.applause,
      conversation: p.conversation,
      amplification: p.amplification,
      saves: p.saves,
      views: p.views,
      postsMissingFollowers: p.postsMissingFollowers,
      followersLast: p.followersLast,
      followersFirst: p.followersFirst,
      audienceChangeLast: p.audienceDays >= 2 ? p.followersLast : 0,
      audienceChangeFirst: p.audienceDays >= 2 ? p.followersFirst : 0,
      audienceDays: p.audienceDays,
      audienceMaxDays: p.audienceMaxDays,
      trackedChannels: p.trackedChannels,
      ingestedChannels: p.ingestedChannels,
      audienceTrackedChannels: p.audienceTrackedChannels,
      audienceObservedChannels: p.audienceObservedChannels,
      audienceChangeChannels: p.audienceChangeChannels,
      applicablePlatforms: platformHasMeasuredFlow(
        p.trackedChannels,
        p.ingestedChannels,
        p.posts,
      ) ? 1 : 0,
      erfNumerator: erf.numerator,
      erfPosts: erf.posts,
      byPlatform: new Map(),
    };
    out[platform] = metricAvailable(asCompany, key);
  }
  return out;
}

function rangeOf(q: AnalyticsQuery): DateRange { return { start: q.start, end: q.end }; }

/* ------------------------------------------------------------ leaderboard */

export async function getLeaderboard(
  q: Scoped<AnalyticsQuery & { metric: MetricKey }>,
): Promise<MetricRow[]> {
  const scope = await resolveScope(q);
  if (scope.companyIds.length === 0) return [];

  const range = rangeOf(q);
  const days = daysIn(range);
  const f = filtersOf(q);

  // Two independent aggregates run concurrently; the previous window is only paid
  // for when the caller actually asked to compare.
  const prev = q.compare ? previousRange(range) : null;

  // Share metrics divide by the whole landscape, so when a company filter is
  // active their denominator needs its own aggregate. Paid for only when the
  // requested metric actually needs it.
  const wide = landscapeWideScope(scope);
  const needsWide = usesLandscapeDenominator(q.metric) && wide !== scope;

  const [current, previousAgg, wideCurrent, widePrevious] = await Promise.all([
    companyPlatformAgg(scope, range, f),
    prev ? companyPlatformAgg(scope, prev, f) : Promise.resolve(null),
    needsWide ? companyPlatformAgg(wide, range, f) : Promise.resolve(null),
    needsWide && prev ? companyPlatformAgg(wide, prev, f) : Promise.resolve(null),
  ]);

  const totals = totalsOf((wideCurrent ?? current).values());
  const prevTotals = previousAgg
    ? totalsOf((widePrevious ?? previousAgg).values())
    : null;
  const prevDays = prev ? daysIn(prev) : days;

  const rows: MetricRow[] = [];
  for (const company of scope.companies) {
    const agg = current.get(company.id) ?? emptyCompanyAgg(company.id);
    const available = metricAvailable(agg, q.metric);
    const complete = metricComplete(agg, q.metric);
    const value = metricValue(agg, q.metric, days, totals);
    let previousValue: number | null = null;
    let previousAvailable = false;
    let previousComplete = false;
    if (previousAgg && prevTotals) {
      const pa = previousAgg.get(company.id) ?? emptyCompanyAgg(company.id);
      previousAvailable = metricAvailable(pa, q.metric);
      previousComplete = metricComplete(pa, q.metric);
      previousValue = previousAvailable
        ? metricValue(pa, q.metric, prevDays, prevTotals)
        : null;
    }
    rows.push({
      company,
      value,
      available,
      complete,
      previousValue,
      previousAvailable,
      previousComplete,
      changePct: available && complete && previousAvailable && previousComplete
        ? changePct(value, previousValue)
        : null,
      rank: 0,
      breakdown: breakdownOf(agg, q.metric, days, totals),
      breakdownAvailability: breakdownAvailabilityOf(agg, q.metric),
      changeFromRoundedSource: audienceChangeIsRounded(agg, q.metric),
    });
  }

  // Unmeasured rows belong at the bottom with no rank. They are not zero-value
  // competitors and must not influence reference averages.
  rows.sort((x, y) =>
    Number(y.available) - Number(x.available)
    || (y.value - x.value)
    || x.company.name.localeCompare(y.company.name));
  let rank = 0;
  rows.forEach((r) => { r.rank = r.available ? ++rank : 0; });
  return rows;
}

/* ------------------------------------------------------------ time series */

type BucketRow = {
  company_id: string;
  bucket: string;
  post_count: string | number | null;
  engagement_total: string | number | null;
  applause: string | number | null;
  conversation: string | number | null;
  amplification: string | number | null;
  saves: string | number | null;
  views: string | number | null;
  followers_last: string | number | null;
  followers_first: string | number | null;
  audience_days: string | number | null;
  audience_max_days: string | number | null;
  audience_observed: string | number | null;
  audience_change: string | number | null;
  change_last_sum: string | number | null;
  change_first_sum: string | number | null;
  erf_num: string | number | null;
  erf_posts: string | number | null;
};

/**
 * How long a channel's last audience reading keeps counting toward totals.
 * Long enough to bridge weekly imported history and vendor gaps, short enough
 * that a channel which stopped reporting ages out rather than lying forever.
 */
const AUDIENCE_CARRY_DAYS = 90;

/** Buckets the window itself, so a chart renders empty periods as zero, not as a gap. */
function bucketsFor(range: DateRange, g: Granularity): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const cursor = new Date(range.start.getTime());
  while (cursor <= range.end) {
    const key = g === 'day'
      ? toDayString(cursor)
      : g === 'week'
        ? toDayString(startOfIsoWeek(cursor))
        : `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-01`;
    if (!seen.has(key)) { seen.add(key); out.push(key); }
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

/** Monday-start week, matching Postgres `date_trunc('week', ...)` exactly. */
function startOfIsoWeek(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (x.getDay() + 6) % 7; // Monday = 0
  x.setDate(x.getDate() - dow);
  return x;
}

/**
 * One statement produces every metric's series for every company.
 *
 * The inner CTEs group by company+platform+bucket even though the output is only
 * company+bucket because audience remains a per-platform stock. Follower rate is
 * already additive here as the sum of each post's own rate plus its rated-post
 * count, so the outer query can combine it without changing the definition.
 *
 * `date_trunc('week', ...)` is Monday-based, which is what lib/dates.ts uses too.
 */
async function bucketSeries(
  scope: Scope,
  range: DateRange,
  f: PostFilters,
  g: Granularity,
): Promise<BucketRow[]> {
  if (scope.companyIds.length === 0) return [];
  const { rows } = await db.execute<BucketRow>(sql`
    WITH bucket_list AS (
      SELECT DISTINCT date_trunc(${g}::text, d.day::timestamp)::date AS bucket
        FROM generate_series(
          ${dayParam(range.start)},
          ${dayParam(range.end)},
          interval '1 day'
        ) AS d(day)
    ),
    pb AS (
      SELECT p.company_id,
             p.platform,
             date_trunc(${g}::text, p.posted_at AT TIME ZONE ${TZ})::date AS bucket,
             count(*)::int                        AS post_count,
             coalesce(sum(p.engagement_total), 0) AS engagement_total,
             coalesce(sum(p.applause), 0)         AS applause,
             coalesce(sum(p.conversation), 0)     AS conversation,
             coalesce(sum(p.amplification), 0)    AS amplification,
             coalesce(sum(p.saves), 0)            AS saves,
             coalesce(sum(p.views), 0)            AS views,
             coalesce(sum(
               p.engagement_total::numeric / nullif(p.followers_at_post, 0)
             ) FILTER (WHERE p.followers_at_post > 0), 0) AS follower_rate_sum,
             count(*) FILTER (
               WHERE p.followers_at_post > 0
             )::int                               AS rated_post_count
        FROM posts p
       WHERE ${postWhere(scope, range, f)}
       GROUP BY 1, 2, 3
    ),
    /*
     * Audience is a stock, and channels report it on mixed cadences: our own
     * collection is daily, imported RivalIQ history is weekly, and vendors
     * skip days. Summing only same-bucket readings made every company's total
     * collapse on the days some channels happened not to report and snap back
     * when they did — a square-wave artifact, not a follower story. Each
     * channel therefore carries its last known reading forward until a newer
     * one exists, bounded at AUDIENCE_CARRY_DAYS so a channel that stops
     * reporting ages out instead of contributing a stale count forever.
     * days_observed still counts real readings only; carrying a stock forward
     * is measurement persistence, but coverage reporting stays honest.
     */
    ab_readings AS (
      SELECT a.channel_id, a.day, a.followers
        FROM audience_snapshots a
        JOIN channels ch ON ch.id = a.channel_id
       WHERE ch.company_id IN (${idList(scope.companyIds)})
         AND ch.active
         AND NOT (ch.platform = 'reddit'::platform AND lower(ch.handle) LIKE 'u/%')
         ${f.platforms?.length
           ? sql`AND ch.platform IN (${platformList(f.platforms)})`
           : sql``}
         AND a.day >= ${dayParam(range.start)}::date - ${AUDIENCE_CARRY_DAYS}::int
         AND a.day <= ${dayParam(range.end)}
    ),
    ab_seed AS (
      SELECT DISTINCT ON (channel_id) channel_id, followers
        FROM ab_readings
       WHERE day < ${dayParam(range.start)}
       ORDER BY channel_id, day DESC
    ),
    ab_in_bucket AS (
      SELECT channel_id,
             date_trunc(${g}::text, day::timestamp)::date AS bucket,
             (array_agg(followers ORDER BY day DESC))[1] AS f_in_last,
             (array_agg(followers ORDER BY day ASC))[1]  AS f_in_first,
             count(*)::int AS days_observed
        FROM ab_readings
       WHERE day >= ${dayParam(range.start)}
       GROUP BY 1, 2
    ),
    ab_grid AS (
      SELECT ch.company_id, ch.platform, ch.id AS channel_id, b.bucket,
             ib.f_in_last, ib.f_in_first,
             coalesce(ib.days_observed, 0) AS days_observed,
             s.followers AS seed
        FROM channels ch
        CROSS JOIN bucket_list b
        LEFT JOIN ab_in_bucket ib ON ib.channel_id = ch.id AND ib.bucket = b.bucket
        LEFT JOIN ab_seed s ON s.channel_id = ch.id
       WHERE ch.company_id IN (${idList(scope.companyIds)})
         AND ch.active
         AND NOT (ch.platform = 'reddit'::platform AND lower(ch.handle) LIKE 'u/%')
         ${f.platforms?.length
           ? sql`AND ch.platform IN (${platformList(f.platforms)})`
           : sql``}
    ),
    ab_vp AS (
      /* vp increments on buckets with a real reading, so every (channel, vp)
       * partition holds exactly one non-null f_in_last: the value to carry. */
      SELECT *,
             count(f_in_last) OVER (PARTITION BY channel_id ORDER BY bucket
               ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS vp
        FROM ab_grid
    ),
    ab_channel AS (
      SELECT company_id, platform, channel_id, bucket, days_observed,
             carried,
             /* Value at bucket start: previous bucket's carried value, the
              * pre-window seed, or for a channel born inside this bucket its
              * first in-bucket reading (net change then starts at zero). */
             coalesce(
               lag(carried) OVER (PARTITION BY channel_id ORDER BY bucket),
               seed,
               f_in_first
             ) AS baseline
        FROM (
          SELECT *,
                 coalesce(max(f_in_last) OVER (PARTITION BY channel_id, vp), seed) AS carried
            FROM ab_vp
        ) carried_values
    ),
    ab AS (
      SELECT company_id, platform, bucket,
             coalesce(sum(carried), 0) AS followers_last,
             coalesce(sum(baseline) FILTER (WHERE carried IS NOT NULL), 0) AS followers_first,
             coalesce(min(days_observed) FILTER (WHERE days_observed > 0), 0) AS audience_days,
             coalesce(max(days_observed), 0) AS audience_max_days,
             count(*) FILTER (WHERE carried IS NOT NULL)::int AS audience_observed,
             count(*) FILTER (WHERE carried IS NOT NULL AND baseline IS NOT NULL)::int
               AS audience_change,
             /* Change compares the same channel set on both ends, or it lies. */
             coalesce(sum(carried) FILTER (WHERE carried IS NOT NULL AND baseline IS NOT NULL), 0)
               AS change_last_sum,
             coalesce(sum(baseline) FILTER (WHERE carried IS NOT NULL AND baseline IS NOT NULL), 0)
               AS change_first_sum
        FROM ab_channel
       GROUP BY 1, 2, 3
    ),
    cp AS (
      SELECT coalesce(pb.company_id, ab.company_id)  AS company_id,
             coalesce(pb.bucket, ab.bucket)          AS bucket,
             coalesce(pb.post_count, 0)              AS post_count,
             coalesce(pb.engagement_total, 0)        AS engagement_total,
             coalesce(pb.applause, 0)                AS applause,
             coalesce(pb.conversation, 0)            AS conversation,
             coalesce(pb.amplification, 0)           AS amplification,
             coalesce(pb.saves, 0)                   AS saves,
             coalesce(pb.views, 0)                   AS views,
             coalesce(pb.follower_rate_sum, 0)       AS follower_rate_sum,
             coalesce(pb.rated_post_count, 0)        AS rated_post_count,
             coalesce(ab.followers_last, 0)          AS followers_last,
             coalesce(ab.followers_first, 0)         AS followers_first,
             coalesce(ab.audience_days, 0)           AS audience_days,
             coalesce(ab.audience_max_days, 0)       AS audience_max_days,
             coalesce(ab.audience_observed, 0)       AS audience_observed,
             coalesce(ab.audience_change, 0)         AS audience_change,
             coalesce(ab.change_last_sum, 0)         AS change_last_sum,
             coalesce(ab.change_first_sum, 0)        AS change_first_sum
        FROM pb
        FULL OUTER JOIN ab
          ON ab.company_id = pb.company_id
         AND ab.platform   = pb.platform
         AND ab.bucket     = pb.bucket
    )
    SELECT company_id,
           bucket::text                    AS bucket,
           sum(post_count)::int            AS post_count,
           sum(engagement_total)           AS engagement_total,
           sum(applause)                   AS applause,
           sum(conversation)               AS conversation,
           sum(amplification)              AS amplification,
           sum(saves)                      AS saves,
           sum(views)                      AS views,
           sum(followers_last)             AS followers_last,
           sum(followers_first)            AS followers_first,
           min(audience_days)::int          AS audience_days,
           max(audience_max_days)::int      AS audience_max_days,
           sum(audience_observed)::int      AS audience_observed,
           sum(audience_change)::int        AS audience_change,
           sum(change_last_sum)             AS change_last_sum,
           sum(change_first_sum)            AS change_first_sum,
           coalesce(sum(follower_rate_sum)
                    FILTER (WHERE rated_post_count > 0), 0) AS erf_num,
           coalesce(sum(rated_post_count)
                    FILTER (WHERE rated_post_count > 0), 0)::int AS erf_posts
      FROM cp
     WHERE company_id IS NOT NULL AND bucket IS NOT NULL
     GROUP BY company_id, bucket
     ORDER BY bucket ASC
  `);
  return rows;
}

function bucketAgg(r: BucketRow): CompanyAgg {
  const audienceDays = num(r.audience_days);
  const audienceMaxDays = num(r.audience_max_days);
  const followersLast = num(r.followers_last);
  const followersFirst = num(r.followers_first);
  /*
   * Channel counts come from the carry-forward SQL now. A channel is tracked
   * for a bucket when it has any carriable reading by that bucket's end — a
   * channel that did not exist yet in 2025 does not blank a company's 2025
   * history, and one that stopped reporting ages out after the carry window.
   */
  const audienceObserved = num(r.audience_observed);
  const audienceChange = num(r.audience_change);
  return {
    companyId: r.company_id,
    posts: num(r.post_count),
    engagementTotal: num(r.engagement_total),
    applause: num(r.applause),
    conversation: num(r.conversation),
    amplification: num(r.amplification),
    saves: num(r.saves),
    views: num(r.views),
    postsMissingFollowers: 0,
    followersLast,
    followersFirst,
    audienceChangeLast: num(r.change_last_sum),
    audienceChangeFirst: num(r.change_first_sum),
    audienceDays,
    audienceMaxDays,
    trackedChannels: 1,
    ingestedChannels: 1,
    audienceTrackedChannels: audienceObserved,
    audienceObservedChannels: audienceObserved,
    audienceChangeChannels: audienceChange,
    applicablePlatforms: 1,
    erfNumerator: num(r.erf_num),
    erfPosts: num(r.erf_posts),
    byPlatform: new Map(),
  };
}

export async function getTimeSeries(
  q: Scoped<AnalyticsQuery & { metric: MetricKey }>,
): Promise<TimeSeriesResult> {
  const scope = await resolveScope(q);
  const range = rangeOf(q);
  const g: Granularity = q.granularity ?? autoGranularity(range);
  if (scope.companyIds.length === 0) return { series: [], companies: [], granularity: g };

  const rows = await bucketSeries(scope, range, filtersOf(q), g);

  // Share-of metrics need a per-bucket denominator across the whole landscape.
  const bucketTotals = new Map<string, LandscapeTotals>();
  for (const r of rows) {
    const t = bucketTotals.get(r.bucket) ?? { posts: 0, engagementTotal: 0, audience: 0 };
    t.posts += num(r.post_count);
    t.engagementTotal += num(r.engagement_total);
    t.audience += num(r.followers_last);
    bucketTotals.set(r.bucket, t);
  }

  const byBucket = new Map<string, Map<string, BucketRow>>();
  for (const r of rows) {
    const m = byBucket.get(r.bucket) ?? new Map<string, BucketRow>();
    m.set(r.company_id, r);
    byBucket.set(r.bucket, m);
  }

  // One "day" of the bucket for per-day style metrics; a week bucket is 7 days.
  /*
   * Days actually covered by a bucket, clipped to the window.
   *
   * This was a fixed 1, 7 or 30. Two errors followed. February was divided by
   * 30 and overstated by 7%, and every window's FIRST and LAST bucket is
   * partial but was still divided by a whole week or month, so the endpoints of
   * every Posts/Day line were systematically depressed. The endpoints are
   * exactly what a reader looks at to spot that a competitor has quietly
   * doubled their output.
   */
  const bucketDayCount = (bucket: string): number => {
    const start = parseLocalDay(bucket);
    if (!start) return g === 'day' ? 1 : g === 'week' ? 7 : 30;
    const nominalEnd = g === 'day'
      ? start
      : g === 'week'
        ? addZoneDays(start, 6)
        : endOfZoneMonth(start);
    // Clip to the requested window on both sides.
    const from = start < range.start ? range.start : start;
    const to = nominalEnd > range.end ? range.end : nominalEnd;
    return Math.max(1, daysIn({ start: from, end: to }));
  };
  const series: TimeSeriesPoint[] = [];
  for (const bucket of bucketsFor(range, g)) {
    const point: TimeSeriesPoint = { date: bucket };
    const t = bucketTotals.get(bucket) ?? { posts: 0, engagementTotal: 0, audience: 0 };
    const m = byBucket.get(bucket);
    for (const company of scope.companies) {
      const r = m?.get(company.id);
      if (!r) {
        point[company.id] = (
          q.metric === 'audience'
          || q.metric === 'audienceNetChange'
          || q.metric === 'audienceGrowthRate'
        ) ? null : 0;
        continue;
      }
      const agg = bucketAgg(r);
      point[company.id] = metricAvailable(agg, q.metric)
        ? metricValue(agg, q.metric, bucketDayCount(bucket), t)
        : null;
    }
    series.push(point);
  }

  return { series, companies: scope.companies, granularity: g };
}

/* ------------------------------------------------------------------ posts */

type PostRow = {
  id: string;
  company_id: string;
  company_name: string;
  company_slug: string;
  logo_url: string | null;
  color: string | null;
  segment: string | null;
  platform: Platform;
  type: PostType;
  posted_at: string;
  text: string | null;
  permalink: string | null;
  thumbnail_url: string | null;
  applause: string | number | null;
  conversation: string | number | null;
  amplification: string | number | null;
  saves: string | number | null;
  views: string | number | null;
  engagement_total: string | number | null;
  engagement_rate_by_follower: string | number | null;
  followers_at_post: string | number | null;
  median_engagement: string | number | null;
  total_count: string | number | null;
  tags: unknown;
  urls: unknown;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function coerceTags(v: unknown): PostDto['tags'] {
  if (!Array.isArray(v)) return [];
  const out: PostDto['tags'] = [];
  for (const item of v) {
    if (!isRecord(item)) continue;
    const id = str(item.id); const name = str(item.name);
    if (!id || !name) continue;
    out.push({ id, name, color: str(item.color) });
  }
  return out;
}

function coerceUrls(v: unknown): PostDto['urls'] {
  if (!Array.isArray(v)) return [];
  const out: PostDto['urls'] = [];
  for (const item of v) {
    if (!isRecord(item)) continue;
    const url = str(item.url); const domain = str(item.domain);
    if (!url) continue;
    out.push({ url, domain: domain ?? '' });
  }
  return out;
}

const SORT_COLUMNS: Record<SortKey, string> = {
  engagementTotal: 'f.engagement_total',
  engagementRateByFollower: 'f.engagement_rate_by_follower',
  postedAt: 'f.posted_at',
  applause: 'f.applause',
  conversation: 'f.conversation',
  amplification: 'f.amplification',
  views: 'f.views',
};

interface PostLoadOptions {
  /** Extra predicate applied to the OUTPUT rows only, not to the median baseline. */
  restrict?: SQL;
  /** Keep this many highest-engagement rows per platform before the final sort. */
  perPlatformLimit?: number;
  sort?: SortKey;
  direction?: 'asc' | 'desc';
  limit: number;
  offset: number;
}

interface LoadedPosts { items: PostDto[]; total: number }

/**
 * The single post-reading query. Everything that returns a `PostDto` goes through
 * here so the enrichment rules stay identical everywhere.
 *
 * Three things are worth calling out.
 *
 * 1. NO N+1. Tags and posted URLs arrive as aggregated JSON from two LATERAL
 *    subqueries -- one extra index scan per page of posts, not one query per post.
 *    Fetching 50 posts costs the same number of round trips as fetching 1.
 *
 * 2. OUTLIER SCORE USES A MEDIAN, NOT A MEAN. `percentile_cont(0.5) WITHIN GROUP`
 *    over the source channel's own posts inside the window. A mean would
 *    be dragged upward by the very viral post we are trying to identify, so every
 *    other post would look like an underperformer. The median is unmoved by the
 *    outlier, which is the entire point.
 *
 * 3. `count(*) OVER ()` returns the pagination total in the same round trip.
 *    Window functions are evaluated after WHERE and before LIMIT, so the number is
 *    the true filtered size rather than the size of the page.
 */
async function loadPosts(
  scope: Scope,
  range: DateRange,
  f: PostFilters,
  opts: PostLoadOptions,
): Promise<LoadedPosts> {
  if (scope.companyIds.length === 0) return { items: [], total: 0 };

  const sortCol = SORT_COLUMNS[opts.sort ?? 'engagementTotal'];
  const dir = opts.direction === 'asc' ? 'ASC' : 'DESC';
  const platformLimit = opts.perPlatformLimit
    ? Math.min(50, Math.max(1, Math.trunc(opts.perPlatformLimit)))
    : null;
  const platformRestriction = platformLimit === null
    ? null
    : sql`f.id IN (
        SELECT ranked.id
          FROM (
            SELECT candidate.id,
                   row_number() OVER (
                     PARTITION BY candidate.platform
                     ORDER BY candidate.engagement_total DESC, candidate.id ASC
                   ) AS platform_rank
              FROM filtered candidate
          ) ranked
         WHERE ranked.platform_rank <= ${platformLimit}
      )`;
  const restrict = opts.restrict && platformRestriction
    ? sql`WHERE (${opts.restrict}) AND (${platformRestriction})`
    : opts.restrict
      ? sql`WHERE ${opts.restrict}`
      : platformRestriction
        ? sql`WHERE ${platformRestriction}`
        : sql``;

  const { rows } = await db.execute<PostRow>(sql`
    WITH filtered AS (
      SELECT p.id, p.company_id, p.channel_id, p.platform, p.type, p.posted_at, p.text,
             p.permalink, p.thumbnail_url, p.applause, p.conversation,
             p.amplification, p.saves, p.views, p.engagement_total,
             p.engagement_rate_by_follower, p.followers_at_post
        FROM posts p
       WHERE ${postWhere(scope, range, f)}
    ),
    med AS (
      SELECT channel_id,
             percentile_cont(0.5) WITHIN GROUP (
               ORDER BY engagement_total::double precision
             ) AS median_engagement
        FROM filtered
       GROUP BY channel_id
    )
    SELECT f.id,
           f.company_id,
           c.name  AS company_name,
           c.slug  AS company_slug,
           c.logo_url,
           c.color,
           c.segment,
           f.platform,
           f.type,
           to_char(f.posted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS posted_at,
           f.text,
           f.permalink,
           f.thumbnail_url,
           f.applause,
           f.conversation,
           f.amplification,
           f.saves,
           f.views,
           f.engagement_total,
           f.engagement_rate_by_follower,
           f.followers_at_post,
           m.median_engagement,
           count(*) OVER () AS total_count,
           tg.tags,
           ur.urls
      FROM filtered f
      -- The filtered CTE already contains only verified landscape members. Company
      -- attribution is intentionally not another ownership check here.
      JOIN companies c ON c.id = f.company_id
      LEFT JOIN med m ON m.channel_id = f.channel_id
      LEFT JOIN LATERAL (
        SELECT json_agg(
                 json_build_object('id', t.id, 'name', t.name, 'color', t.color)
                 ORDER BY t.name
               ) AS tags
          FROM post_tag_assignments pta
          JOIN post_tags t ON t.id = pta.tag_id AND t.org_id = ${scope.orgId}::uuid
         WHERE pta.post_id = f.id
      ) tg ON TRUE
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(DISTINCT jsonb_build_object('url', u.url, 'domain', u.domain)) AS urls
          FROM posted_urls u
         WHERE u.post_id = f.id
      ) ur ON TRUE
      ${restrict}
     ORDER BY ${sql.raw(sortCol)} ${sql.raw(dir)} NULLS LAST, f.id ASC
     LIMIT ${opts.limit} OFFSET ${opts.offset}
  `);

  const items = rows.map((r): PostDto => {
    const engagementTotal = num(r.engagement_total);
    const median = numOrNull(r.median_engagement);
    return {
      id: r.id,
      company: {
        id: r.company_id,
        name: r.company_name,
        slug: r.company_slug,
        logoUrl: r.logo_url,
        color: r.color,
        segment: r.segment,
      },
      platform: r.platform,
      type: r.type,
      postedAt: r.posted_at,
      text: r.text,
      permalink: r.permalink,
      thumbnailUrl: r.thumbnail_url,
      applause: num(r.applause),
      conversation: num(r.conversation),
      amplification: num(r.amplification),
      saves: num(r.saves),
      views: num(r.views),
      engagementTotal,
      engagementRateByFollower: num(r.engagement_rate_by_follower),
      followersAtPost: numOrNull(r.followers_at_post),
      tags: coerceTags(r.tags),
      urls: coerceUrls(r.urls),
      medianEngagement: median,
      // A median of zero means at least half this company's posts on this platform
      // earned nothing, so a ratio would be meaningless rather than infinite.
      outlierScore: median && median > 0 ? engagementTotal / median : null,
    };
  });

  const total = rows.length > 0 ? num(rows[0].total_count) : 0;
  return { items, total };
}

export async function getPosts(q: Scoped<PostsQuery>): Promise<Paged<PostDto>> {
  const scope = await resolveScope(q);
  const page = Math.max(1, Math.trunc(q.page ?? 1));
  const pageSize = Math.min(200, Math.max(1, Math.trunc(q.pageSize ?? 25)));
  if (scope.companyIds.length === 0) return { items: [], total: 0, page, pageSize };

  const { items, total } = await loadPosts(scope, rangeOf(q), filtersOf(q), {
    sort: q.sort ?? 'engagementTotal',
    direction: q.direction ?? 'desc',
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });

  return { items, total, page, pageSize };
}

/**
 * Return a channel-balanced set for overview pages.
 *
 * A plain global LIMIT lets the selected scope's busiest network occupy every
 * card. Ranking inside each platform first preserves several winners per
 * channel, then the final total-engagement sort still puts the strongest work
 * first for the casual scan. Company scope remains whatever the caller selected;
 * overview screens must not silently narrow an all-landscape query to the focus.
 */
export async function getTopPostsByPlatform(
  q: Scoped<TopPostsQuery>,
): Promise<PostDto[]> {
  const scope = await resolveScope(q);
  if (scope.companyIds.length === 0) return [];
  const perPlatform = Math.min(18, Math.max(2, Math.trunc(q.perPlatform ?? 3)));
  const { items } = await loadPosts(scope, rangeOf(q), filtersOf(q), {
    perPlatformLimit: perPlatform,
    sort: 'engagementTotal',
    direction: 'desc',
    limit: perPlatform * 12,
    offset: 0,
  });
  return items;
}

type PostDetailRow = {
  channel_id: string;
  channel_handle: string;
  profile_url: string | null;
  avatar_url: string | null;
  media_url: string | null;
  duration_sec: string | number | null;
  language: string | null;
  hashtags: unknown;
  mentions: unknown;
  engagement_rate_by_view: string | number | null;
  first_seen_at: string;
  last_refreshed_at: string;
  tags: unknown;
  urls: unknown;
  metric_history: unknown;
};

function coerceStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(str).filter((item): item is string => item !== null);
}

function coerceDetailTags(value: unknown): PostDetailDto['tags'] {
  if (!Array.isArray(value)) return [];
  const out: PostDetailDto['tags'] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const id = str(item.id);
    const name = str(item.name);
    const source = str(item.source);
    if (!id || !name || !source || !['manual', 'rule', 'ai'].includes(source)) continue;
    out.push({
      id,
      name,
      color: str(item.color),
      source: source as PostDetailDto['tags'][number]['source'],
      confidence: numOrNull(item.confidence),
    });
  }
  return out;
}

function coerceDetailUrls(value: unknown): PostDetailDto['urls'] {
  if (!Array.isArray(value)) return [];
  const out: PostDetailDto['urls'] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const url = str(item.url);
    if (!url) continue;
    out.push({
      url,
      canonicalUrl: str(item.canonicalUrl),
      domain: str(item.domain) ?? '',
      title: str(item.title),
    });
  }
  return out;
}

function coerceMetricHistory(
  value: unknown,
  followersAtPost: number | null,
): PostDetailDto['metricHistory'] {
  if (!Array.isArray(value)) return [];
  const out: PostDetailDto['metricHistory'] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const capturedAt = str(item.capturedAt);
    if (!capturedAt) continue;
    const engagementTotal = num(item.engagementTotal);
    const views = num(item.views);
    out.push({
      capturedAt,
      applause: num(item.applause),
      conversation: num(item.conversation),
      amplification: num(item.amplification),
      saves: num(item.saves),
      views,
      engagementTotal,
      engagementRateByFollower:
        followersAtPost && followersAtPost > 0
          ? safeDivNull(engagementTotal, followersAtPost)
          : null,
      engagementRateByView: views > 0 ? safeDivNull(engagementTotal, views) : null,
    });
  }
  return out;
}

/**
 * The richer, on-demand post record used by the detail dialog.
 *
 * The summary is resolved through `loadPosts` first. That preserves the exact
 * explorer filters and source-channel median while proving the post belongs
 * to the caller's org-private landscape. Only then do we read the pooled post's
 * safe detail fields. Raw vendor payloads and channel adapter state never leave
 * the server.
 */
export async function getPostDetail(
  q: Scoped<PostsQuery> & { postId: string },
): Promise<PostDetailDto | null> {
  const scope = await resolveScope(q);
  if (scope.companyIds.length === 0) return null;

  const { items } = await loadPosts(scope, rangeOf(q), filtersOf(q), {
    restrict: sql`f.id = ${q.postId}::uuid`,
    sort: q.sort ?? 'engagementTotal',
    direction: q.direction ?? 'desc',
    limit: 1,
    offset: 0,
  });
  const summary = items[0];
  if (!summary) return null;

  const { rows } = await db.execute<PostDetailRow>(sql`
    SELECT p.channel_id,
           ch.handle AS channel_handle,
           ch.profile_url,
           ch.avatar_url,
           p.media_url,
           p.duration_sec,
           p.language,
           p.hashtags,
           p.mentions,
           p.engagement_rate_by_view,
           to_char(p.first_seen_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
             AS first_seen_at,
           to_char(p.last_refreshed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
             AS last_refreshed_at,
           coalesce((
             SELECT jsonb_agg(
                      jsonb_build_object(
                        'id', t.id,
                        'name', t.name,
                        'color', t.color,
                        'source', pta.source,
                        'confidence', pta.confidence
                      )
                      ORDER BY t.name
                    )
               FROM post_tag_assignments pta
               JOIN post_tags t
                 ON t.id = pta.tag_id AND t.org_id = ${scope.orgId}::uuid
              WHERE pta.post_id = p.id
           ), '[]'::jsonb) AS tags,
           coalesce((
             SELECT jsonb_agg(
                      jsonb_build_object(
                        'url', u.url,
                        'canonicalUrl', u.canonical_url,
                        'domain', u.domain,
                        'title', u.title
                      )
                      ORDER BY u.domain, u.url
                    )
               FROM posted_urls u
              WHERE u.post_id = p.id
           ), '[]'::jsonb) AS urls,
           coalesce((
             SELECT jsonb_agg(
                      jsonb_build_object(
                        'capturedAt',
                          to_char(
                            history.captured_at AT TIME ZONE 'UTC',
                            'YYYY-MM-DD"T"HH24:MI:SS"Z"'
                          ),
                        'applause', history.applause,
                        'conversation', history.conversation,
                        'amplification', history.amplification,
                        'saves', history.saves,
                        'views', history.views,
                        'engagementTotal', history.engagement_total
                      )
                      ORDER BY history.captured_at
                    )
               FROM (
                 SELECT captured_at, applause, conversation, amplification,
                        saves, views, engagement_total
                   FROM post_metric_snapshots
                  WHERE post_id = p.id
                  ORDER BY captured_at DESC
                  LIMIT 50
               ) history
           ), '[]'::jsonb) AS metric_history
      FROM posts p
      JOIN channels ch ON ch.id = p.channel_id
     WHERE p.id = ${q.postId}::uuid
       AND p.company_id IN (${idList(scope.companyIds)})
     LIMIT 1
  `);

  const row = rows[0];
  if (!row) return null;
  return {
    ...summary,
    channel: {
      id: row.channel_id,
      handle: row.channel_handle,
      profileUrl: row.profile_url,
      avatarUrl: row.avatar_url,
    },
    mediaUrl: row.media_url,
    durationSec: numOrNull(row.duration_sec),
    language: row.language,
    hashtags: coerceStringArray(row.hashtags),
    mentions: coerceStringArray(row.mentions),
    engagementRateByView: numOrNull(row.engagement_rate_by_view),
    firstSeenAt: row.first_seen_at,
    lastRefreshedAt: row.last_refreshed_at,
    tags: coerceDetailTags(row.tags),
    urls: coerceDetailUrls(row.urls),
    metricHistory: coerceMetricHistory(row.metric_history, summary.followersAtPost),
  };
}

/* ------------------------------------------------------------ posted URLs */

type UrlQueryRow = {
  key: string;
  domain: string | null;
  sample_url: string | null;
  title: string | null;
  post_count: string | number | null;
  engagement_total: string | number | null;
  companies: unknown;
};

/**
 * "What are they actually driving traffic to."
 *
 * The `linked` CTE uses DISTINCT ON (post, key) because a single post routinely
 * carries the same domain three times -- a headline link, a UTM-tagged variant and a
 * shortener that resolves to it. Counting those as three posts would inflate every
 * publisher's own domain to the top of the table. One post contributes to a key
 * exactly once, and its engagement is counted exactly once.
 */
export async function getPostedUrls(
  q: Scoped<AnalyticsQuery & { groupBy?: 'domain' | 'url' }>,
): Promise<UrlRow[]> {
  const scope = await resolveScope(q);
  if (scope.companyIds.length === 0) return [];

  const keyExpr = q.groupBy === 'url'
    ? sql`coalesce(u.canonical_url, u.url)`
    : sql`u.domain`;

  const { rows } = await db.execute<UrlQueryRow>(sql`
    WITH filtered AS (
      SELECT p.id, p.company_id, p.engagement_total
        FROM posts p
       WHERE ${postWhere(scope, rangeOf(q), filtersOf(q))}
    ),
    linked AS (
      SELECT DISTINCT ON (f.id, ${keyExpr})
             ${keyExpr}        AS key,
             u.domain          AS domain,
             u.url             AS url,
             u.title           AS title,
             f.id              AS post_id,
             f.company_id      AS company_id,
             f.engagement_total AS engagement_total
        FROM posted_urls u
        JOIN filtered f ON f.id = u.post_id
       ORDER BY f.id, ${keyExpr}, u.id
    ),
    per_company AS (
      SELECT key, company_id, count(*)::int AS post_count
        FROM linked
       GROUP BY key, company_id
    ),
    totals AS (
      SELECT key,
             min(domain)                                        AS domain,
             (array_agg(url ORDER BY engagement_total DESC))[1]  AS sample_url,
             (array_agg(title) FILTER (WHERE title IS NOT NULL))[1] AS title,
             count(*)::int                                      AS post_count,
             coalesce(sum(engagement_total), 0)                 AS engagement_total
        FROM linked
       GROUP BY key
    )
    SELECT t.key,
           t.domain,
           t.sample_url,
           t.title,
           t.post_count,
           t.engagement_total,
           json_agg(
             json_build_object('companyId', pc.company_id, 'postCount', pc.post_count)
             ORDER BY pc.post_count DESC
           ) AS companies
      FROM totals t
      JOIN per_company pc ON pc.key = t.key
     GROUP BY t.key, t.domain, t.sample_url, t.title, t.post_count, t.engagement_total
     ORDER BY t.engagement_total DESC, t.post_count DESC
     LIMIT 50
  `);

  return rows.map((r): UrlRow => {
    const postCount = num(r.post_count);
    const engagementTotal = num(r.engagement_total);
    const companies: UrlRow['companies'] = [];
    if (Array.isArray(r.companies)) {
      for (const item of r.companies) {
        if (!isRecord(item)) continue;
        const id = str(item.companyId);
        const company = id ? scope.byId.get(id) : undefined;
        if (!company) continue;
        companies.push({ company, postCount: num(item.postCount) });
      }
    }
    return {
      key: r.key,
      domain: r.domain ?? r.key,
      sampleUrl: r.sample_url ?? r.key,
      title: r.title,
      postCount,
      engagementTotal,
      engagementPerPost: safeDiv(engagementTotal, postCount),
      companies,
    };
  });
}

/* -------------------------------------------------------------------- tags */

type TagQueryRow = {
  tag_id: string;
  tag_name: string;
  tag_color: string | null;
  company_id: string;
  post_count: string | number | null;
  engagement_total: string | number | null;
  erf: string | number | null;
  rated_posts: string | number | null;
  total_posts: string | number | null;
  base_erf: string | number | null;
};

/**
 * Fold the bounded tag-by-company result set into one row per tag. Lift is the
 * tagged rate divided by the same company's untagged rate, weighted by the number
 * of tagged posts with a usable follower reading. That keeps a large account from
 * becoming every smaller account's baseline.
 */
function aggregateTagPerformanceRows(rows: readonly TagQueryRow[]): TagRow[] {
  type Aggregate = {
    tag: TagRow['tag'];
    postCount: number;
    engagementTotal: number;
    totalPosts: number;
    ratedPosts: number;
    weightedErf: number;
    comparableRatedPosts: number;
    weightedLift: number;
  };

  const byTag = new Map<string, Aggregate>();

  for (const row of rows) {
    const aggregate = byTag.get(row.tag_id) ?? {
      tag: { id: row.tag_id, name: row.tag_name, color: row.tag_color },
      postCount: 0,
      engagementTotal: 0,
      totalPosts: num(row.total_posts),
      ratedPosts: 0,
      weightedErf: 0,
      comparableRatedPosts: 0,
      weightedLift: 0,
    };
    const ratedPosts = num(row.rated_posts);
    const erf = num(row.erf);
    const baseline = numOrNull(row.base_erf);

    aggregate.postCount += num(row.post_count);
    aggregate.engagementTotal += num(row.engagement_total);
    aggregate.ratedPosts += ratedPosts;
    aggregate.weightedErf += erf * ratedPosts;

    if (ratedPosts > 0 && baseline !== null && baseline > 0) {
      const companyLift = safeDivNull(erf, baseline);
      if (companyLift !== null) {
        aggregate.comparableRatedPosts += ratedPosts;
        aggregate.weightedLift += companyLift * ratedPosts;
      }
    }

    byTag.set(row.tag_id, aggregate);
  }

  return [...byTag.values()]
    .map((aggregate): TagRow => ({
      tag: aggregate.tag,
      postCount: aggregate.postCount,
      engagementTotal: aggregate.engagementTotal,
      engagementPerPost: safeDiv(aggregate.engagementTotal, aggregate.postCount),
      engagementRateByFollower: safeDiv(aggregate.weightedErf, aggregate.ratedPosts),
      shareOfPosts: safeDiv(aggregate.postCount, aggregate.totalPosts),
      // Null, not 1.0: no same-company untagged baseline means no measurable lift.
      lift: safeDivNull(aggregate.weightedLift, aggregate.comparableRatedPosts),
    }))
    .sort(
      (a, b) =>
        b.engagementTotal - a.engagementTotal ||
        b.postCount - a.postCount ||
        a.tag.name.localeCompare(b.tag.name),
    );
}

/**
 * Tag performance, with each company's untagged baseline computed in the same
 * statement so `lift` is never assembled from queries that could see different
 * data.
 *
 * The engagement-rate averages are filtered to posts that actually carry a follower
 * reading. Including posts where we never captured an audience figure would score
 * them as a flat zero and quietly punish whichever tag happens to sit on the
 * channels we track least well.
 */
export async function getTagPerformance(q: Scoped<AnalyticsQuery>): Promise<TagRow[]> {
  const scope = await resolveScope(q);
  if (scope.companyIds.length === 0) return [];

  const { rows } = await db.execute<TagQueryRow>(sql`
    WITH filtered AS (
      -- followers_at_post is carried so the rate can be filtered on whether a
      -- post HAD a denominator, not on whether it earned anything.
      SELECT p.id, p.company_id, p.engagement_total, p.engagement_rate_by_follower,
             p.followers_at_post
        FROM posts p
       WHERE ${postWhere(scope, rangeOf(q), filtersOf(q))}
    ),
    overall AS (
      SELECT count(*)::int AS total_posts
        FROM filtered
    ),
    tag_company AS (
      SELECT t.id                                AS tag_id,
             t.name                              AS tag_name,
             t.color                             AS tag_color,
             f.company_id,
             count(*)::int                       AS post_count,
             coalesce(sum(f.engagement_total), 0) AS engagement_total,
             -- A post with a follower reading that earned nothing is a real
             -- zero and belongs in the average. Filtering on the RATE being
             -- positive dropped exactly the posts that should pull a tag down,
             -- so a tag on 100 posts where 60 flopped was scored on the 40 that
             -- did not. Lift compounded it, dividing one inflated rate by
             -- another inflated by a different amount.
             coalesce(avg(f.engagement_rate_by_follower)
                      FILTER (WHERE f.followers_at_post > 0), 0) AS erf,
             count(*) FILTER (WHERE f.followers_at_post > 0)::int AS rated_posts
        FROM post_tag_assignments pta
        JOIN filtered f  ON f.id = pta.post_id
        JOIN post_tags t ON t.id = pta.tag_id AND t.org_id = ${scope.orgId}::uuid
       GROUP BY t.id, t.name, t.color, f.company_id
    ),
    company_baselines AS (
      SELECT tc.tag_id,
             tc.company_id,
             avg(f.engagement_rate_by_follower)
               FILTER (
                 WHERE f.followers_at_post > 0
                   AND NOT EXISTS (
                     SELECT 1
                       FROM post_tag_assignments baseline_pta
                      WHERE baseline_pta.post_id = f.id
                        AND baseline_pta.tag_id = tc.tag_id
                   )
               ) AS base_erf
        FROM (SELECT DISTINCT tag_id, company_id FROM tag_company) tc
        JOIN filtered f ON f.company_id = tc.company_id
       GROUP BY tc.tag_id, tc.company_id
    )
    SELECT tc.*, overall.total_posts, cb.base_erf
      FROM tag_company tc
      CROSS JOIN overall
      LEFT JOIN company_baselines cb
        ON cb.tag_id = tc.tag_id AND cb.company_id = tc.company_id
     ORDER BY tc.engagement_total DESC
  `);

  return aggregateTagPerformanceRows(rows);
}

/* -------------------------------------------------------------- post types */

type PostTypeQueryRow = {
  type: PostType;
  post_count: string | number | null;
  engagement_total: string | number | null;
  erf: string | number | null;
};

/** Which formats earn their slot: photo vs reel vs link, on equal footing. */
export async function getPostTypePerformance(q: Scoped<AnalyticsQuery>): Promise<PostTypeRow[]> {
  const scope = await resolveScope(q);
  if (scope.companyIds.length === 0) return [];

  const { rows } = await db.execute<PostTypeQueryRow>(sql`
    SELECT p.type,
           count(*)::int                        AS post_count,
           coalesce(sum(p.engagement_total), 0) AS engagement_total,
           -- See the tag query: filter on having a denominator, not on having
           -- earned something, or every format's rate is inflated by the share
           -- of its posts that flopped.
           coalesce(avg(p.engagement_rate_by_follower)
                    FILTER (WHERE p.followers_at_post > 0), 0) AS erf
      FROM posts p
     WHERE ${postWhere(scope, rangeOf(q), filtersOf(q))}
     GROUP BY p.type
     ORDER BY engagement_total DESC
  `);

  return rows.map((r): PostTypeRow => {
    const postCount = num(r.post_count);
    const engagementTotal = num(r.engagement_total);
    return {
      type: r.type,
      postCount,
      engagementTotal,
      engagementPerPost: safeDiv(engagementTotal, postCount),
      engagementRateByFollower: num(r.erf),
    };
  });
}

/* ----------------------------------------------------------------- cadence */

type CadenceRow = {
  weekday: string | number | null;
  hour: string | number | null;
  post_count: string | number | null;
  engagement_per_post: string | number | null;
};

/**
 * The 7x24 "when do they post, and when does it work" grid.
 *
 * Both EXTRACTs run against `posted_at AT TIME ZONE 'America/New_York'`. Bucketing
 * in UTC would smear every weekday boundary by four or five hours and would move
 * with daylight saving twice a year, so a heatmap built in UTC quietly disagrees
 * with itself in March and November.
 *
 * Postgres `dow` is 0 = Sunday .. 6 = Saturday; the returned grid keeps that
 * convention so it lines up with JavaScript's `Date#getDay`.
 *
 * The full 168 cells are always returned, zero-filled. An empty cell is a finding --
 * "nobody in this landscape posts on Sunday morning" -- not missing data.
 */
export async function getPostingCadence(q: Scoped<AnalyticsQuery>): Promise<PostingCadenceCell[]> {
  const scope = await resolveScope(q);
  const grid: PostingCadenceCell[] = [];
  for (let weekday = 0; weekday < 7; weekday += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      grid.push({ weekday, hour, postCount: 0, engagementPerPost: 0 });
    }
  }
  if (scope.companyIds.length === 0) return grid;

  const { rows } = await db.execute<CadenceRow>(sql`
    SELECT EXTRACT(dow  FROM p.posted_at AT TIME ZONE ${TZ})::int AS weekday,
           EXTRACT(hour FROM p.posted_at AT TIME ZONE ${TZ})::int AS hour,
           count(*)::int                     AS post_count,
           coalesce(avg(p.engagement_total), 0) AS engagement_per_post
      FROM posts p
     WHERE ${postWhere(scope, rangeOf(q), filtersOf(q))}
     GROUP BY 1, 2
  `);

  for (const r of rows) {
    const weekday = num(r.weekday);
    const hour = num(r.hour);
    if (weekday < 0 || weekday > 6 || hour < 0 || hour > 23) continue;
    const cell = grid[weekday * 24 + hour];
    cell.postCount = num(r.post_count);
    cell.engagementPerPost = num(r.engagement_per_post);
  }
  return grid;
}

/* ---------------------------------------------------------------- summary */

const HEADLINE_KEYS = ['audience', 'posts', 'engagementTotal', 'engagementRateByFollower'] as const;

function focusScope(scope: Scope, company: CompanyRef): Scope {
  return { ...scope, companies: [company], companyIds: [company.id], byId: new Map([[company.id, company]]) };
}

type TopPostIdRow = { id: string };

/** One row per platform: the focus company's single best post there, by engagement. */
async function topPostIdPerPlatform(scope: Scope, range: DateRange, f: PostFilters): Promise<string[]> {
  if (scope.companyIds.length === 0) return [];
  const { rows } = await db.execute<TopPostIdRow>(sql`
    SELECT DISTINCT ON (p.platform) p.id
      FROM posts p
     WHERE ${postWhere(scope, range, f)}
     ORDER BY p.platform, p.engagement_total DESC, p.id ASC
  `);
  return rows.map((r) => r.id);
}

/**
 * The headline card.
 *
 * THE CLASSIC BUG IN THIS DOMAIN, STATED PLAINLY: audience is a STOCK and posts and
 * engagement are FLOWS, and they must not be aggregated the same way. `audience` is
 * the LATEST audience_snapshots row inside the window -- how many followers exist
 * right now. `posts` and `engagementTotal` are SUMS over every day of the window.
 * Summing audience_snapshots the way you sum engagement gives you followers
 * multiplied by the number of days in the range, so a brand with 100k followers
 * "has" 2.8 million over a 28-day window and 36.5 million over a year. Every
 * comparison built on top of that is then wrong in a way that looks plausible,
 * which is what makes it dangerous. `companyPlatformAgg` enforces the distinction in
 * SQL; this function just consumes it.
 *
 * The previous window is always computed here regardless of `compare`, because a
 * headline number without a direction of travel is not a headline.
 */
export async function getSummary(q: Scoped<AnalyticsQuery>): Promise<SummaryResult> {
  const scope = await resolveScope(q);
  const range = rangeOf(q);
  const prev = previousRange(range);
  const days = daysIn(range);
  const f = filtersOf(q);

  const focus = (scope.focusCompanyId ? scope.byId.get(scope.focusCompanyId) : undefined)
    ?? scope.companies[0]
    ?? null;

  const emptyStat = (key: MetricKey): HeadlineStat => ({
    key,
    value: 0,
    available: false,
    complete: false,
    previousValue: null,
    previousAvailable: false,
    previousComplete: false,
    changePct: null,
    spark: [],
  });

  const base = {
    focus,
    range: { start: toDayString(range.start), end: toDayString(range.end) },
    previousRange: { start: toDayString(prev.start), end: toDayString(prev.end) },
  };

  if (!focus) {
    return {
      ...base,
      headline: {
        audience: emptyStat('audience'),
        posts: emptyStat('posts'),
        engagementTotal: emptyStat('engagementTotal'),
        engagementRateByFollower: emptyStat('engagementRateByFollower'),
      },
      topPlatform: null,
      platformMix: [],
      topPosts: [],
      landscapeTotals: { posts: 0, engagementTotal: 0, audience: 0 },
    };
  }

  const fScope = focusScope(scope, focus);

  const [current, previousAgg, daily, topIds] = await Promise.all([
    companyPlatformAgg(scope, range, f),
    companyPlatformAgg(scope, prev, f),
    bucketSeries(fScope, range, f, 'day'),
    topPostIdPerPlatform(fScope, range, f),
  ]);

  const totals = totalsOf(current.values());
  const prevTotals = totalsOf(previousAgg.values());
  const focusAgg = current.get(focus.id) ?? emptyCompanyAgg(focus.id);
  const focusPrev = previousAgg.get(focus.id) ?? emptyCompanyAgg(focus.id);

  // Sparklines: one pass over the focus company's daily buckets serves all four cards.
  const dailyByBucket = new Map(daily.map((r) => [r.bucket, r]));
  const sparkFor = (key: MetricKey) => bucketsFor(range, 'day').map((date) => {
    const row = dailyByBucket.get(date);
    if (!row) {
      const audienceMetric =
        key === 'audience'
        || key === 'audienceNetChange'
        || key === 'audienceGrowthRate';
      return { date, value: audienceMetric ? null : 0 };
    }
    const agg = bucketAgg(row);
    return {
      date,
      value: metricAvailable(agg, key)
        ? metricValue(agg, key, 1, totals)
        : null,
    };
  });

  const stat = (key: MetricKey): HeadlineStat => {
    const available = metricAvailable(focusAgg, key);
    const complete = metricComplete(focusAgg, key);
    const previousAvailable = metricAvailable(focusPrev, key);
    const previousComplete = metricComplete(focusPrev, key);
    const value = metricValue(focusAgg, key, days, totals);
    const previousValue = previousAvailable
      ? metricValue(focusPrev, key, daysIn(prev), prevTotals)
      : null;
    return {
      key,
      value,
      available,
      complete,
      previousValue,
      previousAvailable,
      previousComplete,
      changePct: available && complete && previousAvailable && previousComplete
        ? changePct(value, previousValue)
        : null,
      spark: sparkFor(key),
    };
  };

  const headline = {
    audience: stat(HEADLINE_KEYS[0]),
    posts: stat(HEADLINE_KEYS[1]),
    engagementTotal: stat(HEADLINE_KEYS[2]),
    engagementRateByFollower: stat(HEADLINE_KEYS[3]),
  };

  let topPlatform: Platform | null = null;
  let best = -1;
  for (const [platform, p] of focusAgg.byPlatform) {
    if (p.engagementTotal > best) { best = p.engagementTotal; topPlatform = platform; }
  }

  // Platform mix: the focus company against the average of the competitors that are
  // actually present on that platform. Averaging in competitors with no channel there
  // would drag the benchmark toward zero and make every platform look like a win.
  const platforms = new Set<Platform>();
  for (const agg of current.values()) for (const p of agg.byPlatform.keys()) platforms.add(p);
  const platformMix: SummaryResult['platformMix'] = [];
  for (const platform of platforms) {
    const focusValue = focusAgg.byPlatform.get(platform)?.engagementTotal ?? 0;
    let sum = 0; let n = 0;
    for (const [companyId, agg] of current) {
      if (companyId === focus.id) continue;
      const p = agg.byPlatform.get(platform);
      if (!p || (p.posts === 0 && p.followersLast === 0)) continue;
      sum += p.engagementTotal; n += 1;
    }
    platformMix.push({
      platform,
      focusValue,
      competitorAverage: n > 0 ? sum / n : null,
      metric: 'engagementTotal',
    });
  }
  platformMix.sort((a, b) => b.focusValue - a.focusValue);

  const topPosts = topIds.length > 0
    ? (await loadPosts(fScope, range, f, {
        restrict: sql`f.id IN (${idList(topIds)})`,
        sort: 'engagementTotal',
        direction: 'desc',
        limit: topIds.length,
        offset: 0,
      })).items
    : [];

  return {
    ...base,
    headline,
    topPlatform,
    platformMix,
    topPosts,
    // Totals cover the companies currently in view. When the caller narrows
    // `companyIds`, share-of math is explicitly share-of-the-selection, and the UI
    // labels it that way rather than pretending the landscape shrank.
    landscapeTotals: totals,
  };
}

/* -------------------------------------------------------------- fact sheet */

function buildLeaderboardRows(
  scope: Scope,
  current: Map<string, CompanyAgg>,
  previousAgg: Map<string, CompanyAgg> | null,
  metric: MetricKey,
  days: number,
  prevDays: number,
  totals: LandscapeTotals,
  prevTotals: LandscapeTotals | null,
): MetricRow[] {
  const rows: MetricRow[] = [];
  for (const company of scope.companies) {
    const agg = current.get(company.id) ?? emptyCompanyAgg(company.id);
    const available = metricAvailable(agg, metric);
    const complete = metricComplete(agg, metric);
    const value = metricValue(agg, metric, days, totals);
    const previousCompanyAgg = previousAgg
      ? previousAgg.get(company.id) ?? emptyCompanyAgg(company.id)
      : null;
    const previousAvailable = previousCompanyAgg
      ? metricAvailable(previousCompanyAgg, metric)
      : false;
    const previousComplete = previousCompanyAgg
      ? metricComplete(previousCompanyAgg, metric)
      : false;
    const previousValue = previousCompanyAgg && prevTotals && previousAvailable
      ? metricValue(previousCompanyAgg, metric, prevDays, prevTotals)
      : null;
    rows.push({
      company,
      value,
      available,
      complete,
      previousValue,
      previousAvailable,
      previousComplete,
      changePct: available && complete && previousAvailable && previousComplete
        ? changePct(value, previousValue)
        : null,
      rank: 0,
      breakdown: breakdownOf(agg, metric, days, totals),
      breakdownAvailability: breakdownAvailabilityOf(agg, metric),
    });
  }
  rows.sort((x, y) =>
    Number(y.available) - Number(x.available)
    || (y.value - x.value)
    || x.company.name.localeCompare(y.company.name));
  let rank = 0;
  rows.forEach((r) => { r.rank = r.available ? ++rank : 0; });
  return rows;
}

/** Metrics a brief is allowed to lead with. Deliberately short. */
const FACTSHEET_METRICS: MetricKey[] = [
  'audience', 'audienceGrowthRate', 'posts', 'engagementTotal',
  'engagementPerPost', 'engagementRateByFollower', 'shareOfVoice', 'shareOfEngagement',
];

type AnomalyRow = {
  company_id: string;
  platform: Platform;
  cur_days: string | number | null;
  cur_eng: string | number | null;
  cur_posts: string | number | null;
  baseline_days: string | number | null;
  mean_eng: string | number | null;
  sd_eng: string | number | null;
  mean_posts: string | number | null;
  sd_posts: string | number | null;
};

/**
 * Anomaly detection: each company+platform is scored against ITS OWN recent history,
 * never against the landscape average. A public radio station is not abnormal for
 * behaving unlike a metro daily; it is abnormal for behaving unlike itself.
 *
 * The baseline is the four windows immediately preceding this one, aggregated to one
 * observation per active day. Standard deviation is the sample estimator, and rows
 * with fewer than five baseline observations or zero variance are dropped upstream --
 * a z-score computed from three data points is numerology, not statistics.
 *
 * Known limitation, stated rather than hidden: a day with no posts produces no row,
 * so the baseline describes typical ACTIVE days. That makes the detector slightly
 * conservative about volume drops, which is the direction we would rather err in.
 */
async function anomalyRows(scope: Scope, range: DateRange, f: PostFilters): Promise<AnomalyRow[]> {
  if (scope.companyIds.length === 0) return [];
  const days = daysIn(range);
  const baselineStart = new Date(range.start.getTime());
  baselineStart.setDate(baselineStart.getDate() - days * 4);
  const wide: DateRange = { start: baselineStart, end: range.end };

  const { rows } = await db.execute<AnomalyRow>(sql`
    WITH daily AS (
      SELECT p.company_id,
             p.platform,
             (p.posted_at AT TIME ZONE ${TZ})::date       AS d,
             count(*)::double precision                    AS posts,
             coalesce(sum(p.engagement_total), 0)::double precision AS eng
        FROM posts p
       WHERE ${postWhere(scope, wide, f)}
       GROUP BY 1, 2, 3
    ),
    base AS (
      SELECT company_id, platform,
             count(*)::int                    AS n,
             avg(eng)                         AS mean_eng,
             coalesce(stddev_samp(eng), 0)    AS sd_eng,
             avg(posts)                       AS mean_posts,
             coalesce(stddev_samp(posts), 0)  AS sd_posts
        FROM daily
       WHERE d < ${dayParam(range.start)}
       GROUP BY 1, 2
    ),
    cur AS (
      SELECT company_id, platform,
             count(*)::int AS n,
             avg(eng)      AS cur_eng,
             avg(posts)    AS cur_posts
        FROM daily
       WHERE d >= ${dayParam(range.start)}
       GROUP BY 1, 2
    )
    SELECT c.company_id,
           c.platform,
           c.n         AS cur_days,
           c.cur_eng,
           c.cur_posts,
           b.n         AS baseline_days,
           b.mean_eng,
           b.sd_eng,
           b.mean_posts,
           b.sd_posts
      FROM cur c
      JOIN base b ON b.company_id = c.company_id AND b.platform = c.platform
     WHERE b.n >= 5
  `);
  return rows;
}

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

function fmtSigned(n: number, digits = 1): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}`;
}

function buildAnomalies(scope: Scope, rows: AnomalyRow[]): FactSheet['anomalies'] {
  const out: FactSheet['anomalies'] = [];
  for (const r of rows) {
    const company = scope.byId.get(r.company_id);
    if (!company) continue;
    const label = PLATFORM_LABELS[r.platform] ?? r.platform;

    const checks: { metric: MetricKey; value: number; mean: number; sd: number; noun: string }[] = [
      { metric: 'engagementTotal', value: num(r.cur_eng), mean: num(r.mean_eng), sd: num(r.sd_eng), noun: 'daily engagement' },
      { metric: 'posts', value: num(r.cur_posts), mean: num(r.mean_posts), sd: num(r.sd_posts), noun: 'daily posting volume' },
    ];

    /*
     * The standard error of a MEAN, not the standard deviation of one day.
     *
     * `cur_eng` is an average over the window's active days, but it was being
     * divided by the standard deviation of a single day. Comparing a mean of n
     * observations against the spread of one understates z by a factor of √n,
     * roughly 5.3 on a 28-day window. It errs conservative, so nothing false
     * was published, but real movements were being dropped below the threshold
     * and the printed figure is quoted verbatim in the brief and used by the
     * prompt to tell the model how confident to sound.
     */
    const curDays = Math.max(1, num(r.cur_days));

    for (const c of checks) {
      if (c.sd <= 0) continue;
      const standardError = c.sd / Math.sqrt(curDays);
      const z = (c.value - c.mean) / standardError;
      if (!Number.isFinite(z) || Math.abs(z) <= 2) continue;
      const up = z > 0;
      out.push({
        kind: `${c.metric === 'posts' ? 'volume' : 'engagement'}_${up ? 'spike' : 'drop'}`,
        company: company.name,
        platform: r.platform,
        metric: c.metric,
        value: c.value,
        baseline: c.mean,
        zScore: z,
        statement:
          `${company.name}'s ${c.noun} on ${label} averaged ${fmtInt(c.value)} in this window, ` +
          `${up ? 'above' : 'below'} its own trailing baseline of ${fmtInt(c.mean)} ` +
          `(z = ${fmtSigned(z)} across ${num(r.baseline_days)} prior active days).`,
      });
    }
  }
  // Strongest signals first; a brief that opens with the fourth-most-interesting
  // movement is a brief nobody finishes.
  out.sort((a, b) => Math.abs(b.zScore ?? 0) - Math.abs(a.zScore ?? 0));
  return out.slice(0, 12);
}

type CoverageRow = {
  company_id: string;
  platform: Platform;
  channel_id: string;
  observed_days: string | number | null;
  /**
   * First day this channel was ever observed, ignoring the window.
   *
   * Without it a gap is unreadable: a channel with two of seven days looks
   * identical whether collection has been failing all week or simply had not
   * started yet on the Monday. The first case is a fault worth chasing and the
   * second is a fact about the estate that will never change, and reporting
   * them in the same sentence turns a real signal into fifteen lines of noise.
   */
  first_ever_day: string | null;
};

/** Platform coverage counts include only companies with a tracked account there. */
function platformAudienceCoverageCaveats(
  coverage: CoverageRow[],
  collectibleDays: number,
): string[] {
  const byPlatform = new Map<Platform, {
    trackedCompanies: Set<string>;
    incompleteCompanies: Set<string>;
    worst: number;
    never: number;
  }>();
  for (const row of coverage) {
    const missing = collectibleDays - num(row.observed_days);
    const entry = byPlatform.get(row.platform)
      ?? {
        trackedCompanies: new Set<string>(),
        incompleteCompanies: new Set<string>(),
        worst: 0,
        never: 0,
      };
    entry.trackedCompanies.add(row.company_id);
    if (!row.first_ever_day) entry.never += 1;
    else if (missing > 0) {
      entry.incompleteCompanies.add(row.company_id);
      entry.worst = Math.max(entry.worst, missing);
    }
    byPlatform.set(row.platform, entry);
  }

  const out: string[] = [];
  for (const [platform, entry] of [...byPlatform.entries()]
    .sort((a, b) => (
      b[1].never + b[1].incompleteCompanies.size
    ) - (
      a[1].never + a[1].incompleteCompanies.size
    ))) {
    const label = PLATFORM_LABELS[platform] ?? platform;
    if (entry.never > 0) {
      out.push(
        `${entry.never} of ${entry.trackedCompanies.size} tracked ${label} account` +
        `${entry.trackedCompanies.size === 1 ? '' : 's'} ` +
        `${entry.never === 1 ? 'has' : 'have'} never produced an audience reading.`,
      );
    } else if (entry.incompleteCompanies.size > 0) {
      out.push(
        `${entry.incompleteCompanies.size} of ${entry.trackedCompanies.size} tracked ${label} account` +
        `${entry.trackedCompanies.size === 1 ? '' : 's'} ` +
        `${entry.incompleteCompanies.size === 1 ? 'is' : 'are'} missing audience readings for up to ` +
        `${entry.worst} of ${collectibleDays} collectible day` +
        `${collectibleDays === 1 ? '' : 's'}.`,
      );
    }
  }
  return out;
}

/** How many days of audience data we actually hold per tracked channel. */
async function coverageRows(scope: Scope, range: DateRange, f: PostFilters): Promise<CoverageRow[]> {
  if (scope.companyIds.length === 0) return [];
  const platformFilter = f.platforms?.length
    ? sql` AND ch.platform IN (${platformList(f.platforms)})`
    : sql``;
  const { rows } = await db.execute<CoverageRow>(sql`
    SELECT ch.company_id,
           ch.platform,
           ch.id           AS channel_id,
           count(a.day)::int AS observed_days,
           -- Deliberately unbounded by the window: this answers "has this
           -- channel ever been collected", which the windowed count cannot.
           (SELECT min(f.day)::text FROM audience_snapshots f
             WHERE f.channel_id = ch.id) AS first_ever_day
      FROM channels ch
      LEFT JOIN audience_snapshots a
        ON a.channel_id = ch.id
       AND a.day >= ${dayParam(range.start)}
       AND a.day <= ${dayParam(range.end)}
     WHERE ch.company_id IN (${idList(scope.companyIds)})
       AND ch.active${platformFilter}
       AND NOT (ch.platform = 'reddit'::platform AND lower(ch.handle) LIKE 'u/%')
     GROUP BY ch.company_id, ch.platform, ch.id
  `);
  return rows;
}

/**
 * Auto-generated honesty strings.
 *
 * These are not decoration. The fact sheet is the only thing a language model is
 * allowed to see when it writes a brief, so anything the model would need in order
 * NOT to overclaim has to be stated here in plain English. A caveat that says
 * "Boston Herald posted only 3 times in the prior window, so its change figure is
 * unstable" is what stops a generated paragraph from announcing a 400% surge that is
 * really three posts becoming twelve. Trustworthy AI output is a data-layer
 * responsibility, not a prompt-engineering one.
 */
function buildCaveats(
  scope: Scope,
  range: DateRange,
  current: Map<string, CompanyAgg>,
  previousAgg: Map<string, CompanyAgg>,
  coverage: CoverageRow[],
): string[] {
  const out: string[] = [];
  const thinAudience: string[] = [];
  const days = daysIn(range);

  if (days < 7) {
    out.push(
      `This window is only ${days} day${days === 1 ? '' : 's'} long, so day-of-week effects ` +
      'are not averaged out and every comparison here is noisier than a weekly view.',
    );
  }

  /*
   * A window ending today is short by however much of today has not happened.
   *
   * Every preset runs to endOfDay(now), so "last 7 days" is really six full
   * days plus however far into the seventh we are, compared against seven
   * complete days. At 9am that is roughly a 9% negative bias on every flow
   * metric's change, applied to every company at once, and nothing said so.
   */
  const nowMs = Date.now();
  if (range.end.getTime() > nowMs) {
    const elapsedToday = (nowMs - startOfZoneDay(new Date(nowMs)).getTime()) / 86_400_000;
    const shortfall = Math.round((1 - elapsedToday) / days * 100);
    if (shortfall >= 3) {
      out.push(
        `This window includes today, which is only ${Math.round(elapsedToday * 100)}% elapsed. ` +
        `It therefore holds about ${shortfall}% less time than the complete window it is ` +
        'compared against, so posting and engagement changes read low for that reason alone.',
      );
    }
  }

  for (const company of scope.companies) {
    const cur = current.get(company.id) ?? emptyCompanyAgg(company.id);
    const prev = previousAgg.get(company.id) ?? emptyCompanyAgg(company.id);

    if (prev.posts === 0 && cur.posts > 0) {
      out.push(
        `${company.name} published nothing in the prior window, so its percent change is ` +
        'undefined and is reported blank rather than as an enormous percentage.',
      );
    } else if (prev.posts > 0 && prev.posts < 5) {
      out.push(
        `${company.name} posted only ${prev.posts} time${prev.posts === 1 ? '' : 's'} in the prior ` +
        'window, so its change figure is unstable.',
      );
    }

    if (cur.posts === 0 && cur.followersLast === 0) {
      out.push(
        `No post or audience observations were collected for ${company.name} in this window. ` +
        'Unavailable metrics are left blank and the company is not assigned a measured rank.',
      );
    } else if (cur.posts > 0 && cur.postsMissingFollowers > 0) {
      const share = safeDiv(cur.postsMissingFollowers, cur.posts);
      if (share >= 0.1) {
        out.push(
          `${Math.round(share * 100)}% of ${company.name}'s posts in this window carry no ` +
          'follower reading, so its engagement rate by follower is computed from the remainder ' +
          'and understates true reach.',
        );
      }
    }

    if (cur.applicablePlatforms > 0 && cur.audienceDays < 2) {
      thinAudience.push(company.name);
    }
  }

  // One line, however many companies. Net change needs two readings to
  // subtract; naming each company that lacks them separately says the same
  // thing N times and pushes the substantive caveats off the end of the list.
  if (thinAudience.length > 0) {
    out.push(
      (thinAudience.length === 1
        ? `${thinAudience[0]} has`
        : `${thinAudience.length} companies have`) +
      ' fewer than two audience readings on at least one channel in this window, so audience ' +
      'net change and growth rate are unavailable for ' +
      (thinAudience.length === 1 ? 'it' : 'them') + ': ' +
      thinAudience.slice(0, 6).join(', ') +
      (thinAudience.length > 6 ? ` and ${thinAudience.length - 6} more.` : '.'),
    );
  }

  /*
   * Audience coverage, said once rather than once per channel.
   *
   * The previous version emitted a line for every company and platform with a
   * gap, which on a landscape of 22 companies across 8 platforms could reach
   * 176 lines truncated to 15. The result read like a fault log and buried the
   * two facts a reader actually needs: when collection started, and which
   * platform is genuinely broken. Both are stated below in one line each.
   */
  const startedAt = coverage
    .map((r) => r.first_ever_day)
    .filter((d): d is string => Boolean(d))
    .sort()[0];

  // Days of the window that predate collection entirely. Not a fault, and not
  // fixable: a follower count is only knowable on the day it is read.
  const startedOn = startedAt ? parseLocalDay(startedAt) : null;
  const preCollectionDays = startedOn && startedOn > range.start
    ? Math.max(0, Math.min(days, daysIn({ start: range.start, end: startedOn }) - 1))
    : 0;

  if (preCollectionDays > 0) {
    out.push(
      `Audience collection began ${startedAt}, which is ${preCollectionDays} day` +
      `${preCollectionDays === 1 ? '' : 's'} after this window opens. Follower readings for ` +
      'those days were never taken and cannot be recovered, so growth figures here are ' +
      'measured from the first day on record rather than the first day of the window.',
    );
  }

  // Real gaps only: days when collection was running and still missed a channel.
  const collectible = Math.max(1, days - preCollectionDays);
  out.push(...platformAudienceCoverageCaveats(coverage, collectible));

  return out.slice(0, 15);
}

/**
 * Assemble everything a brief is permitted to cite, in one pass.
 *
 * The model that writes the brief never queries the database. It gets this object
 * and nothing else, which means every claim in generated prose is traceable to a row
 * here — and every number it could get wrong is a number it never had to derive.
 */
export async function getFactSheet(q: Scoped<AnalyticsQuery>): Promise<FactSheet> {
  const scope = await resolveScope(q);
  const range = rangeOf(q);
  const prev = previousRange(range);
  const days = daysIn(range);
  const prevDays = daysIn(prev);
  const f = filtersOf(q);

  const focusCompany = scope.focusCompanyId
    ? scope.byId.get(scope.focusCompanyId)?.name ?? null
    : null;

  const shell: FactSheet = {
    landscape: { id: scope.landscapeId, name: scope.landscapeName, focusCompany },
    range: { start: toDayString(range.start), end: toDayString(range.end), days },
    previousRange: { start: toDayString(prev.start), end: toDayString(prev.end) },
    companies: scope.companies,
    leaderboards: {},
    focusSummary: null,
    topPostsOverall: [],
    tagPerformance: [],
    postTypePerformance: [],
    notableUrls: [],
    anomalies: [],
    caveats: [],
  };
  if (scope.companyIds.length === 0) return shell;

  const [
    current, previousAgg, topOverall, tagPerformance,
    postTypePerformance, notableUrls, anomalySource, coverage, focusSummary,
  ] = await Promise.all([
    companyPlatformAgg(scope, range, f),
    companyPlatformAgg(scope, prev, f),
    loadPosts(scope, range, f, { sort: 'engagementTotal', direction: 'desc', limit: 10, offset: 0 }),
    getTagPerformance(q),
    getPostTypePerformance(q),
    getPostedUrls({ ...q, groupBy: 'domain' }),
    anomalyRows(scope, range, f),
    coverageRows(scope, range, f),
    getSummary(q),
  ]);

  const totals = totalsOf(current.values());
  const prevTotals = totalsOf(previousAgg.values());

  const leaderboards: FactSheet['leaderboards'] = {};
  for (const metric of FACTSHEET_METRICS) {
    leaderboards[metric] = buildLeaderboardRows(
      scope, current, previousAgg, metric, days, prevDays, totals, prevTotals,
    );
  }

  return {
    ...shell,
    leaderboards,
    focusSummary,
    topPostsOverall: topOverall.items,
    tagPerformance,
    postTypePerformance,
    notableUrls,
    anomalies: buildAnomalies(scope, anomalySource),
    caveats: buildCaveats(scope, range, current, previousAgg, coverage),
  };
}

/* ------------------------------------------------------------------ export */

/**
 * The contract, satisfied. Server Components import the named functions directly;
 * API routes and tests can depend on this object when they want the interface type.
 */
export const metrics: MetricsApi = {
  getSummary,
  getLeaderboard,
  getTimeSeries,
  getPosts,
  getTopPostsByPlatform,
  getPostedUrls,
  getTagPerformance,
  getPostTypePerformance,
  getPostingCadence,
  getFactSheet,
};

export default metrics;
