/**
 * Threads reads via EnsembleData.
 *
 * Two calls per channel. The posts endpoint keys on a numeric profile id rather
 * than a handle, so a search resolves the handle first. The id is then cached on
 * the channel cursor, which makes every subsequent run a single call.
 *
 * The posts payload is deeply nested (data[].node.thread_items[].post), which is
 * Meta's own GraphQL shape passed through rather than flattened by the vendor.
 * Unwrapping it here is the price of getting the platform's real field names.
 */
import { AdapterError } from './types';
import type { AdapterProfile, NormalizedAudience, NormalizedPost } from './types';
import { ensembleGet, envelope } from '@/lib/vendors/ensembledata';
import { isRecord, pick, num, str, toDate } from './vendor-posts';
import { extractHashtags, extractMentions, extractUrls, toDayString } from './util/normalize';
import type { Platform } from '@/lib/types';

const PLATFORM: Platform = 'threads';

/** Resolve a handle to the numeric profile id the posts endpoint requires. */
export async function resolveId(
  handle: string,
  token: string,
  onApiCall?: () => void,
  signal?: AbortSignal,
): Promise<{ id: string; profile: AdapterProfile; audience?: NormalizedAudience }> {
  const body = await ensembleGet('/threads/user/search', { name: handle }, {
    token, platform: PLATFORM, onApiCall, signal,
  });
  const rows = envelope<unknown[]>(body) ?? [];

  // Search is fuzzy, so take the exact username match rather than the first hit.
  let node: Record<string, unknown> | undefined;
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const n = isRecord(row.node) ? row.node : row;
    if (str(n.username)?.toLowerCase() === handle.toLowerCase()) { node = n; break; }
  }
  if (!node) {
    throw new AdapterError(
      'EnsembleData found no Threads account matching @' + handle + ' exactly.',
      { platform: PLATFORM, retryable: false },
    );
  }

  const id = str(pick(node, ['pk', 'id']));
  if (!id) {
    throw new AdapterError('Threads search returned no id for @' + handle + '.', {
      platform: PLATFORM, retryable: false,
    });
  }

  const followers = num(pick(node, ['follower_count', 'followers']));
  const profile: AdapterProfile = {
    externalId: id,
    handle,
    displayName: str(pick(node, ['full_name'])),
    avatarUrl: str(pick(node, ['profile_pic_url'])) ?? null,
    profileUrl: 'https://www.threads.com/@' + handle,
    followers,
    meta: { source: 'ensembledata', isVerified: Boolean(node.is_verified) },
  };

  const audience: NormalizedAudience | undefined = followers > 0
    ? { day: toDayString(new Date()), followers, extra: {} }
    : undefined;

  return { id, profile, audience };
}

/** Pull the post object out of the vendor's nested GraphQL envelope. */
function unwrapPost(row: unknown): Record<string, unknown> | undefined {
  if (!isRecord(row)) return undefined;
  const node = isRecord(row.node) ? row.node : row;
  const items = node.thread_items;
  if (Array.isArray(items) && items.length > 0 && isRecord(items[0])) {
    const post = items[0].post;
    if (isRecord(post)) return post;
  }
  return isRecord(node.post) ? node.post : undefined;
}

export async function fetchPosts(
  id: string,
  handle: string,
  token: string,
  opts: { since: Date; until: Date; onApiCall?: () => void; signal?: AbortSignal },
): Promise<{
  posts: NormalizedPost[];
  warnings: string[];
  exhaustive: boolean;
  incompleteReason?: string;
}> {
  const body = await ensembleGet('/threads/user/posts', { id }, {
    token, platform: PLATFORM, onApiCall: opts.onApiCall, signal: opts.signal,
  });
  const rows = envelope<unknown[]>(body) ?? [];

  const warnings: string[] = [];
  const posts: NormalizedPost[] = [];
  let oldest: Date | null = null;

  for (const row of rows) {
    const post = unwrapPost(row);
    if (!post) continue;

    const nativeId = str(pick(post, ['pk', 'id']));
    const postedAt = toDate(pick(post, ['taken_at', 'taken_at_timestamp', 'device_timestamp']));
    if (!nativeId || !postedAt) continue;
    if (!oldest || postedAt < oldest) oldest = postedAt;
    if (postedAt < opts.since || postedAt > opts.until) continue;

    const caption = isRecord(post.caption) ? str(post.caption.text) : undefined;
    const text = caption ?? str(pick(post, ['text_post_app_info', 'text'])) ?? '';

    // Threads separates reposts from quote posts under text_post_app_info.
    // Both are amplification; the split stays in raw.
    const appInfo = isRecord(post.text_post_app_info) ? post.text_post_app_info : {};
    const amplification = num(pick(appInfo, ['repost_count'])) + num(pick(appInfo, ['quote_count']));

    const code = str(pick(post, ['code']));
    // Bright Data's dedicated Threads post dataset keys the same post by its
    // public shortcode. Prefer that cross-vendor identity so switching sources
    // enriches one pooled row instead of creating a duplicate.
    const externalId = code ?? nativeId;

    posts.push({
      externalId,
      postedAt,
      type: 'text',
      text,
      permalink: code ? 'https://www.threads.com/@' + handle + '/post/' + code : null,
      mediaUrl: null,
      thumbnailUrl: null,
      durationSec: null,
      language: null,
      hashtags: extractHashtags(text),
      mentions: extractMentions(text),
      urls: extractUrls(text),
      applause: num(pick(post, ['like_count'])),
      conversation: num(pick(appInfo, ['direct_reply_count'])) || num(pick(post, ['reply_count'])),
      amplification,
      saves: 0,
      // Threads publishes no view count to anyone.
      views: 0,
      raw: post,
    });
  }

  const incompleteReason = oldest && oldest > opts.since && rows.length > 0
    ? 'Threads for @' + handle + ': the vendor returned ' + rows.length + ' posts reaching back to '
      + toDayString(oldest) + ', which does not cover the requested window and exposes no continuation cursor. Collect more frequently.'
    : rows.length > 0 && !oldest
      ? 'The Threads response contained no parseable dated posts, so the requested window cannot be certified; inspect the vendor response shape.'
      : rows.length === 0
        ? 'EnsembleData returned an empty recent Threads feed without a terminal pagination marker, so the requested window is unmeasured rather than certified empty.'
      : undefined;
  if (incompleteReason) warnings.push(incompleteReason);

  return { posts, warnings, exhaustive: incompleteReason === undefined, incompleteReason };
}
