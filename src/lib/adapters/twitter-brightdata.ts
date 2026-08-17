/**
 * X (Twitter) reads via Bright Data.
 *
 * X does sell a sanctioned competitor read: the v2 API bills roughly $0.005 per
 * post read, which at this landscape's size is $110 to $150 a month. That is
 * the cleaner answer and the adapter in twitter.ts implements it. This module
 * exists so an org that has already bought vendor access does not also have to
 * buy an X subscription to see the platform at all.
 *
 * The endpoint is Posts, in discover-by-profiles-array mode. Despite the mode
 * name, the live Bright Data input validator requires one `urls` array per
 * input row. Every result carries the author's follower count, so audience
 * comes free.
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
  exhaustive: boolean;
  incompleteReason?: string;
}


/**
 * The failure for a response that contained only vendor error rows.
 *
 * Exported for its test: the retryable flag here is what decides whether a
 * vendor-side crawler outage freezes every X channel until an operator
 * intervenes, which is precisely what happened when this was false.
 */
export function errorRowFailure(handle: string, warnings: readonly string[]): AdapterError {
  const vendorFailure = warnings.find((warning) => warning.startsWith('X row error'));
  return new AdapterError(
    (vendorFailure
      ? 'Bright Data could not collect X profile @' + handle + ': '
        + vendorFailure.replace(/^X row error for @[^:]+:\s*/, '')
      : 'Bright Data returned only error rows for X profile @' + handle + '.')
      + ' This is a vendor-side collection failure and will be retried.',
    { platform: PLATFORM, retryable: true },
  );
}

export async function fetchProfilePosts(
  handle: string,
  apiKey: string,
  opts: {
    since: Date;
    until: Date;
    limit: number;
    onApiCall?: () => void;
    signal?: AbortSignal;
    resumeSnapshotId?: string;
    /** A stable id already verified for this pooled channel. */
    fallbackExternalId?: string | null;
  },
): Promise<TwitterVendorResult> {
  const profileUrl = 'https://x.com/' + handle.replace(/^@/, '');

  const rows = await scrapeSync(
    DATASETS.twitterPosts,
    [{
      urls: [profileUrl],
      start_date: vendorDate(opts.since),
      end_date: vendorDate(opts.until),
    }],
    {
      apiKey,
      platform: PLATFORM,
      discoverBy: 'profiles_array',
      onApiCall: opts.onApiCall,
      signal: opts.signal,
      resumeSnapshotId: opts.resumeSnapshotId,
    },
  );

  const warnings: string[] = [];
  const posts: NormalizedPost[] = [];
  let followers = 0;
  let profile: AdapterProfile | undefined;
  let sawErrorRow = false;
  let noPublicPosts = false;
  const observedHandles = new Set<string>();

  for (const row of rows) {
    if (!isRecord(row)) continue;
    if (isErrorRow(row)) {
      const why = rowError(row);
      const code = str(row.error_code)?.toLowerCase();
      if (code === 'dead_page' && /no public posts/i.test(why ?? '')) {
        noPublicPosts = true;
        if (why) warnings.push('X for @' + handle + ': ' + why);
        continue;
      }
      sawErrorRow = true;
      if (why) warnings.push('X row error for @' + handle + ': ' + why);
      continue;
    }

    const f = num(pick(row, ['followers', 'followers_count']));
    const observedHandle = str(pick(row, ['user_posted', 'username', 'screen_name']))
      ?.replace(/^@/, '')
      .toLowerCase();
    if (observedHandle) observedHandles.add(observedHandle);
    if (f > followers) followers = f;
    if (!profile) {
      const externalId = str(pick(row, ['user_id', 'profile_id', 'author_id']));
      if (externalId) {
        profile = {
          externalId,
          handle: str(pick(row, ['user_posted'])) ?? handle,
          displayName: str(pick(row, ['name'])),
          avatarUrl: str(pick(row, ['profile_image_link'])) ?? null,
          profileUrl,
          followers: f,
          meta: { source: 'brightdata', isVerified: Boolean(row.is_verified) },
        };
      }
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
  if (!profile) {
    const expectedHandle = handle.replace(/^@/, '').toLowerCase();
    const responseMatchesRequestedAccount = observedHandles.size > 0
      && [...observedHandles].every((observed) => observed === expectedHandle);
    const fallbackExternalId = opts.fallbackExternalId?.trim();
    if (fallbackExternalId && responseMatchesRequestedAccount) {
      profile = {
        externalId: fallbackExternalId,
        handle: handle.replace(/^@/, ''),
        profileUrl,
        followers,
        meta: { source: 'brightdata', identitySource: 'stored-verified-profile' },
      };
    }
  }
  if (!profile) {
    if (sawErrorRow) {
      /*
       * A vendor error row is evidence that the CRAWL failed, never that the
       * account is gone. When X shipped a frontend change, Bright Data's
       * crawler answered every profile with "Crawler error: waiting for
       * selector [data-namespace=@xai/icons]" for a while, and this branch
       * classified all ninety X channels as permanent failures. They stayed
       * frozen after the vendor fixed their selectors, because permanent means
       * nothing retries without an operator.
       *
       * X offers no anonymous public page to corroborate absence the way the
       * Threads adapter does, so every vendor-reported failure here is
       * retryable. The queue's consecutive-attempt ceiling is what keeps a
       * genuinely dead account from becoming an hourly paid crawl forever.
       */
      throw errorRowFailure(handle, warnings);
    }
    if (rows.length === 0 || noPublicPosts) {
      const incompleteReason = noPublicPosts
        ? 'Bright Data found no public X posts for @' + handle
          + ' in the requested period. The source cannot certify that the account was inactive.'
        : 'Bright Data returned no X rows for @' + handle
          + ' and cannot certify the requested historical window.';
      if (!warnings.includes(incompleteReason)) warnings.push(incompleteReason);
      return {
        posts: [],
        warnings,
        exhaustive: false,
        incompleteReason,
      };
    }
    throw new AdapterError(
      'Bright Data returned X rows for @' + handle
        + ' without a stable platform id. No observations were accepted.',
      { platform: PLATFORM, retryable: false },
    );
  }

  const reachedLimit = posts.length >= opts.limit;
  if (posts.length > opts.limit) posts.length = opts.limit;
  const incompleteReason = sawErrorRow
    ? 'Bright Data returned an error row for this X collection; retry the date-ranged dataset before certifying the window.'
    : reachedLimit
      ? 'Bright Data reached the ' + opts.limit + '-post X run limit without exposing a continuation cursor; narrow the window or raise the run limit.'
      : 'Bright Data completed the X snapshot but exposed no terminal cursor or completeness marker, so the requested historical window cannot be certified.';
  if (incompleteReason && !warnings.includes(incompleteReason)) warnings.push(incompleteReason);

  return {
    posts,
    audience,
    profile,
    warnings,
    exhaustive: false,
    incompleteReason,
  };
}
