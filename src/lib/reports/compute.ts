/**
 * The computed half of the weekly report.
 *
 * Everything in here is derived, which means it is also disposable: hitting
 * recompute throws the whole block away and builds it again from the warehouse.
 * That is the point. The artefact this replaces is a Google Doc where a figure,
 * once typed, is true forever, and the single most expensive error in a weekly
 * executive report is a number that was right the week it was written.
 *
 * No SQL is written here. Every figure comes out of lib/metrics, which is the
 * only module in the app allowed to turn a question into a query, so the
 * follower count in this report and the follower count on the cross-channel
 * screen are the same arithmetic and cannot drift apart.
 */
import 'server-only';
import type { AnalyticsQuery, MetricRow } from '@/lib/types';
import {
  changePct,
  getFactSheet,
  getLandscapeCompanyIdsBySlug,
  getLeaderboard,
  getPosts,
  getSummary,
} from '@/lib/metrics/queries';
import { endOfZoneDay, parseLocalDay, startOfZoneDay } from '@/lib/dates';
import type { PostDto } from '@/lib/metrics/contract';
import {
  REPORT_PLATFORMS,
  type BrandRow,
  type CohortRow,
  type ComputedBlock,
  type Direction,
  type Movement,
  type ReportPlatform,
  type TopPost,
} from './types';
import {
  ownedMetricRows,
  sumComparablePrevious,
  sumMeasuredValues,
} from './portfolio';

/**
 * Parse a yyyy-mm-dd day into local time explicitly.
 *
 * `new Date('2026-07-20')` is UTC midnight, which in US Eastern is the evening
 * of the 19th. A weekly report whose window silently starts a day early is a
 * subtle, permanent, invisible error, so the parts are split by hand.
 */
function localDay(iso: string): Date {
  const parsed = parseLocalDay(iso);
  if (!parsed) throw new Error('Report periods must be yyyy-mm-dd days. Got: ' + iso);
  return parsed;
}

/** Anything inside half a percent is reported as flat, not as a trend. */
const FLAT_BAND = 0.005;

function directionOf(changePct: number | null): Direction {
  if (changePct === null || !Number.isFinite(changePct)) return 'unknown';
  if (Math.abs(changePct) < FLAT_BAND) return 'flat';
  return changePct > 0 ? 'up' : 'down';
}

/**
 * A change against a zero baseline is null rather than infinite. "It grew from
 * nothing" is a sentence, not a percentage.
 */
function changePctOf(value: number | null, previousValue: number | null): number | null {
  // Delegates rather than reimplementing. The two used to differ on the sign
  // convention for a negative baseline, and both appeared in one report.
  if (value === null || previousValue === null || !Number.isFinite(previousValue)) return null;
  return changePct(value, previousValue);
}

function movement(value: number | null, previousValue: number | null): Movement {
  const changePct = changePctOf(value, previousValue);
  return { value, previousValue, changePct, direction: directionOf(changePct) };
}

function sumValues(rows: MetricRow[]): number {
  return rows.reduce(
    (acc, r) => acc + (r.available && Number.isFinite(r.value) ? r.value : 0),
    0,
  );
}

/** A total that is valid only when every included company was measured. */
function sumCompleteValues(rows: MetricRow[]): number | null {
  if (rows.length === 0 || rows.some((row) => !row.available)) return null;
  return sumValues(rows);
}

/**
 * Sum of previous values, or null when not one row carried a baseline. Summing
 * a column of nulls into zero would turn "we could not measure last week" into
 * "last week was zero", which reads as a catastrophic decline.
 */
function sumCompletePrevious(rows: MetricRow[]): number | null {
  if (
    rows.length === 0
    || rows.some((row) =>
      !row.previousAvailable
      || row.previousValue === null
      || row.previousValue === undefined)
  ) return null;
  return rows.reduce((total, row) => total + (row.previousValue ?? 0), 0);
}

function perPost(engagement: number | null, posts: number | null): number | null {
  if (engagement === null || posts === null) return null;
  // A brand that published nothing has no engagement-per-post. Returning 0 put
  // "Engagement / post: 0.0" on a KPI card beside n/a for every other figure.
  if (!posts) return null;
  const v = engagement / posts;
  return Number.isFinite(v) ? v : null;
}

