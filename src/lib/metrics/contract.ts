/**
 * The read contract. Everything that renders a number in Data Dumpster gets it from
 * one of these functions, implemented in `./queries.ts`.
 *
 * Server Components import these directly (no HTTP hop). API routes in
 * src/app/api/* are thin wrappers over the same functions for client-side
 * interactivity and for external consumers.
 */
import type {
  AnalyticsQuery, MetricKey, MetricRow, TimeSeriesPoint, Paged,
  Platform, PostType, CompanyRef,
} from '@/lib/types';

export interface HeadlineStat {
  key: MetricKey;
  value: number;
  /** False when the source observations needed by this metric are absent. */
  available: boolean;
  previousValue: number | null;
  previousAvailable: boolean;
  changePct: number | null;
  /** Sparkline for the current window. */
  spark: { date: string; value: number | null }[];
}

export interface SummaryResult {
  focus: CompanyRef | null;
  range: { start: string; end: string };
  previousRange: { start: string; end: string };
  headline: {
    audience: HeadlineStat;
    posts: HeadlineStat;
    engagementTotal: HeadlineStat;
    engagementRateByFollower: HeadlineStat;
  };
  /** Platform with the highest engagementTotal for the focus company. */
  topPlatform: Platform | null;
  /** Per-platform split for the focus company vs the landscape average. */
  platformMix: {
    platform: Platform;
    focusValue: number;
    competitorAverage: number | null;
    metric: MetricKey;
  }[];
  /** Best post per platform for the focus company. */
  topPosts: PostDto[];
  /** Landscape-wide totals, used for share-of-voice math. */
  landscapeTotals: { posts: number; engagementTotal: number; audience: number };
}

export interface PostDto {
  id: string;
  company: CompanyRef;
  platform: Platform;
  type: PostType;
  postedAt: string;
  text: string | null;
  permalink: string | null;
  thumbnailUrl: string | null;
  applause: number;
  conversation: number;
  amplification: number;
  saves: number;
  views: number;
  engagementTotal: number;
  engagementRateByFollower: number;
  followersAtPost: number | null;
  tags: { id: string; name: string; color: string | null }[];
  urls: { url: string; domain: string }[];
  /** The source channel's in-window median used to compute `outlierScore`. */
  medianEngagement: number | null;
  /** engagementTotal ÷ this source channel's in-window median. 1.0 = typical. */
  outlierScore: number | null;
}

export interface PostDetailDto extends Omit<PostDto, 'tags' | 'urls'> {
  channel: {
    id: string;
    handle: string;
    profileUrl: string | null;
    avatarUrl: string | null;
  };
  /**
   * Stored for provenance, not assumed to be directly playable. Depending on
   * the adapter this may be an image CDN URL, a signed video URL, a watch page,
   * or an article URL. The dependable preview remains `thumbnailUrl`.
   */
  mediaUrl: string | null;
  durationSec: number | null;
  language: string | null;
  hashtags: string[];
  mentions: string[];
  engagementRateByView: number | null;
  firstSeenAt: string;
  lastRefreshedAt: string;
  tags: {
    id: string;
    name: string;
    color: string | null;
    source: 'manual' | 'rule' | 'ai';
    confidence: number | null;
  }[];
  urls: {
    url: string;
    canonicalUrl: string | null;
    domain: string;
    title: string | null;
  }[];
  metricHistory: {
    capturedAt: string;
    applause: number;
    conversation: number;
    amplification: number;
    saves: number;
    views: number;
    engagementTotal: number;
    engagementRateByFollower: number | null;
    engagementRateByView: number | null;
  }[];
}

export interface UrlRow {
  key: string;
  domain: string;
  sampleUrl: string;
  title: string | null;
  postCount: number;
  engagementTotal: number;
  engagementPerPost: number;
  companies: { company: CompanyRef; postCount: number }[];
}

export interface TagRow {
  tag: { id: string; name: string; color: string | null };
  postCount: number;
  engagementTotal: number;
  engagementPerPost: number;
  engagementRateByFollower: number;
  shareOfPosts: number;
  /** Lift versus each company's untagged average rate. 1.2 = 20% better than baseline. */
  lift: number | null;
}

export interface TimeSeriesResult {
  series: TimeSeriesPoint[];
  companies: CompanyRef[];
  granularity: 'day' | 'week' | 'month';
}

export interface PostTypeRow {
  type: PostType;
  postCount: number;
  engagementTotal: number;
  engagementPerPost: number;
  engagementRateByFollower: number;
}

export interface PostingCadenceCell { weekday: number; hour: number; postCount: number; engagementPerPost: number }

/**
 * A pre-computed, fully verified set of numbers handed to the model when
 * generating a brief. The model is never allowed to query; it may only narrate
 * what is in here. This is what makes AI output auditable.
 */
export interface FactSheet {
  landscape: { id: string; name: string; focusCompany: string | null };
  range: { start: string; end: string; days: number };
  previousRange: { start: string; end: string };
  companies: CompanyRef[];
  leaderboards: Partial<Record<MetricKey, MetricRow[]>>;
  focusSummary: SummaryResult | null;
  topPostsOverall: PostDto[];
  tagPerformance: TagRow[];
  postTypePerformance: PostTypeRow[];
  notableUrls: UrlRow[];
  /** Machine-detected movements worth mentioning, each already sanity-checked. */
  anomalies: {
    kind: string;
    company: string;
    platform: Platform | null;
    metric: MetricKey;
    statement: string;
    value: number;
    baseline: number;
    zScore: number | null;
  }[];
  /** Caveats the model MUST surface, e.g. tiny baselines, partial data. */
  caveats: string[];
}

export type SortKey =
  | 'engagementTotal' | 'engagementRateByFollower' | 'postedAt'
  | 'applause' | 'conversation' | 'amplification' | 'views';

export interface PostsQuery extends AnalyticsQuery {
  search?: string;
  sort?: SortKey;
  direction?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

/* -------------------------------------------------- function signatures */

export interface MetricsApi {
  getSummary(q: AnalyticsQuery): Promise<SummaryResult>;
  getLeaderboard(q: AnalyticsQuery & { metric: MetricKey }): Promise<MetricRow[]>;
  getTimeSeries(q: AnalyticsQuery & { metric: MetricKey }): Promise<TimeSeriesResult>;
  getPosts(q: PostsQuery): Promise<Paged<PostDto>>;
  getPostedUrls(q: AnalyticsQuery & { groupBy?: 'domain' | 'url' }): Promise<UrlRow[]>;
  getTagPerformance(q: AnalyticsQuery): Promise<TagRow[]>;
  getPostTypePerformance(q: AnalyticsQuery): Promise<PostTypeRow[]>;
  getPostingCadence(q: AnalyticsQuery): Promise<PostingCadenceCell[]>;
  getFactSheet(q: AnalyticsQuery): Promise<FactSheet>;
}
