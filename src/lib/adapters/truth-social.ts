/**
 * Truth Social — public profile and post data through Apify's maintained
 * `tri_angle/truth-scraper` actor.
 *
 * The actor exposes public follower stock plus favourites, replies and reblogs.
 * It does not expose views or saves. Paid actor calls are deliberately not
 * retried inside one adapter request: retrying a timed-out run can purchase the
 * same collection twice. The durable scheduler may retry later with an audit
 * row, which is the correct place to make that decision.
 */
import type { Platform } from '@/lib/types';
import {
  AdapterError,
  type AdapterProfile,
  type ChannelAdapter,
  type FetchContext,
  type FetchResult,
  type NormalizedAudience,
  type NormalizedPost,
} from './types';
import { asArray, asCount, asDate, asRecord, asString, fetchJson } from './util/request';
import {
  classifyPostType,
  extractHashtags,
  extractMentions,
  extractUrls,
  toDayString,
} from './util/normalize';

const PLATFORM: Platform = 'truth_social';
const ACTOR_RUN_URL = 'https://api.apify.com/v2/acts/tri_angle~truth-scraper/run-sync-get-dataset-items';
const MAX_RESULTS = 500;

function requireToken(credentials: Record<string, string>): string {
  const token = credentials.apifyApiToken?.trim();
  if (!token) {
    throw new AdapterError(
      'Truth Social collection requires the deployment APIFY_API_TOKEN for the approved Apify actor.',
      { platform: PLATFORM, retryable: false },
    );
  }
  return token;
}

async function runActor(
  token: string,
  body: Record<string, unknown>,
  ctx?: Pick<FetchContext, 'onApiCall' | 'signal'>,
): Promise<unknown[]> {
  return fetchJson<unknown[]>(ACTOR_RUN_URL, {
    platform: PLATFORM,
    method: 'POST',
    headers: { authorization: 'Bearer ' + token },
    body,
    timeoutMs: 120_000,
    retries: 0,
    onApiCall: ctx?.onApiCall,
    signal: ctx?.signal,
    extractMessage: (parsed) => {
      const root = asRecord(parsed);
      const error = asRecord(root?.error);
      return asString(error?.message) ?? asString(root?.message);
    },
  });
}