const REPORT_PLATFORM_SET = new Set<string>(REPORT_PLATFORMS);

function platformSplit(row: MetricRow): Partial<Record<ReportPlatform, number>> {
  const out: Partial<Record<ReportPlatform, number>> = {};
  for (const [platform, value] of Object.entries(row.breakdown ?? {})) {
    if (!REPORT_PLATFORM_SET.has(platform)) continue;
    if (row.breakdownAvailability?.[platform as ReportPlatform] === false) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value === 0) continue;
    out[platform as ReportPlatform] = value;
  }
  return out;
}

function toTopPost(post: PostDto, index: number, bgmCompanyIds: ReadonlySet<string>): TopPost {
  return {
    id: post.id,
    rank: index + 1,
    companyName: post.company.name,
    platform: post.platform,
    type: post.type,
    postedAt: post.postedAt,
    text: post.text,
    permalink: post.permalink,
    thumbnailUrl: post.thumbnailUrl,
    engagementTotal: post.engagementTotal,
    isBgmOwned: bgmCompanyIds.has(post.company.id),
  };
}

/**
 * Build the computed block for one landscape and one Monday-to-Sunday window.
 *
 * The brand table is deliberately restricted to the platforms the printed
 * artefact carries, while engagement and the cohort are not: a follower total
 * that quietly included a platform the table does not show would not add up on
 * screen, whereas engagement is reported as a single figure and should count
 * every channel the newsroom actually publishes on.
 */
