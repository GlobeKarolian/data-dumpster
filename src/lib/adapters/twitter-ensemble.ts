/**
 * X (Twitter) reads via EnsembleData.
 *
 * This mapping was written against live responses from:
 *   /twitter/user/info?name=BostonGlobe
 *   /twitter/user/tweets?id=95431448
 *
 * The tweets endpoint returned TimelineTimelineItem rows from Twitter's
 * profile_best_highlights component. EnsembleData also documents that its
 * order is chosen by Twitter rather than chronological. That makes this source
 * useful for public engagement and audience data, but not a complete post
 * inventory. Every result carries a warning so a missing post is never
 * interpreted as a post that did not exist.
 */
import type { Platform, PostType } from '@/lib/types';
import { ensembleGet, envelope } from '@/lib/vendors/ensembledata';
import { AdapterError } from './types';
import type { AdapterProfile, NormalizedAudience, NormalizedPost } from './types';
import { isRecord, num, str, toDate } from './vendor-posts';
import {
  classifyPostType,
  extractHashtags,
  extractMentions,
  toDayString,
} from './util/normalize';

const PLATFORM: Platform = 'twitter';

export interface TwitterEnsembleProfile {
  profile: AdapterProfile;
  audience?: NormalizedAudience;
}

export interface TwitterEnsemblePosts {
  posts: NormalizedPost[];
  warnings: string[];
}

function hasOwn(row: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(row, key);
}

function numericExtras(
  row: Record<string, unknown>,
  fields: Record<string, string>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [source, target] of Object.entries(fields)) {
    if (hasOwn(row, source)) out[target] = num(row[source]);
  }
  return out;
}

/** Parse the live /twitter/user/info envelope without performing I/O. */
export function parseTwitterProfile(
  body: unknown,
  requestedHandle: string,
): TwitterEnsembleProfile {
  const payload = envelope<unknown>(body);
  const data = isRecord(payload) ? payload : {};
  const legacy = isRecord(data.legacy) ? data.legacy : {};
  const externalId = str(data.rest_id);

  if (!externalId) {
    throw new AdapterError(
      'EnsembleData returned no X profile id for @' + requestedHandle + '.',
      { platform: PLATFORM, retryable: false },
    );
  }

  const handle = str(legacy.screen_name) ?? requestedHandle.replace(/^@/, '');
  const followers = num(legacy.followers_count);
  const avatar = str(legacy.profile_image_url_https);
  const profile: AdapterProfile = {
    externalId,
    handle,
    displayName: str(legacy.name) ?? handle,
    avatarUrl: avatar?.replace(/_normal(\.\w+)$/, '$1') ?? null,
    profileUrl: 'https://x.com/' + handle,
    followers,
    meta: {
      source: 'ensembledata',
      isBlueVerified: Boolean(data.is_blue_verified),
      isVerified: Boolean(legacy.verified),
      isProtected: Boolean(legacy.protected),
    },
  };

  const audience: NormalizedAudience | undefined = hasOwn(legacy, 'followers_count')
    ? {
      day: toDayString(new Date()),
      followers,
      following: hasOwn(legacy, 'friends_count') ? num(legacy.friends_count) : null,
      extra: numericExtras(legacy, {
        statuses_count: 'postCount',
        listed_count: 'listedCount',
        media_count: 'mediaCount',
        favourites_count: 'favoritesCount',
      }),
    }
    : undefined;

  return { profile, audience };
}

export async function fetchProfile(
  handle: string,
  token: string,
  onApiCall?: () => void,
  signal?: AbortSignal,
): Promise<TwitterEnsembleProfile> {
  const body = await ensembleGet('/twitter/user/info', {
    // The live endpoint rejects `username`; its required parameter is `name`.
    name: handle.replace(/^@/, ''),
  }, {
    token,
    platform: PLATFORM,
    onApiCall,
    signal,
  });
  return parseTwitterProfile(body, handle);
}

function tweetFromTimelineRow(row: unknown): Record<string, unknown> | undefined {
  if (!isRecord(row)) return undefined;
  const content = isRecord(row.content) ? row.content : undefined;
  const itemContent = content && isRecord(content.itemContent)
    ? content.itemContent
    : undefined;
  const tweetResults = itemContent && isRecord(itemContent.tweet_results)
    ? itemContent.tweet_results
    : undefined;
  const result = tweetResults && isRecord(tweetResults.result)
    ? tweetResults.result
    : undefined;

  if (!result) return undefined;
  // Visibility-limited rows may add one wrapper while retaining the same
  // observed Tweet + legacy shape underneath.
  return isRecord(result.tweet) ? result.tweet : result;
}

