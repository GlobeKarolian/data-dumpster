/** Shared domain vocabulary. Import from here, never redeclare. */

export const PLATFORMS = [
  'facebook', 'instagram', 'twitter', 'youtube', 'tiktok',
  'linkedin', 'bluesky', 'threads', 'reddit', 'truth_social', 'rss',
] as const;
export type Platform = (typeof PLATFORMS)[number];

export const POST_TYPES = [
  'photo', 'video', 'carousel', 'reel', 'short', 'story',
  'text', 'link', 'live', 'poll', 'repost', 'article', 'other',
] as const;
export type PostType = (typeof POST_TYPES)[number];

export const PLATFORM_LABELS: Record<Platform, string> = {
  facebook: 'Facebook', instagram: 'Instagram', twitter: 'X / Twitter',
  youtube: 'YouTube', tiktok: 'TikTok', linkedin: 'LinkedIn',
  bluesky: 'Bluesky', threads: 'Threads', reddit: 'Reddit',
  truth_social: 'Truth Social', rss: 'RSS',
};

/** Brand colors, used consistently across every chart and badge. */
export const PLATFORM_COLORS: Record<Platform, string> = {
  facebook: '#1877F2', instagram: '#E1306C', twitter: '#0F1419',
  youtube: '#FF0000', tiktok: '#00F2EA', linkedin: '#0A66C2',
  bluesky: '#0085FF', threads: '#000000', reddit: '#FF4500',
  truth_social: '#5448EE', rss: '#F26522',
};

/**
 * The metric vocabulary. Definitions live in lib/metrics/definitions.ts and are
 * surfaced in the UI on hover, because a competitive tool that will not tell you
 * how it computed a number is a tool nobody trusts twice.
 */
export const METRIC_KEYS = [
  'audience', 'audienceNetChange', 'audienceGrowthRate',
  'posts', 'postsPerDay', 'postsPerWeek',
  'engagementTotal', 'engagementPerPost', 'engagementRateByFollower',
  'engagementRateByView', 'applause', 'conversation', 'amplification',
  'saves', 'views', 'viewsPerPost', 'shareOfVoice', 'shareOfEngagement',
] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

export interface DateRange { start: Date; end: Date }

export interface CompanyRef {
  id: string; name: string; slug: string;
  logoUrl?: string | null; color?: string | null; segment?: string | null;
}

/** One row in any leaderboard: a company, its value, and how it moved. */
export interface MetricRow {
  company: CompanyRef;
  value: number;
  /**
   * False when the source observations needed to compute this metric do not
   * exist. Consumers must render a blank rather than treating `value` as zero.
   */
  available: boolean;
  /**
   * False when a real value was computed from useful observations but one or
   * more configured profiles could not certify the entire requested window.
   * Partial is not unavailable, and it is never safe to use for a WoW delta.
   */
  complete?: boolean;
  previousValue?: number | null;
  /** Whether `previousValue` was measured rather than supplied as a fallback. */
  previousAvailable?: boolean;
  /** Whether the previous value covers every configured profile and day. */
  previousComplete?: boolean;
  /** Fractional change, e.g. 0.27 for +27%. Null when the prior period is zero. */
  changePct?: number | null;
  /**
   * True when at least one channel's endpoints came from a source that had
   * already rounded them, so the movement may be a rounding-bucket flip rather
   * than real change. Facebook page counts do this above ~500k: a page reads
   * 1,300,000 for a week and 1,400,000 the next, booking a phantom +100,000.
   * The value stays visible and the UI marks it; see metrics/source-rounding.
   */
  changeFromRoundedSource?: boolean;
  rank: number;
  /** Optional per-platform split for cross-channel views. */
  breakdown?: Partial<Record<Platform, number>>;
  /** Presence metadata for each entry in `breakdown`. */
  breakdownAvailability?: Partial<Record<Platform, boolean>>;
}

export interface TimeSeriesPoint {
  date: string;
  /** Null is an honest gap: the metric could not be computed for that bucket. */
  [seriesKey: string]: string | number | null;
}

export interface Paged<T> { items: T[]; total: number; page: number; pageSize: number }

export type Granularity = 'day' | 'week' | 'month';

/** Query shape shared by every analytics endpoint. */
export interface AnalyticsQuery {
  landscapeId: string;
  start: Date;
  end: Date;
  platforms?: Platform[];
  companyIds?: string[];
  tagIds?: string[];
  postTypes?: PostType[];
  /** Post content, permalink, linked URL, domain, or linked-page title. */
  search?: string;
  granularity?: Granularity;
  /** When true, also compute the immediately preceding window for deltas. */
  compare?: boolean;
}