export async function computeWeeklyReport(
  orgId: string,
  landscapeId: string,
  periodStart: string,
  periodEnd: string,
): Promise<ComputedBlock> {
  // Report-zone boundaries, not the server's. The schedule computes an Eastern
  // Monday-to-Sunday; re-parsing it in server time shifted the whole window
  // four hours, so a "week" ran Sunday 20:00 to Sunday 19:59.
  const start = startOfZoneDay(localDay(periodStart));
  const end = endOfZoneDay(localDay(periodEnd));
  if (start > end) {
    throw new Error('The report period ends before it starts.');
  }

  const base: AnalyticsQuery & { orgId: string } = {
    orgId, landscapeId, start, end, compare: true,
  };
  const brandScope = { ...base, platforms: [...REPORT_PLATFORMS] };

  const [facts, summary, followerBoard, netFollowerBoard, viewsBoard, topPosts, bgmCompanyIds] = await Promise.all([
    getFactSheet(base),
    getSummary(base),
    getLeaderboard({ ...brandScope, metric: 'audience' }),
    getLeaderboard({ ...brandScope, metric: 'audienceNetChange' }),
    getLeaderboard({ ...brandScope, metric: 'views' }),
    getPosts({ ...base, sort: 'engagementTotal', direction: 'desc', page: 1, pageSize: 5 }),
    getLandscapeCompanyIdsBySlug(orgId, 'bgm'),
  ]);
  const bgmCompanyIdSet = new Set(bgmCompanyIds);
  const bgmTopPosts = bgmCompanyIds.length > 0
    ? await getPosts({
      ...base,
      companyIds: bgmCompanyIds,
      sort: 'engagementTotal',
      direction: 'desc',
      page: 1,
      pageSize: 5,
    })
    : { items: [], total: 0, page: 1, pageSize: 5 };

  const engagementBoard = facts.leaderboards.engagementTotal ?? [];
  const postsBoard = facts.leaderboards.posts ?? [];
  const engagementRateBoard = facts.leaderboards.engagementRateByFollower ?? [];
  const netById = new Map(netFollowerBoard.map((r) => [r.company.id, r]));
  const viewsById = new Map(viewsBoard.map((r) => [r.company.id, r]));
  const engagementById = new Map(engagementBoard.map((r) => [r.company.id, r]));
  const postsById = new Map(postsBoard.map((r) => [r.company.id, r]));
  const engagementRateById = new Map(engagementRateBoard.map((r) => [r.company.id, r]));

  const brands: BrandRow[] = followerBoard.map((row) => {
    const net = netById.get(row.company.id);
    const engagement = engagementById.get(row.company.id);
    const posts = postsById.get(row.company.id);
    const engagementRate = engagementRateById.get(row.company.id);
    const views = viewsById.get(row.company.id);
    const engagementByPlatform = engagement?.available ? platformSplit(engagement) : {};
    const viewsByPlatform = views?.available ? platformSplit(views) : {};
    const hasReportedViews = Object.keys(viewsByPlatform).length > 0;
    const topEngagementPlatform = Object.entries(engagementByPlatform)
      .sort(([, a], [, b]) => b - a)[0]?.[0] as ReportPlatform | undefined;
    return {
      companyId: row.company.id,
      name: row.company.name,
      isBgmOwned: bgmCompanyIdSet.has(row.company.id),
      rank: row.available ? row.rank : null,
      totalFollowers: row.available ? row.value : null,
      previousTotalFollowers: row.previousAvailable ? row.previousValue ?? null : null,
      netChange: net?.available ? net.value : null,
      netChangeFromRoundedSource: net?.changeFromRoundedSource === true
        || row.changeFromRoundedSource === true,
      changePct: row.changePct ?? null,
      byPlatform: platformSplit(row),
      netChangeByPlatform: net ? platformSplit(net) : {},
      posts: posts?.available ? posts.value : null,
      postsChangePct: posts?.complete === false || posts?.previousComplete === false
        ? null
        : posts?.changePct ?? null,
      engagementTotal: engagement?.available ? engagement.value : null,
      engagementByPlatform,
      viewsTotal: hasReportedViews ? views?.value ?? null : null,
      viewsByPlatform,
      engagementChangePct: engagement?.complete === false || engagement?.previousComplete === false
        ? null
        : engagement?.changePct ?? null,
      engagementRateByFollower: engagementRate?.available ? engagementRate.value : null,
      engagementRateChangePct:
        engagementRate?.complete === false || engagementRate?.previousComplete === false
          ? null
          : engagementRate?.changePct ?? null,
      topEngagementPlatform: topEngagementPlatform ?? null,
    };
  });

  /* ------------------------------------------------------------- portfolio */

  // The competitive-landscape total remains distinct from the BGM portfolio.
  // It powers the market cohort section and must never be relabelled as owned
  // performance merely because both figures are totals.
  const landscapeEngagement = movement(
    sumCompleteValues(engagementBoard),
    sumCompletePrevious(engagementBoard),
  );

  const bgmFollowerBoard = ownedMetricRows(followerBoard, bgmCompanyIdSet);
  const bgmNetFollowerBoard = ownedMetricRows(netFollowerBoard, bgmCompanyIdSet);
  const bgmEngagementBoard = ownedMetricRows(engagementBoard, bgmCompanyIdSet);
  const bgmPostsBoard = ownedMetricRows(postsBoard, bgmCompanyIdSet);

  const portfolioEngagement = movement(
    sumMeasuredValues(bgmEngagementBoard),
    sumComparablePrevious(bgmEngagementBoard),
  );
  const portfolioPosts = movement(
    sumMeasuredValues(bgmPostsBoard),
    sumComparablePrevious(bgmPostsBoard),
  );
  const portfolioPerPost = movement(
    perPost(portfolioEngagement.value, portfolioPosts.value),
    portfolioEngagement.previousValue === null || portfolioPosts.previousValue === null
      ? null
      : perPost(portfolioEngagement.previousValue, portfolioPosts.previousValue),
  );

  /* ----------------------------------------------------------------- focus */

  const focusCompany = summary.focus;
  const focusNet = focusCompany ? netById.get(focusCompany.id) : undefined;
  const headline = summary.headline;
  /**
   * Followers for the focus brand are read off the same platform-restricted
   * board as the brand table rather than from the unfiltered summary. If the
   * headline said one number and the table under it said another, the report
   * would be arguing with itself on its own first page.
   */
  const focusFollowers = focusCompany
    ? followerBoard.find((r) => r.company.id === focusCompany.id)
    : undefined;
  const focusEngagement = movement(
    headline.engagementTotal.available ? headline.engagementTotal.value : null,
    headline.engagementTotal.previousAvailable ? headline.engagementTotal.previousValue : null,
  );
  const focusPosts = movement(
    headline.posts.available ? headline.posts.value : null,
    headline.posts.previousAvailable ? headline.posts.previousValue : null,
  );

  const focus: ComputedBlock['focus'] = {
    companyName: focusCompany?.name ?? null,
    followers: movement(
      focusFollowers?.available ? focusFollowers.value : null,
      focusFollowers?.previousAvailable ? focusFollowers.previousValue ?? null : null,
    ),
    netFollowers: focusNet?.available ? focusNet.value : null,
    previousNetFollowers: focusNet?.previousAvailable
      ? focusNet.previousValue ?? null
      : null,
    engagementTotal: focusEngagement,
    posts: focusPosts,
    engagementPerPost: movement(
      perPost(focusEngagement.value, focusPosts.value),
      focusEngagement.previousValue === null || focusPosts.previousValue === null
        ? null
        : perPost(focusEngagement.previousValue, focusPosts.previousValue),
    ),
  };

  /* ---------------------------------------------------------------- cohort */

  /*
   * Unmeasured companies do not appear in the cohort table.
   *
   * A leaderboard row carries `available: false` when its window was not fully
   * collected. This mapped every row regardless, and an unavailable row has
   * `rank === 0` (queries.ts sets `rank = available ? ++rank : 0`) and a `value`
   * that is whatever partial sum the incomplete ingest happened to reach.
   *
   * The result reached the printed deck: a company ranked literally "0" beside
   * a real-looking engagement total that understated it by however much was
   * missing. Worse, the same slide showed "Cohort engagement: n/a" from
   * sumCompleteValues, which correctly refuses to total a set with gaps. The
   * document argued with itself, and the plausible number was the wrong one.
   *
   * The leaderboard UI already filters on `available`; this path is the leak.
   */
  const measuredBoard = engagementBoard.filter((row) => row.available !== false);
  const unmeasuredCohort = engagementBoard.length - measuredBoard.length;

  const cohortRows: CohortRow[] = measuredBoard.map((row) => ({
    companyId: row.company.id,
    name: row.company.name,
    rank: row.rank,
    engagementTotal: row.value,
    changePct: row.changePct ?? null,
    isFocus: focusCompany ? row.company.id === focusCompany.id : false,
    isBgmOwned: bgmCompanyIdSet.has(row.company.id),
  }));

  const focusPostIndex = focusCompany
    ? facts.topPostsOverall.findIndex((p) => p.company.id === focusCompany.id)
    : -1;

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    landscape: { id: facts.landscape.id, name: facts.landscape.name },
    period: { start: periodStart, end: periodEnd },
    previousPeriod: { start: facts.previousRange.start, end: facts.previousRange.end },
    focus,
    portfolio: {
      scope: 'bgm_owned',
      followers: movement(
        sumMeasuredValues(bgmFollowerBoard),
        sumComparablePrevious(bgmFollowerBoard),
      ),
      netFollowers: sumMeasuredValues(bgmNetFollowerBoard),
      previousNetFollowers: sumComparablePrevious(bgmNetFollowerBoard),
      engagementTotal: portfolioEngagement,
      posts: portfolioPosts,
      engagementPerPost: portfolioPerPost,
    },
    brands,
    topPosts: topPosts.items.map((post, index) => toTopPost(post, index, bgmCompanyIdSet)),
    bgmTopPosts: bgmTopPosts.items.map((post, index) => toTopPost(post, index, bgmCompanyIdSet)),
    cohort: {
      landscapeName: facts.landscape.name,
      focusCompanyName: focusCompany?.name ?? null,
      focusRank: cohortRows.find((r) => r.isFocus)?.rank ?? null,
      memberCount: cohortRows.length,
      engagement: landscapeEngagement,
      rows: cohortRows,
      focusPostRank: focusPostIndex >= 0 ? focusPostIndex + 1 : null,
      focusPostPool: facts.topPostsOverall.length,
    },
    // A company dropped from the cohort table is disclosed, never just absent.
    // Silently shortening a ranking is the same failure as publishing a wrong
    // rank, one step further from being noticed.
    caveats: unmeasuredCohort > 0
      ? [
        `${unmeasuredCohort} compan${unmeasuredCohort === 1 ? 'y is' : 'ies are'} missing from `
        + 'the cohort table: their window was not fully collected, so they carry no measured '
        + 'rank. Ranks shown are among the companies that were measured.',
        ...facts.caveats,
      ]
      : facts.caveats,
  };
}
