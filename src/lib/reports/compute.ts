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
import { endOfDay, startOfDay } from 'date-fns';
import type { AnalyticsQuery, MetricRow } from '@/lib/types';
import { getFactSheet, getLeaderboard, getPosts, getSummary } from '@/lib/metrics/queries';
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

/**
 * Parse a yyyy-mm-dd day into local time explicitly.
 *
 * `new Date('2026-07-20')` is UTC midnight, which in US Eastern is the evening
 * of the 19th. A weekly report whose window silently starts a day early is a
 * subtle, permanent, invisible error, so the parts are split by hand.
 */
function localDay(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) throw new Error('Report periods must be yyyy-mm-dd days. Got: ' + iso);
  return new Date(y, m - 1, d);
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
  if (
    value === null
    || previousValue === null
    || previousValue === 0
    || !Number.isFinite(previousValue)
  ) return null;
  const pct = (value - previousValue) / Math.abs(previousValue);
  return Number.isFinite(pct) ? pct : null;
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
  if (!posts) return 0;
  const v = engagement / posts;
  return Number.isFinite(v) ? v : 0;
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

function toTopPost(post: PostDto, index: number): TopPost {
  return {
    id: post.id,
    rank: index + 1,
    companyName: post.company.name,
    platform: post.platform,
    postedAt: post.postedAt,
    text: post.text,
    permalink: post.permalink,
    engagementTotal: post.engagementTotal,
  };
}

/**
 * Build the computed block for one landscape and one Monday-to-Sunday window.
 *
 * The brand table is deliberately restricted to the five platforms the printed
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
  const start = startOfDay(localDay(periodStart));
  const end = endOfDay(localDay(periodEnd));
  if (start > end) {
    throw new Error('The report period ends before it starts.');
  }

  const base: AnalyticsQuery & { orgId: string } = {
    orgId, landscapeId, start, end, compare: true,
  };
  const brandScope = { ...base, platforms: [...REPORT_PLATFORMS] };

  const [facts, summary, followerBoard, netFollowerBoard, topPosts] = await Promise.all([
    getFactSheet(base),
    getSummary(base),
    getLeaderboard({ ...brandScope, metric: 'audience' }),
    getLeaderboard({ ...brandScope, metric: 'audienceNetChange' }),
    getPosts({ ...base, sort: 'engagementTotal', direction: 'desc', page: 1, pageSize: 3 }),
  ]);

  const engagementBoard = facts.leaderboards.engagementTotal ?? [];
  const postsBoard = facts.leaderboards.posts ?? [];
  const netById = new Map(netFollowerBoard.map((r) => [r.company.id, r]));

  const brands: BrandRow[] = followerBoard.map((row) => {
    const net = netById.get(row.company.id);
    return {
      companyId: row.company.id,
      name: row.company.name,
      rank: row.available ? row.rank : null,
      totalFollowers: row.available ? row.value : null,
      previousTotalFollowers: row.previousAvailable ? row.previousValue ?? null : null,
      netChange: net?.available ? net.value : null,
      changePct: row.changePct ?? null,
      byPlatform: platformSplit(row),
    };
  });

  /* ------------------------------------------------------------- portfolio */

  const portfolioEngagement = movement(
    sumCompleteValues(engagementBoard),
    sumCompletePrevious(engagementBoard),
  );
  const portfolioPosts = movement(
    sumCompleteValues(postsBoard),
    sumCompletePrevious(postsBoard),
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

  const cohortRows: CohortRow[] = engagementBoard.map((row) => ({
    companyId: row.company.id,
    name: row.company.name,
    rank: row.rank,
    engagementTotal: row.value,
    changePct: row.changePct ?? null,
    isFocus: focusCompany ? row.company.id === focusCompany.id : false,
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
      followers: movement(
        sumCompleteValues(followerBoard),
        sumCompletePrevious(followerBoard),
      ),
      netFollowers: sumCompleteValues(netFollowerBoard),
      engagementTotal: portfolioEngagement,
      posts: portfolioPosts,
      engagementPerPost: portfolioPerPost,
    },
    brands,
    topPosts: topPosts.items.map(toTopPost),
    cohort: {
      landscapeName: facts.landscape.name,
      focusCompanyName: focusCompany?.name ?? null,
      focusRank: cohortRows.find((r) => r.isFocus)?.rank ?? null,
      memberCount: cohortRows.length,
      engagement: portfolioEngagement,
      rows: cohortRows,
      focusPostRank: focusPostIndex >= 0 ? focusPostIndex + 1 : null,
      focusPostPool: facts.topPostsOverall.length,
    },
    caveats: facts.caveats,
  };
}