interface Media {
  type: string;
  thumbnailUrl: string | null;
  mediaUrl: string | null;
  durationSec: number | null;
}

function bestMp4(media: Record<string, unknown>): string | null {
  const videoInfo = isRecord(media.video_info) ? media.video_info : undefined;
  const variants = videoInfo && Array.isArray(videoInfo.variants)
    ? videoInfo.variants
    : [];

  let best: { bitrate: number; url: string } | undefined;
  for (const raw of variants) {
    if (!isRecord(raw) || raw.content_type !== 'video/mp4') continue;
    const url = str(raw.url);
    if (!url) continue;
    const candidate = { bitrate: num(raw.bitrate), url };
    if (!best || candidate.bitrate > best.bitrate) best = candidate;
  }
  return best?.url ?? null;
}

function readMedia(legacy: Record<string, unknown>): Media[] {
  const extended = isRecord(legacy.extended_entities)
    ? legacy.extended_entities
    : undefined;
  const rows = extended && Array.isArray(extended.media)
    ? extended.media
    : [];
  const out: Media[] = [];

  for (const raw of rows) {
    if (!isRecord(raw)) continue;
    const type = str(raw.type) ?? 'unknown';
    const thumbnailUrl = str(raw.media_url_https) ?? null;
    const videoInfo = isRecord(raw.video_info) ? raw.video_info : undefined;
    const durationMs = videoInfo ? num(videoInfo.duration_millis) : 0;
    out.push({
      type,
      thumbnailUrl,
      mediaUrl: type === 'video' || type === 'animated_gif'
        ? bestMp4(raw)
        : thumbnailUrl,
      durationSec: durationMs > 0 ? Math.round(durationMs / 1000) : null,
    });
  }
  return out;
}

