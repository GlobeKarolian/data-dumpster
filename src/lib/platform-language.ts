import { METRIC_DEFS } from '@/lib/metrics/definitions';
import type { MetricKey, Platform } from '@/lib/types';

const VIDEO_PLATFORMS = new Set<Platform>(['tiktok', 'youtube']);

export type RedditEntityKind = 'user' | 'subreddit';
export type RedditEntityMix = RedditEntityKind | 'mixed';

/** Canonical `u/name` handles are users; explicit and legacy community handles are subreddits. */
export function classifyRedditHandle(handle: string): RedditEntityKind {
  return /^u\//i.test(handle) ? 'user' : 'subreddit';
}

/** Summarize the Reddit entity kinds present in a channel list. */
export function classifyRedditHandles(handles: readonly string[]): RedditEntityMix | null {
  if (handles.length === 0) return null;

  const first = classifyRedditHandle(handles[0]);
  for (const handle of handles.slice(1)) {
    if (classifyRedditHandle(handle) !== first) return 'mixed';
  }
  return first;
}

export function publicationNoun(platform: Platform, plural = true): string {
  if (VIDEO_PLATFORMS.has(platform)) return plural ? 'Videos' : 'Video';
  return plural ? 'Posts' : 'Post';
}

export function platformAudienceNoun(platform: Platform, plural = true): string {
  if (platform === 'youtube') return plural ? 'Subscribers' : 'Subscriber';
  if (platform === 'reddit') return plural ? 'Members' : 'Member';
  return plural ? 'Followers' : 'Follower';
}

export function platformHandleLabel(platform: Platform, handle: string): string {
  const normalized = handle.replace(/^@/, '');
  if (platform !== 'reddit') return '@' + normalized;

  // Legacy subreddit rows store a bare name. New Reddit user channels carry
  // their entity in the canonical handle so r/foo and u/foo cannot collide.
  return /^(?:r|u)\//i.test(normalized) ? normalized : 'r/' + normalized;
}

/**
 * Rival IQ's per-platform screens use the platform's own language. Keep the
 * arithmetic tied to the canonical metric while changing only the visible noun.
 */
export function platformMetricLabel(metric: MetricKey, platform: Platform): string {
  const publication = publicationNoun(platform);
  const singular = publicationNoun(platform, false);
  const audience = platformAudienceNoun(platform);
  const audienceSingular = platformAudienceNoun(platform, false);
  switch (metric) {
    case 'audience':
      return audience;
    case 'audienceNetChange':
      return audience + ' Net Change';
    case 'audienceGrowthRate':
      return audienceSingular + ' Growth Rate';
    case 'posts':
      return publication;
    case 'postsPerDay':
      return publication + ' per Day';
    case 'postsPerWeek':
      return publication + ' per Week';
    case 'engagementPerPost':
      return 'Engagement per ' + singular;
    case 'engagementRateByFollower':
      return platform === 'youtube'
        ? 'Engagement Rate by Subscriber'
        : platform === 'reddit'
          ? 'Engagement Rate by Member'
        : METRIC_DEFS[metric].label;
    case 'applause':
      return platform === 'reddit' ? 'Score' : METRIC_DEFS[metric].label;
    case 'conversation':
      return platform === 'reddit' ? 'Comments' : METRIC_DEFS[metric].label;
    case 'amplification':
      return platform === 'reddit' ? 'Crossposts' : METRIC_DEFS[metric].label;
    case 'viewsPerPost':
      return 'Views per ' + singular;
    default:
      return METRIC_DEFS[metric].label;
  }
}
