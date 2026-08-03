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
    if (attachments.length > 1) return 'carousel';
    const first = attachments[0];
    if (isRecord(first)) {
      const t = String(first.type ?? '').toLowerCase();
      if (t.includes('video')) return 'video';
      if (t.includes('photo') || t.includes('image')) return 'photo';
      if (t.includes('link')) return 'link';
    }
  }
  const nativeType = str(row.post_type)?.toLowerCase() ?? '';
  if (nativeType.includes('video') || nativeType.includes('reel')) return 'video';
  if (nativeType.includes('photo') || nativeType.includes('image')) return 'photo';
  if (nativeType.includes('link')) return 'link';
  if (str(row.video_view_count) || num(row.video_view_count) > 0) return 'video';
  return 'text';
}

interface FacebookPostMedia {
  mediaUrl: string | null;
  thumbnailUrl: string | null;
}

/**
 * Facebook's external-image proxy carries the durable publisher image in its
 * `url` query parameter. Native `scontent` media has no such origin and must be
 * left alone.
 */
export function durableFacebookCreativeUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const proxy = new URL(value);
    const host = proxy.hostname.toLowerCase();
    if (!host.startsWith('external') || !host.endsWith('.fbcdn.net')) return value;
    const origin = proxy.searchParams.get('url');
    if (!origin) return value;
    const parsed = new URL(origin);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
      ? parsed.toString()
      : value;
  } catch {
    return value;
  }
}

function facebookPostMedia(row: Record<string, unknown>, type: PostType): FacebookPostMedia {
  const attachments = Array.isArray(row.attachments) ? row.attachments : [];
  const attachment = attachments.find(isRecord);
  const attachmentUrl = attachment
    ? str(pick(attachment, ['url', 'image_url']))
    : undefined;
  const videoUrl = attachment
    ? str(pick(attachment, ['video_url', 'video']))
    : undefined;
  const videoThumbnail = attachment
    ? str(pick(attachment, ['thumbnail_url', 'thumbnail']))
    : undefined;
  const postImage = str(pick(row, ['post_image', 'post_external_image']));
  const durableAttachmentUrl = durableFacebookCreativeUrl(attachmentUrl);
  const durablePostImage = durableFacebookCreativeUrl(postImage);

  // `header_image` is the Page cover stamped onto every Bright Data row. It is
  // profile metadata, never post creative. The exact July 17 Boston,
  // Massachusetts row contained the unrelated cover in header_image while
  // attachments[0].url and post_image both held the story creative.
  const thumbnailUrl = videoThumbnail ?? durableAttachmentUrl ?? durablePostImage ?? null;
  const mediaUrl = type === 'video'
    ? videoUrl ?? null
    : type === 'photo' || type === 'carousel'
      ? durableAttachmentUrl ?? durablePostImage ?? null
      : null;

  return { mediaUrl, thumbnailUrl };
}

/** Pure mapper kept public so observed vendor rows can lock media priority down. */
export function mapFacebookVendorPost(
  row: Record<string, unknown>,
  opts: { since: Date; until: Date },
): NormalizedPost | undefined {
  const postedAt = toDate(pick(row, ['date_posted', 'timestamp']));
  const externalId = str(pick(row, ['post_id', 'id', 'url']));
  if (!postedAt || !externalId || postedAt < opts.since || postedAt > opts.until) {
    return undefined;
  }

  const text = str(pick(row, ['content', 'link_description_text'])) ?? '';
  const type = postType(row);
  const media = facebookPostMedia(row, type);

  let applause = num(pick(row, ['likes', 'num_likes']));
  const reactions = row.count_reactions_type;
  if (Array.isArray(reactions)) {
    const summed = reactions.reduce<number>((acc, reaction) => (
      isRecord(reaction) ? acc + num(pick(reaction, ['reaction_count', 'count'])) : acc
    ), 0);
    if (summed > applause) applause = summed;
  }

  return {
    externalId,
    postedAt,
    type,
    text,
    permalink: str(pick(row, ['url', 'post_url'])) ?? null,
    mediaUrl: media.mediaUrl,
    thumbnailUrl: media.thumbnailUrl,
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
  };
}

export interface FacebookVendorResult {
  posts: NormalizedPost[];
  audience?: NormalizedAudience;
  profile?: AdapterProfile;
  warnings: string[];
  exhaustive: boolean;
  incompleteReason?: string;
}

export async function fetchPagePosts(
  handle: string,
  apiKey: string,
  opts: {
    since: Date; until: Date; limit: number; onApiCall?: () => void; signal?: AbortSignal;
    /**
     * A snapshot a previous run started and ran out of time waiting for.
     * Polling it is free; re-triggering the same collection is not.
     */
    resumeSnapshotId?: string;
  },
): Promise<FacebookVendorResult> {
  const pageUrl = handle.includes('://') ? handle : 'https://www.facebook.com/' + handle;
  const requestedPosts = Math.min(opts.limit, 200);

  const rows = await scrapeSync(
    DATASETS.facebookPagePosts,
    [{
      url: pageUrl,
      num_of_posts: requestedPosts,
      start_date: vendorDate(opts.since),
      end_date: vendorDate(opts.until),
    }],
    {
      apiKey,
      platform: PLATFORM,
      onApiCall: opts.onApiCall,
      signal: opts.signal,
      resumeSnapshotId: opts.resumeSnapshotId,
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

    const post = mapFacebookVendorPost(row, opts);
    if (post) posts.push(post);
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

  // Bright Data exposes no page cursor on this dataset. Exactly filling the
  // requested cap means older posts may exist, so the useful rows are stored
  // but the window cannot be certified complete.
  const exhaustive = rows.length < requestedPosts;
  const incompleteReason = exhaustive
    ? undefined
    : 'Bright Data returned its ' + requestedPosts
      + '-post Facebook cap without a continuation cursor; the selected window may be incomplete.';
  if (incompleteReason) warnings.push(incompleteReason);

  return { posts, audience, profile, warnings, exhaustive, incompleteReason };
}