function readEntities(
  legacy: Record<string, unknown>,
  text: string,
): { hashtags: string[]; mentions: string[]; urls: string[] } {
  const entities = isRecord(legacy.entities) ? legacy.entities : {};

  const hashtags = (Array.isArray(entities.hashtags) ? entities.hashtags : [])
    .map((raw) => isRecord(raw) ? str(raw.text)?.toLowerCase() : undefined)
    .filter((value): value is string => Boolean(value));

  const mentions = (Array.isArray(entities.user_mentions) ? entities.user_mentions : [])
    .map((raw) => isRecord(raw) ? str(raw.screen_name)?.toLowerCase() : undefined)
    .filter((value): value is string => Boolean(value));

  const urls = (Array.isArray(entities.urls) ? entities.urls : [])
    .map((raw) => {
      if (!isRecord(raw)) return undefined;
      return str(raw.expanded_url) ?? str(raw.unwound_url);
    })
    .filter((value): value is string => Boolean(value))
    // Attached media and quoted tweets are represented as self-links. They
    // are not posted URLs and would pollute the domain leaderboard.
    .filter((value) => !/^https?:\/\/(www\.)?(twitter|x)\.com\//i.test(value));

  return {
    hashtags: Array.from(new Set(
      hashtags.length > 0 ? hashtags : extractHashtags(text),
    )),
    mentions: Array.from(new Set(
      mentions.length > 0 ? mentions : extractMentions(text),
    )),
    urls: Array.from(new Set(urls)),
  };
}

function readTweet(
  tweet: Record<string, unknown>,
  handle: string,
): NormalizedPost | undefined {
  const legacy = isRecord(tweet.legacy) ? tweet.legacy : undefined;
  if (!legacy) return undefined;

  const externalId = str(tweet.rest_id) ?? str(legacy.id_str);
  const postedAt = toDate(legacy.created_at);
  if (!externalId || !postedAt) return undefined;

  const text = str(legacy.full_text) ?? '';
  // `retweeted` in this payload means the viewing account has retweeted the
  // post. It does not classify the post. A retweet itself is identified by the
  // nested original status or the canonical RT prefix.
  const isRepost = isRecord(legacy.retweeted_status_result)
    || /^RT\s+@/i.test(text);
  if (isRepost) return undefined;

  const media = readMedia(legacy);
  const video = media.find((item) =>
    item.type === 'video' || item.type === 'animated_gif');
  const entities = readEntities(legacy, text);
  const isQuote = legacy.is_quote_status === true;
  const type: PostType = classifyPostType({
    platform: PLATFORM,
    nativeType: isQuote ? 'quote' : null,
    hasVideo: Boolean(video),
    hasImage: media.some((item) => item.type === 'photo'),
    mediaCount: media.length,
    durationSec: video?.durationSec ?? null,
    hasLink: entities.urls.length > 0,
  });
  const views = isRecord(tweet.views) ? num(tweet.views.count) : 0;

  return {
    externalId,
    postedAt,
    type,
    text: text || null,
    permalink: 'https://x.com/' + handle + '/status/' + externalId,
    mediaUrl: video?.mediaUrl ?? media[0]?.mediaUrl ?? null,
    thumbnailUrl: video?.thumbnailUrl ?? media[0]?.thumbnailUrl ?? null,
    durationSec: video?.durationSec ?? null,
    language: str(legacy.lang) ?? null,
    hashtags: entities.hashtags,
    mentions: entities.mentions,
    urls: entities.urls,
    applause: num(legacy.favorite_count),
    conversation: num(legacy.reply_count),
    amplification: num(legacy.retweet_count) + num(legacy.quote_count),
    saves: num(legacy.bookmark_count),
    views,
    raw: tweet,
  };
}

function isHighlightsRow(row: unknown): boolean {
  if (!isRecord(row) || !isRecord(row.content)) return false;
  const info = isRecord(row.content.clientEventInfo)
    ? row.content.clientEventInfo
    : undefined;
  return str(info?.component) === 'profile_best_highlights';
}

/** Parse the live /twitter/user/tweets envelope without performing I/O. */
export function parseTwitterTweets(
  body: unknown,
  handle: string,
  opts: { since: Date; until: Date; limit: number },
): TwitterEnsemblePosts {
  const payload = envelope<unknown>(body);
  const rows = Array.isArray(payload) ? payload : [];
  const byId = new Map<string, NormalizedPost>();
  let malformed = 0;

  for (const row of rows) {
    const tweet = tweetFromTimelineRow(row);
    if (!tweet) {
      malformed++;
      continue;
    }
    const post = readTweet(tweet, handle);
    if (!post) continue;
    if (post.postedAt < opts.since || post.postedAt > opts.until) continue;
    byId.set(post.externalId, post);
  }

  const posts = Array.from(byId.values())
    .sort((a, b) => b.postedAt.getTime() - a.postedAt.getTime())
    .slice(0, Math.max(0, opts.limit));
  const warnings: string[] = [];

  if (rows.some(isHighlightsRow)) {
    warnings.push(
      'X for @' + handle + ': EnsembleData returned Twitter profile highlights, not a '
      + 'chronological timeline. Posts outside this selected set are missing rather than absent.',
    );
  } else {
    warnings.push(
      'X for @' + handle + ': EnsembleData documents this endpoint as Twitter-selected and '
      + 'non-chronological. Posts outside the returned set are missing rather than absent.',
    );
  }
  if (rows.length > 0 && posts.length === 0) {
    warnings.push(
      'X for @' + handle + ': ' + rows.length
      + ' selected posts were returned, but none fell inside the requested window.',
    );
  }
  if (malformed > 0) {
    warnings.push(
      'X for @' + handle + ': ' + malformed
      + ' timeline rows had no readable tweet payload and were skipped.',
    );
  }

  return { posts, warnings };
}

export async function fetchPosts(
  userId: string,
  handle: string,
  token: string,
  opts: {
    since: Date;
    until: Date;
    limit: number;
    onApiCall?: () => void;
    signal?: AbortSignal;
  },
): Promise<TwitterEnsemblePosts> {
  const body = await ensembleGet('/twitter/user/tweets', {
    // The live endpoint requires the numeric rest_id returned by user/info.
    id: userId,
  }, {
    token,
    platform: PLATFORM,
    onApiCall: opts.onApiCall,
    signal: opts.signal,
  });
  return parseTwitterTweets(body, handle, opts);
}
