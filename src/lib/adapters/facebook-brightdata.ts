/**
 * Facebook Page reads via Bright Data.
 *
 * The sanctioned route to a competitor Page is Page Public Content Access, a
 * Meta App Review feature needing business verification, an architecture review
 * and a working demo. That is the right long-term answer and docs/DATA-ACCESS.md
 * argues for pursuing it. This is what works today.
 *
 * The endpoint is Pages Posts by Profile URL: hand it a Page URL and it returns
 * posts directly, with the Page's follower count stamped on every row. No
 * discovery mode and no second call for the profile.
 *
 * Facebook publishes reaction counts split by type. We sum them into applause
 * because the metric vocabulary treats a like and a love as the same act of
 * approval, and keep the split in the raw payload for anyone who disagrees.
 */
import { AdapterError } from './types';
import type { AdapterProfile, NormalizedAudience, NormalizedPost } from './types';
import { DATASETS, scrapeSync, rowError, isErrorRow } from '@/lib/vendors/brightdata';
import { isRecord, pick, num, str, toDate, vendorDate } from './vendor-posts';
import { extractHashtags, extractMentions, extractUrls, toDayString } from './util/normalize';
import type { Platform, PostType } from '@/lib/types';

const PLATFORM: Platform = 'facebook';

function postType(row: Record<string, unknown>): PostType {
  const attachments = row.attachments;
  if (Array.isArray(attachments) && attachments.length > 0) {
    const first = attachments[0];
    if (isRecord(first)) {
      const t = String(first.type ?? '').toLowerCase();
      if (t.includes('video')) return 'video';
      if (t.includes('photo') || t.includes('image')) return 'photo';
      if (t.includes('link')) return 'link';
      if (attachments.length > 1) return 'carousel';
    }
  }
  if (str(row.video_view_count) || num(row.video_view_count) > 0) return 'video';
  return 'text';
}

export interface FacebookVendorResult {
  posts: NormalizedPost[];
  audience?: NormalizedAudience;
  profile?: AdapterProfile;
  warnings: string[];
}

export async function fetchPagePosts(
  handle: string,
  apiKey: string,
  opts: { since: Date; until: Date; limit: number; onApiCall?: () => void; signal?: AbortSignal },
): Promise<FacebookVendorResult> {
  const pageUrl = handle.includes('://') ? handle : 'https://www.facebook.com/' + handle;

  const rows = await scrapeSync(
    DATASETS.facebookPagePosts,
    [{
      url: pageUrl,
      num_of_posts: Math.min(opts.limit, 200),
      start_date: vendorDate(opts.since),
      end_date: vendorDate(opts.until),
    }],
    { apiKey, platform: PLATFORM, onApiCall: opts.onApiCall, signal: opts.signal },
  );

  const warnings: string[] = [];
  const posts: NormalizedPost[] = [];
  let followers = 0;
  let profile: AdapterProfile | undefined;

  for (const row of rows) {
    if (!isRecord(row)) continue;
    if (isErrorRow(row)) {
      const why = rowError(row);
      if (why) warnings.push('Facebook row error for ' + handle + ': ' + why);
      continue;
    }

    // Page identity is stamped on every post row, so the first usable row
    // doubles as the profile and saves a second call.
    const f = num(pick(row, ['page_followers', 'followers']));
    if (f > followers) followers = f;
    if (!profile) {
      profile = {
        externalId: str(pick(row, ['delegate_page_id', 'page_id'])) ?? handle,
        handle,
        displayName: str(pick(row, ['page_name'])),
        avatarUrl: str(pick(row, ['page_logo', 'avatar_image_url'])) ?? null,
        profileUrl: str(pick(row, ['page_url'])) ?? pageUrl,
        followers: f,
        meta: {
          source: 'brightdata',
          isVerified: Boolean(row.page_is_verified),
          category: str(pick(row, ['page_category'])) ?? null,
        },
      };
    }

    const postedAt = toDate(pick(row, ['date_posted', 'timestamp']));
    const externalId = str(pick(row, ['post_id', 'id', 'url']));
    if (!postedAt || !externalId) continue;
    if (postedAt < opts.since || postedAt > opts.until) continue;

    const text = str(pick(row, ['content', 'link_description_text'])) ?? '';

    // Reactions arrive split by type. Sum them: a like and a love are the same
    // act as far as the applause metric is concerned. The split stays in raw.
    let applause = num(pick(row, ['likes', 'num_likes']));
    const reactions = row.count_reactions_type;
    if (Array.isArray(reactions)) {
      const summed = reactions.reduce<number>((acc, r) => (
        isRecord(r) ? acc + num(pick(r, ['reaction_count', 'count'])) : acc
      ), 0);
      if (summed > applause) applause = summed;
    }

    posts.push({
      externalId,
      postedAt,
      type: postType(row),
      text,
      permalink: str(pick(row, ['url', 'post_url'])) ?? null,
      mediaUrl: null,
      thumbnailUrl: str(pick(row, ['header_image'])) ?? null,
      durationSec: null,
      language: null,
      hashtags: extractHashtags(text),
      mentions: extractMentions(text),
      urls: extractUrls(text),
      applause,
      conversation: num(pick(row, ['num_comments'])),
      amplification: num(pick(row, ['num_shares'])),
      saves: 0,
      views: num(pick(row, ['video_view_count', 'views'])),
      raw: row,
    });
  }

  const audience: NormalizedAudience | undefined = followers > 0
    ? { day: toDayString(new Date()), followers, extra: {} }
    : undefined;

  if (posts.length === 0 && rows.length > 0 && warnings.length === 0) {
    warnings.push('Facebook for ' + handle + ': rows returned but none fell inside the requested window.');
  }
  if (!profile && rows.length === 0) {
    throw new AdapterError(
      'Bright Data returned nothing for the Facebook Page ' + handle + '.',
      { platform: PLATFORM, retryable: false },
    );
  }

  return { posts, audience, profile, warnings };
}