export function parseTruthSocialHandle(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('Enter a Truth Social username or profile URL.');

  try {
    const url = new URL(trimmed.startsWith('http') ? trimmed : 'https://' + trimmed);
    if (url.hostname.toLowerCase() === 'truthsocial.com' || url.hostname.toLowerCase().endsWith('.truthsocial.com')) {
      const match = url.pathname.match(/^\/@([^/?#]+)/);
      if (match?.[1]) return decodeURIComponent(match[1]).replace(/^@/, '');
    }
  } catch {
    // A plain handle is handled below.
  }

  const handle = trimmed.replace(/^@/, '').replace(/\/$/, '');
  if (!/^[A-Za-z0-9_]{1,80}$/.test(handle)) {
    throw new Error('Truth Social usernames may contain letters, numbers, and underscores.');
  }
  return handle;
}

function mapProfile(raw: unknown, fallbackHandle: string): AdapterProfile {
  const row = asRecord(raw);
  const externalId = asString(row?.id);
  const handle = asString(row?.username) ?? fallbackHandle;
  if (!row || !externalId) {
    throw new AdapterError(
      'Apify returned no public Truth Social profile for @' + fallbackHandle + '.',
      { platform: PLATFORM, retryable: false },
    );
  }
  return {
    externalId,
    handle,
    displayName: asString(row.displayName) ?? handle,
    avatarUrl: asString(row.avatar),
    profileUrl: asString(row.url) ?? 'https://truthsocial.com/@' + handle,
    followers: asCount(row.followersCount),
    meta: {
      source: 'apify-truth-social',
      verified: row.verified === true,
      following: asCount(row.followingCount),
      postsAndReplies: asCount(row.postsAndRepliesCount),
    },
  };
}

function mediaAttachment(raw: unknown): Record<string, unknown> | undefined {
  return asArray(raw).map(asRecord).find((value): value is Record<string, unknown> => value !== undefined);
}

export function mapTruthSocialPost(raw: unknown): NormalizedPost | undefined {
  const row = asRecord(raw);
  const externalId = asString(row?.id);
  const postedAt = asDate(row?.createdAt);
  if (!row || !externalId || !postedAt) return undefined;

  const text = asString(row.content) ?? '';
  const media = mediaAttachment(row.mediaAttachments);
  const mediaType = asString(media?.type)?.toLowerCase();
  const isReblog = asRecord(row.reblog) !== undefined || asString(row.type) === 'reblog';
  return {
    externalId,
    postedAt,
    type: classifyPostType({
      platform: PLATFORM,
      hasVideo: mediaType === 'video' || mediaType === 'gifv',
      hasImage: mediaType === 'image',
      mediaCount: asArray(row.mediaAttachments).length,
      isRepost: isReblog,
    }),
    text,
    permalink: asString(row.url),
    mediaUrl: asString(media?.url),
    thumbnailUrl: asString(media?.previewUrl) ?? asString(media?.url),
    language: asString(row.language),
    hashtags: extractHashtags(text),
    mentions: extractMentions(text),
    urls: extractUrls(text),
    applause: asCount(row.favouritesCount),
    conversation: asCount(row.repliesCount),
    amplification: asCount(row.reblogsCount),
    saves: 0,
    views: 0,
    raw: {
      pinned: row.pinned === true,
      sensitive: row.sensitive === true,
      visibility: asString(row.visibility),
    },
  };
}

async function resolveProfile(
  handle: string,
  credentials: Record<string, string>,
  ctx?: Pick<FetchContext, 'onApiCall' | 'signal'>,
): Promise<AdapterProfile> {
  const token = requireToken(credentials);
  const rows = await runActor(token, {
    profiles: [handle],
    resultsType: 'profile-details',
    maxPostsAndReplies: 0,
    cleanContent: true,
  }, ctx);
  return mapProfile(rows[0], handle);
}

export const truthSocialAdapter: ChannelAdapter = {
  platform: PLATFORM,
  displayName: 'Truth Social',
  accessNotes: 'Public profiles, posts, follower counts, favourites, replies, reblogs, and media are collected through the deployment\'s approved Apify actor. Truth Social does not expose public view or save counts through this source.',
  credentialFields: [],
  rateLimit: { callsPerWindow: 60, windowSeconds: 60 },
  worksUnauthenticated: false,
  parseHandle: parseTruthSocialHandle,
  async resolveProfile(handle, credentials) {
    return resolveProfile(parseTruthSocialHandle(handle), credentials);
  },
  async fetch(ctx: FetchContext): Promise<FetchResult> {
    const handle = parseTruthSocialHandle(ctx.handle);
    const token = requireToken(ctx.credentials);
    const requestedLimit = Math.max(1, Math.min(ctx.limit, MAX_RESULTS));
    const [profile, rawPosts] = await Promise.all([
      resolveProfile(handle, ctx.credentials, ctx),
      runActor(token, {
        profiles: [handle],
        resultsType: 'posts',
        maxPostsAndReplies: requestedLimit,
        postsNewerThan: ctx.since.toISOString(),
        cleanContent: true,
        includeMuted: false,
      }, ctx),
    ]);

    const posts = rawPosts
      .map(mapTruthSocialPost)
      .filter((post): post is NormalizedPost => post !== undefined)
      .filter((post) => post.postedAt >= ctx.since && post.postedAt <= ctx.until)
      .sort((a, b) => b.postedAt.getTime() - a.postedAt.getTime());
    const audience: NormalizedAudience[] = profile.followers === undefined ? [] : [{
      day: toDayString(ctx.until),
      followers: profile.followers,
      following: typeof profile.meta?.following === 'number' ? profile.meta.following : null,
    }];
    const capped = rawPosts.length >= requestedLimit;

    if (capped) {
      return {
        posts,
        audience,
        profile,
        hasMore: false,
        exhaustive: false,
        cursor: { source: 'apify-truth-social' },
        incompleteReason: 'Apify returned the configured cap of ' + String(requestedLimit)
          + ' Truth Social posts. Increase the per-profile limit or narrow the requested window.',
      };
    }

    return {
      posts,
      audience,
      profile,
      cursor: { source: 'apify-truth-social' },
      hasMore: false,
      exhaustive: true,
    };
  },
  async healthCheck(credentials) {
    try {
      requireToken(credentials);
      return { ok: true, message: 'Apify Truth Social token is configured.' };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  },
};
