/**
 * X (Twitter) reads via Bright Data.
 *
 * X does sell a sanctioned competitor read: the v2 API bills roughly $0.005 per
 * post read, which at this landscape's size is $110 to $150 a month. That is
 * the cleaner answer and the adapter in twitter.ts implements it. This module
 * exists so an org that has already bought vendor access does not also have to
 * buy an X subscription to see the platform at all.
 *
 * The endpoint is Posts, in discover-by-profile-url mode. Every row carries the
 * author's follower count, so audience comes free.
 *
 * X separates reposts from quote posts. Both are amplification under the metric
 * vocabulary and are summed, with the split preserved in raw. Bookmarks map to
 * saves, which makes X and TikTok the only platforms here that expose one.
 */
import { AdapterError } from './types';
import type { AdapterProfile, NormalizedAudience, NormalizedPost } from './types';
import { DATASETS, scrapeSync, rowError, isErrorRow } from '@/lib/vendors/brightdata';
import { isRecord, pick, num, str, toDate, vendorDate } from './vendor-posts';
import { extractHashtags, extractMentions, extractUrls, toDayString } from './util/normalize';
import type { Platform } from '@/lib/types';

const PLATFORM: Platform = 'twitter';

export interface TwitterVendorResult {
  posts: NormalizedPost[];
  audience?: NormalizedAudience;
  profile?: AdapterProfile;
  warnings: string[];
}

export async function fetchProfilePosts(
  handle: string,
  apiKey: string,
  opts: { since: Date; until: Date; limit: number; onApiCall?: () => void; signal?: AbortSignal },
): Promise<TwitterVendorResult> {
  const profileUrl = 'https://x.com/' + handle.replace(/^@/, '');

  const rows = await scrapeSync(
    DATASETS.twitterPosts,
    [{
      url: profileUrl,
      start_date: vendorDate(opts.since),
      end_date: vendorDate(opts.until),
    }],
    {
      apiKey,
      platform: PLATFORM,
      discoverBy: 'profile_url',
      onApiCall: opts.onApiCall,
      signal: opts.signal,
    },
  );

  const warnings: string[] = [];
  const posts: NormalizedPost[] = [];
  let followers = 0;
  let profile: AdapterProfile | undefined;

  for (const row of rows) {
    if (!isRecord(row)) continue;
    if (isErrorRow(row)) {
      const why = rowError(row);
      if (why) warnings.push('X row error for @' + handle + ': ' + why);
      continue;
    }

    const f = num(pick(row, ['followers', 'followers_count']));
    if (f > followers) followers = f;
    if (!profile) {
      profile = {
        externalId: str(pick(row, ['user_id', 'profile_id'])) ?? handle,
        handle: str(pick(row, ['user_posted'])) ?? handle,
        displayName: str(pick(row, ['name'])),
        avatarUrl: str(pick(row, ['profile_image_link'])) ?? null,
        profileUrl,
        followers: f,
        meta: { source: 'brightdata', isVerified: Boolean(row.is_verified) },
      };
    }

    const postedAt = toDate(pick(row, ['date_posted', 'timestamp']));
    const externalId = str(pick(row, ['id', 'post_id', 'tweet_id']));
    if (!postedAt || !externalId) continue;
    if (postedAt < opts.since || postedAt > opts.until) continue;

    // A repost carries the original author's engagement, not this account's
    // work. Counting it would inflate the account's totals with someone else's
    // numbers, so it is skipped rather than stored.
    if (row.is_repost === true) continue;

    const text = str(pick(row, ['description', 'text', 'content'])) ?? '';
    const rawTags = row.hashtags;
    const hashtags = Array.isArray(rawTags)
      ? rawTags.map((t) => String(t).replace(/^#/, '')).filter(Boolean)
      : extractHashtags(text);

    const hasVideo = Array.isArray(row.external_video_urls) && row.external_video_urls.length > 0;
    const hasPhoto = Array.isArray(row.photos) && row.photos.length > 0;

    posts.push({
      externalId,
      postedAt,
      type: hasVideo ? 'video' : hasPhoto ? 'photo' : 'text',
      text,
      permalink: str(pick(row, ['url', 'post_url'])) ?? null,
      mediaUrl: null,
      thumbnailUrl: null,
      durationSec: null,
      language: null,
      hashtags,
      mentions: extractMentions(text),
      urls: extractUrls(text),
      applause: num(pick(row, ['likes'])),
      conversation: num(pick(row, ['replies'])),
      // Reposts and quote posts are both amplification. Split kept in raw.
      amplification: num(pick(row, ['reposts'])) + num(pick(row, ['quotes'])),
      saves: num(pick(row, ['bookmarks'])),
      views: num(pick(row, ['views'])),
      raw: row,
    });
  }

  const audience: NormalizedAudience | undefined = followers > 0
    ? { day: toDayString(new Date()), followers, extra: {} }
    : undefined;

  if (posts.length === 0 && rows.length > 0 && warnings.length === 0) {
    warnings.push('X for @' + handle + ': rows returned but none were original posts inside the window.');
  }
  if (!profile && rows.length === 0) {
    throw new AdapterError(
      'Bright Data returned nothing for the X account @' + handle + '.',
      { platform: PLATFORM, retryable: false },
    );
  }

  return { posts, audience, profile, warnings };
}
