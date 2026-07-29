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
import { autoGranularity, daysIn, previousRange, toDayString } from '@/lib/dates';
import type {
  FactSheet,
  HeadlineStat,
  MetricsApi,
  PostDto,
  PostTypeRow,
  PostingCadenceCell,
  PostsQuery,
  SortKey,
  SummaryResult,
  TagRow,
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
  const orgGuard = q.orgId ? sql` AND l.org_id = ${q.orgId}::uuid` : sql``;
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
      LEFT JOIN companies c ON c.id = lc.company_id AND c.org_id = l.org_id
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
  const pct = (current - previous) / previous;
  return Number.isFinite(pct) ? pct : null;
}

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
    // EXISTS rather than a JOIN: a post with three matching tags must still count once.
    parts.push(sql`EXISTS (
      SELECT 1 FROM post_tag_assignments pta
       WHERE pta.post_id = p.id AND pta.tag_id IN (${idList(f.tagIds)})
    )`);
  }
  if (f.search && f.search.trim()) {
    const needle = `%${f.search.trim()}%`;
    parts.push(sql`p.text ILIKE ${needle}`);
  }
  return sql.join(parts, sql` AND `);
}

/** Audience is channel-scoped, so it takes only the company and platform filters. */
function audienceWhere(scope: Scope, range: DateRange, f: PostFilters): SQL {
  const parts: SQL[] = [
    sql`ch.company_id IN (${idList(scope.companyIds)})`,
    sql`a.day >= ${dayParam(range.start)}`,
    sql`a.day <= ${dayParam(range.end)}`,
  ];
  if (f.platforms?.length) parts.push(sql`ch.platform IN (${platformList(f.platforms)})`);
  return sql.join(parts, sql` AND `);
}

