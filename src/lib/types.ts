/** Shared domain vocabulary. Import from here, never redeclare. */

export const PLATFORMS = [
  'facebook', 'instagram', 'twitter', 'youtube', 'tiktok',
  'linkedin', 'bluesky', 'threads', 'reddit', 'rss',
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
  bluesky: 'Bluesky', threads: 'Threads', reddit: 'Reddit', rss: 'RSS',
};

/** Brand colors, used consistently across every chart and badge. */
export const PLATFORM_COLORS: Record<Platform, string> = {
  facebook: '#1877F2', instagram: '#E1306C', twitter: '#0F1419',
  youtube: '#FF0000', tiktok: '#00F2EA', linkedin: '#0A66C2',
  bluesky: '#0085FF', threads: '#000000', reddit: '#FF4500', rss: '#F26522',
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
  previousValue?: number | null;
  /** Fractional change, e.g. 0.27 for +27%. Null when the prior period is zero. */
  changePct?: number | null;
  rank: number;
  /** Optional per-platform split for cross-channel views. */
  breakdown?: Partial<Record<Platform, number>>;
}

export interface TimeSeriesPoint { date: string; [seriesKey: string]: string | number }

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
  granularity?: Granularity;
  /** When true, also compute the immediately preceding window for deltas. */
  compare?: boolean;
}