function filtersOf(q: AnalyticsQuery & { search?: string }): PostFilters {
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
  followers_last: string | number | null;
  followers_first: string | number | null;
  audience_days: string | number | null;
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
  /** Latest follower reading inside the window -- a stock. */
  followersLast: number;
  /** Earliest follower reading inside the window. */
  followersFirst: number;
  /** How many days of the window actually have an audience reading. */
  audienceDays: number;
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
  /**
   * Sum over platforms of (platform engagement / platform followers). Divide by
   * `erfPosts` to get engagement rate by follower. Kept separate so the rate is
   * computed per company+platform and then combined, never by dividing one grand
   * total by another -- which would let a company's biggest platform swamp the rate.
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
    followersLast: 0, followersFirst: 0, erfNumerator: 0, erfPosts: 0,
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
 * FULL OUTER JOIN because a company can have audience with no posts (a dormant
 * account) or posts with no audience reading (a channel we just started tracking),
 * and both are facts worth reporting rather than rows to drop.
 */
async function companyPlatformAgg(
  scope: Scope,
  range: DateRange,
  f: PostFilters,
): Promise<Map<string, CompanyAgg>> {
  const out = new Map<string, CompanyAgg>();
  if (scope.companyIds.length === 0) return out;

  const { rows } = await db.execute<AggRow>(sql`
    WITH aud_channel AS (
      SELECT ch.company_id,
             ch.platform,
             a.channel_id,
             (array_agg(a.followers ORDER BY a.day DESC))[1] AS f_last,
             (array_agg(a.followers ORDER BY a.day ASC))[1]  AS f_first,
             count(*)::int                                    AS days_observed
        FROM audience_snapshots a
        JOIN channels ch ON ch.id = a.channel_id
       WHERE ${audienceWhere(scope, range, f)}
       GROUP BY ch.company_id, ch.platform, a.channel_id
    ),
    aud AS (
      SELECT company_id,
             platform,
             sum(f_last)        AS followers_last,
             sum(f_first)       AS followers_first,
             max(days_observed) AS audience_days
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
             )::int                               AS posts_missing_followers
        FROM posts p
       WHERE ${postWhere(scope, range, f)}
       GROUP BY p.company_id, p.platform
    )
    SELECT coalesce(pa.company_id, aud.company_id) AS company_id,
           coalesce(pa.platform, aud.platform)     AS platform,
           coalesce(pa.post_count, 0)              AS post_count,
           coalesce(pa.engagement_total, 0)        AS engagement_total,
           coalesce(pa.applause, 0)                AS applause,
           coalesce(pa.conversation, 0)            AS conversation,
           coalesce(pa.amplification, 0)           AS amplification,
           coalesce(pa.saves, 0)                   AS saves,
           coalesce(pa.views, 0)                   AS views,
           coalesce(pa.posts_missing_followers, 0) AS posts_missing_followers,
           aud.followers_last,
           aud.followers_first,
           aud.audience_days
      FROM pa
      FULL OUTER JOIN aud
        ON aud.company_id = pa.company_id AND aud.platform = pa.platform
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
      followersLast: num(r.followers_last),
      followersFirst: num(r.followers_first),
      audienceDays: num(r.audience_days),
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
    agg.followersLast += p.followersLast;
    agg.followersFirst += p.followersFirst;

    // Engagement rate is only meaningful where we know the audience size.
    if (p.followersLast > 0 && p.posts > 0) {
      agg.erfNumerator += p.engagementTotal / p.followersLast;
      agg.erfPosts += p.posts;
    }
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
 * Turn a rolled-up aggregate into one metric. This is the single definition of
 * every metric in the product; `definitions.ts` describes these formulas in prose
 * and the two must always agree.
 */
function metricValue(a: CompanyAgg, key: MetricKey, days: number, t: LandscapeTotals): number {
  switch (key) {
    case 'audience': return a.followersLast;
    case 'audienceNetChange': return a.followersLast - a.followersFirst;
    case 'audienceGrowthRate': return safeDiv(a.followersLast - a.followersFirst, a.followersFirst);
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
    erfNumerator: p.followersLast > 0 && p.posts > 0 ? p.engagementTotal / p.followersLast : 0,
    erfPosts: p.followersLast > 0 && p.posts > 0 ? p.posts : 0,
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
  const [current, previousAgg] = await Promise.all([
    companyPlatformAgg(scope, range, f),
    prev ? companyPlatformAgg(scope, prev, f) : Promise.resolve(null),
  ]);

  const totals = totalsOf(current.values());
  const prevTotals = previousAgg ? totalsOf(previousAgg.values()) : null;
  const prevDays = prev ? daysIn(prev) : days;

  const rows: MetricRow[] = [];
  for (const company of scope.companies) {
    const agg = current.get(company.id) ?? emptyCompanyAgg(company.id);
    const value = metricValue(agg, q.metric, days, totals);
    let previousValue: number | null = null;
    if (previousAgg && prevTotals) {
      const pa = previousAgg.get(company.id) ?? emptyCompanyAgg(company.id);
      previousValue = metricValue(pa, q.metric, prevDays, prevTotals);
    }
    rows.push({
      company,
      value,
      previousValue,
      changePct: changePct(value, previousValue),
      rank: 0,
      breakdown: breakdownOf(agg, q.metric, days, totals),
    });
  }

  // Every metric in the vocabulary is "higher is better"; ties break alphabetically
  // so a leaderboard of all zeros is still stable between renders.
  rows.sort((x, y) => (y.value - x.value) || x.company.name.localeCompare(y.company.name));
  rows.forEach((r, i) => { r.rank = i + 1; });
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
  erf_num: string | number | null;
  erf_posts: string | number | null;
};

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
 * company+bucket. That extra level exists solely so engagement rate by follower can
 * be formed per platform before being combined -- collapsing to company first would
 * divide one company's total engagement by its total followers across platforms,
 * which double-counts anyone who follows the same brand in two places.
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
    WITH pb AS (
      SELECT p.company_id,
             p.platform,
             date_trunc(${g}::text, p.posted_at AT TIME ZONE ${TZ})::date AS bucket,
             count(*)::int                        AS post_count,
             coalesce(sum(p.engagement_total), 0) AS engagement_total,
             coalesce(sum(p.applause), 0)         AS applause,
             coalesce(sum(p.conversation), 0)     AS conversation,
             coalesce(sum(p.amplification), 0)    AS amplification,
             coalesce(sum(p.saves), 0)            AS saves,
             coalesce(sum(p.views), 0)            AS views
        FROM posts p
       WHERE ${postWhere(scope, range, f)}
       GROUP BY 1, 2, 3
    ),
    ab_channel AS (
      SELECT ch.company_id,
             ch.platform,
             a.channel_id,
             date_trunc(${g}::text, a.day::timestamp)::date AS bucket,
             (array_agg(a.followers ORDER BY a.day DESC))[1] AS f_last,
             (array_agg(a.followers ORDER BY a.day ASC))[1]  AS f_first
        FROM audience_snapshots a
        JOIN channels ch ON ch.id = a.channel_id
       WHERE ${audienceWhere(scope, range, f)}
       GROUP BY 1, 2, 3, 4
    ),
    ab AS (
      SELECT company_id, platform, bucket,
             sum(f_last)  AS followers_last,
             sum(f_first) AS followers_first
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
             coalesce(ab.followers_last, 0)          AS followers_last,
             coalesce(ab.followers_first, 0)         AS followers_first
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
           coalesce(sum(engagement_total::numeric / nullif(followers_last, 0))
                    FILTER (WHERE followers_last > 0 AND post_count > 0), 0) AS erf_num,
           coalesce(sum(post_count)
                    FILTER (WHERE followers_last > 0 AND post_count > 0), 0)::int AS erf_posts
      FROM cp
     WHERE company_id IS NOT NULL AND bucket IS NOT NULL
     GROUP BY company_id, bucket
     ORDER BY bucket ASC
  `);
  return rows;
}

function bucketAgg(r: BucketRow): CompanyAgg {
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
    followersLast: num(r.followers_last),
    followersFirst: num(r.followers_first),
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
  const bucketDays = g === 'day' ? 1 : g === 'week' ? 7 : 30;
  const series: TimeSeriesPoint[] = [];
  for (const bucket of bucketsFor(range, g)) {
    const point: TimeSeriesPoint = { date: bucket };
    const t = bucketTotals.get(bucket) ?? { posts: 0, engagementTotal: 0, audience: 0 };
    const m = byBucket.get(bucket);
    for (const company of scope.companies) {
      const r = m?.get(company.id);
      point[company.id] = r ? metricValue(bucketAgg(r), q.metric, bucketDays, t) : 0;
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
 *    over the company's own posts on that platform inside the window. A mean would
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
  const restrict = opts.restrict ? sql`WHERE ${opts.restrict}` : sql``;

  const { rows } = await db.execute<PostRow>(sql`
    WITH filtered AS (
      SELECT p.id, p.company_id, p.platform, p.type, p.posted_at, p.text,
             p.permalink, p.thumbnail_url, p.applause, p.conversation,
             p.amplification, p.saves, p.views, p.engagement_total,
             p.engagement_rate_by_follower, p.followers_at_post
        FROM posts p
       WHERE ${postWhere(scope, range, f)}
    ),
    med AS (
      SELECT company_id, platform,
             percentile_cont(0.5) WITHIN GROUP (
               ORDER BY engagement_total::double precision
             ) AS median_engagement
        FROM filtered
       GROUP BY company_id, platform
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
      JOIN companies c ON c.id = f.company_id AND c.org_id = ${scope.orgId}::uuid
      LEFT JOIN med m ON m.company_id = f.company_id AND m.platform = f.platform
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
  post_count: string | number | null;
  engagement_total: string | number | null;
  erf: string | number | null;
  total_posts: string | number | null;
  base_erf: string | number | null;
};

/**
 * Tag performance, with the landscape-wide baseline computed in the same statement
 * so `lift` is never assembled from two queries that could see different data.
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
      SELECT p.id, p.engagement_total, p.engagement_rate_by_follower
        FROM posts p
       WHERE ${postWhere(scope, rangeOf(q), filtersOf(q))}
    ),
    overall AS (
      SELECT count(*)::int AS total_posts,
             coalesce(avg(engagement_rate_by_follower)
                      FILTER (WHERE engagement_rate_by_follower > 0), 0) AS base_erf
        FROM filtered
    ),
    per_tag AS (
      SELECT t.id                                AS tag_id,
             t.name                              AS tag_name,
             t.color                             AS tag_color,
             count(*)::int                       AS post_count,
             coalesce(sum(f.engagement_total), 0) AS engagement_total,
             coalesce(avg(f.engagement_rate_by_follower)
                      FILTER (WHERE f.engagement_rate_by_follower > 0), 0) AS erf
        FROM post_tag_assignments pta
        JOIN filtered f  ON f.id = pta.post_id
        JOIN post_tags t ON t.id = pta.tag_id AND t.org_id = ${scope.orgId}::uuid
       GROUP BY t.id, t.name, t.color
    )
    SELECT per_tag.*, overall.total_posts, overall.base_erf
      FROM per_tag CROSS JOIN overall
     ORDER BY per_tag.engagement_total DESC
  `);

  return rows.map((r): TagRow => {
    const postCount = num(r.post_count);
    const engagementTotal = num(r.engagement_total);
    const erf = num(r.erf);
    const baseErf = num(r.base_erf);
    return {
      tag: { id: r.tag_id, name: r.tag_name, color: r.tag_color },
      postCount,
      engagementTotal,
      engagementPerPost: safeDiv(engagementTotal, postCount),
      engagementRateByFollower: erf,
      shareOfPosts: safeDiv(postCount, num(r.total_posts)),
      // Null, not 1.0: with no measurable baseline there is nothing to have lift over.
      lift: safeDivNull(erf, baseErf),
    };
  });
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
           coalesce(avg(p.engagement_rate_by_follower)
                    FILTER (WHERE p.engagement_rate_by_follower > 0), 0) AS erf
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
    key, value: 0, previousValue: null, changePct: null, spark: [],
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
    return { date, value: row ? metricValue(bucketAgg(row), key, 1, totals) : 0 };
  });

  const stat = (key: MetricKey): HeadlineStat => {
    const value = metricValue(focusAgg, key, days, totals);
    const previousValue = metricValue(focusPrev, key, daysIn(prev), prevTotals);
    return { key, value, previousValue, changePct: changePct(value, previousValue), spark: sparkFor(key) };
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
    const value = metricValue(agg, metric, days, totals);
    const previousValue = previousAgg && prevTotals
      ? metricValue(previousAgg.get(company.id) ?? emptyCompanyAgg(company.id), metric, prevDays, prevTotals)
      : null;
    rows.push({
      company,
      value,
      previousValue,
      changePct: changePct(value, previousValue),
      rank: 0,
      breakdown: breakdownOf(agg, metric, days, totals),
    });
  }
  rows.sort((x, y) => (y.value - x.value) || x.company.name.localeCompare(y.company.name));
  rows.forEach((r, i) => { r.rank = i + 1; });
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

    for (const c of checks) {
      if (c.sd <= 0) continue;
      const z = (c.value - c.mean) / c.sd;
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
};

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
           count(a.day)::int AS observed_days
      FROM channels ch
      LEFT JOIN audience_snapshots a
        ON a.channel_id = ch.id
       AND a.day >= ${dayParam(range.start)}
       AND a.day <= ${dayParam(range.end)}
     WHERE ch.company_id IN (${idList(scope.companyIds)})
       AND ch.active${platformFilter}
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
  const days = daysIn(range);

  if (days < 7) {
    out.push(
      `This window is only ${days} day${days === 1 ? '' : 's'} long, so day-of-week effects ` +
      'are not averaged out and every comparison here is noisier than a weekly view.',
    );
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
        `No data at all was collected for ${company.name} in this window, so it appears at zero ` +
        'rather than being excluded — treat its rank as unknown, not as last place.',
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
  }

  // Audience coverage gaps, rolled up to one line per company+platform.
  const gaps = new Map<string, number>();
  for (const r of coverage) {
    const missing = days - num(r.observed_days);
    if (missing <= 0) continue;
    const key = `${r.company_id}|${r.platform}`;
    gaps.set(key, Math.max(gaps.get(key) ?? 0, missing));
  }
  for (const [key, missing] of gaps) {
    const [companyId, platform] = key.split('|');
    const company = scope.byId.get(companyId);
    if (!company) continue;
    const label = PLATFORM_LABELS[platform as Platform] ?? platform;
    out.push(
      missing >= days
        ? `${label} audience data for ${company.name} is missing for the entire window, so its ` +
          'audience and growth figures exclude that channel.'
        : `${label} data for ${company.name} is missing for ${missing} day${missing === 1 ? '' : 's'} ` +
          'in this window.',
    );
  }

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
  getPostedUrls,
  getTagPerformance,
  getPostTypePerformance,
  getPostingCadence,
  getFactSheet,
};

export default metrics;
