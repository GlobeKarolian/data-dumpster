/**
 * Public LinkedIn company and post reads through Bright Data.
 *
 * LinkedIn's official API remains an administrator-only source. Bright Data's
 * public company dataset supplies a stable numeric company id and current
 * follower stock; its company-post discovery dataset supplies public posts and
 * the two engagement counters visible without administrator access.
 *
 * A completed Bright Data snapshot is not proof that LinkedIn's historical
 * feed was exhausted. This layer therefore always returns terminal-incomplete
 * post coverage until the source exposes a cursor or explicit exhaustion
 * marker. Useful observations still flow to the caller without starting an
 * unbounded paid retry loop.
 */
import type { Platform, PostType } from '@/lib/types';
import {
  DATASETS,
  isErrorRow,
  rowError,
  scrapeSync,
} from '@/lib/vendors/brightdata';
import {
  extractHashtags,
  extractMentions,
  extractUrls,
  toDayString,
} from './util/normalize';
import { isRecord, pick, str, toDate } from './vendor-posts';
import {
  AdapterError,
  type AdapterProfile,
  type NormalizedAudience,
  type NormalizedPost,
} from './types';

const PLATFORM: Platform = 'linkedin';

/**
 * Bright Data's public post response currently exposes likes and comments.
 * The required normalized numeric slots for the other metrics remain zero,
 * but this metadata makes clear that those zeros are unavailable values rather
 * than observations of nobody sharing, saving, or viewing a post.
 */
export const LINKEDIN_BRIGHTDATA_METRIC_AVAILABILITY = {
  applause: true,
  conversation: true,
  amplification: false,
  saves: false,
  views: false,
} as const;

export interface LinkedInCompanyProfileMapping {
  profile: AdapterProfile;
  audience?: NormalizedAudience;
}

export interface LinkedInCompanyProfileResult extends LinkedInCompanyProfileMapping {
  warnings: string[];
}

export interface LinkedInCompanyPostsResult {
  posts: NormalizedPost[];
  warnings: string[];
  hasMore: false;
  exhaustive: false;
  incompleteReason: string;
  metricAvailability: typeof LINKEDIN_BRIGHTDATA_METRIC_AVAILABILITY;
}

interface VendorCallOptions {
  onApiCall?: () => void;
  signal?: AbortSignal;
  resumeSnapshotId?: string;
}

function identityString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  return undefined;
}

/** A count parser that preserves the difference between absent and zero. */
function observedCount(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.trunc(value);
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(/[, ]/g, ''));
    if (Number.isFinite(parsed) && parsed >= 0) return Math.trunc(parsed);
  }
  return undefined;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => str(item))
    .filter((item): item is string => item !== undefined);
}

function unique(values: readonly string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function companyHandleFromUrl(value: unknown): string | undefined {
  const raw = str(value);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (!/(^|\.)linkedin\.com$/i.test(url.hostname)) return undefined;
    const segments = url.pathname.split('/').filter(Boolean);
    const kind = segments.findIndex((segment) => (
      segment === 'company' || segment === 'showcase' || segment === 'school'
    ));
    return kind >= 0 ? segments[kind + 1]?.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

/** Convert an adapter handle or company URL into a canonical public URL. */
export function linkedInCompanyUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new AdapterError('Empty LinkedIn company', { platform: PLATFORM, retryable: false });
  }

  if (/^https?:\/\//i.test(trimmed)) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      throw new AdapterError(
        'Unparseable LinkedIn company URL: ' + input,
        { platform: PLATFORM, retryable: false },
      );
    }
    if (!/(^|\.)linkedin\.com$/i.test(url.hostname)) {
      throw new AdapterError(
        'Not a LinkedIn company URL: ' + input,
        { platform: PLATFORM, retryable: false },
      );
    }
    const segments = url.pathname.split('/').filter(Boolean);
    const kindIndex = segments.findIndex((segment) => (
      segment === 'company' || segment === 'showcase' || segment === 'school'
    ));
    const kind = kindIndex >= 0 ? segments[kindIndex] : undefined;
    const handle = kindIndex >= 0 ? segments[kindIndex + 1] : undefined;
    if (!kind || !handle) {
      throw new AdapterError(
        'No LinkedIn company page in URL: ' + input,
        { platform: PLATFORM, retryable: false },
      );
    }
    return 'https://www.linkedin.com/' + kind + '/' + handle.toLowerCase();
  }

  return 'https://www.linkedin.com/company/' + trimmed.replace(/^@/, '').toLowerCase();
}

/**
 * Map one verified company-dataset row.
 *
 * `company_id` is the stable numeric LinkedIn identity. The `id` and page URL
 * are vanity names and may change, so neither is allowed to replace it.
 */
export function mapLinkedInCompanyProfile(
  row: Record<string, unknown>,
  requestedCompany: string,
  capturedAt: Date = new Date(),
): LinkedInCompanyProfileMapping | undefined {
  const externalId = identityString(row.company_id);
  if (!externalId) return undefined;

  const returnedUrl = str(row.url);
  const handle = str(row.id)?.toLowerCase()
    ?? companyHandleFromUrl(returnedUrl)
    ?? companyHandleFromUrl(linkedInCompanyUrl(requestedCompany));
  if (!handle) return undefined;

  const followers = observedCount(row.followers);
  const profile: AdapterProfile = {
    externalId,
    handle,
    displayName: str(row.name),
    avatarUrl: str(row.logo) ?? null,
    profileUrl: returnedUrl ?? linkedInCompanyUrl(handle),
    ...(followers !== undefined ? { followers } : {}),
    meta: { source: 'brightdata' },
  };

  return {
    profile,
    ...(followers !== undefined
      ? {
          audience: {
            day: toDayString(capturedAt),
            followers,
            extra: {},
          },
        }
      : {}),
  };
}

/** Collect current public company identity and follower stock. */
export async function fetchLinkedInCompanyProfile(
  company: string,
  apiKey: string,
  opts: VendorCallOptions & { capturedAt?: Date } = {},
): Promise<LinkedInCompanyProfileResult> {
  const url = linkedInCompanyUrl(company);
  const rows = await scrapeSync(
    DATASETS.linkedinCompany,
    [{ url }],
    {
      apiKey,
      platform: PLATFORM,
      onApiCall: opts.onApiCall,
      signal: opts.signal,
      resumeSnapshotId: opts.resumeSnapshotId,
    },
  );

  const warnings: string[] = [];
  const usableRows: Record<string, unknown>[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    if (isErrorRow(row)) {
      const detail = rowError(row);
      if (detail) warnings.push('LinkedIn company row error for ' + company + ': ' + detail);
      continue;
    }
    usableRows.push(row);
  }

  for (const row of usableRows) {
    const mapped = mapLinkedInCompanyProfile(row, company, opts.capturedAt);
    if (mapped) return { ...mapped, warnings };
  }

  const missingStableId = usableRows.length > 0;
  throw new AdapterError(
    missingStableId
      ? 'Bright Data returned a LinkedIn company for ' + company
        + ' without the stable numeric `company_id`. A vanity `id` cannot replace it; '
        + 'no observations were accepted.'
      : 'Bright Data returned no public LinkedIn company profile for ' + company
        + (warnings.length > 0 ? '. ' + warnings.join(' ') : '.'),
    { platform: PLATFORM, retryable: false },
  );
}

function firstUrl(value: unknown): string | undefined {
  const direct = str(value);
  if (direct) return direct;
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = firstUrl(item);
      if (nested) return nested;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  return str(pick(value, ['url', 'link', 'href', 'src']));
}

function externalLink(row: Record<string, unknown>): string | undefined {
  return firstUrl(row.external_link_data);
}

function externalLinkImage(row: Record<string, unknown>): string | undefined {
  const values = Array.isArray(row.external_link_data)
    ? row.external_link_data
    : [row.external_link_data];
  for (const value of values) {
    if (!isRecord(value)) continue;
    const found = firstUrl(pick(value, [
      'image',
      'image_url',
      'thumbnail',
      'thumbnail_url',
    ]));
    if (found) return found;
  }
  return undefined;
}

function linkedInPostType(row: Record<string, unknown>): PostType {
  const nativeType = str(row.post_type)?.toLowerCase();
  if (row.repost !== undefined && row.repost !== null && row.repost !== false) return 'repost';
  if (nativeType === 'repost') return 'repost';
  if (stringArray(row.videos).length > 0) return 'video';
  if (firstUrl(row.document_cover_image) || (observedCount(row.document_page_count) ?? 0) > 0) {
    return 'carousel';
  }
  const images = stringArray(row.images);
  if (images.length > 1) return 'carousel';
  if (images.length === 1) return 'photo';
  if (nativeType === 'poll') return 'poll';
  if (nativeType === 'article') return 'article';
  if (externalLink(row)) return 'link';
  return 'text';
}

function sameCompany(expected: string | undefined, rowUrl: unknown): boolean {
  if (!expected) return true;
  const actual = companyHandleFromUrl(rowUrl);
  return !actual || actual === expected.toLowerCase();
}

/** Map one post row, rejecting out-of-window or incomplete metric records. */
export function mapLinkedInCompanyPost(
  row: Record<string, unknown>,
  opts: { since: Date; until: Date; expectedCompanyHandle?: string },
): NormalizedPost | undefined {
  const externalId = identityString(row.id);
  const postedAt = toDate(row.date_posted);
  if (!externalId || !postedAt || postedAt < opts.since || postedAt > opts.until) {
    return undefined;
  }
  if (!sameCompany(opts.expectedCompanyHandle, row.use_url)) return undefined;

  // These are the only public engagement counters observed in the live
  // company-post response. If either field is missing, skipping the row is more
  // honest than turning an absent measurement into a measured zero.
  const applause = observedCount(row.num_likes);
  const conversation = observedCount(row.num_comments);
  if (applause === undefined || conversation === undefined) return undefined;

  const text = str(row.post_text) ?? str(row.headline) ?? str(row.title) ?? '';
  const type = linkedInPostType(row);
  const images = stringArray(row.images);
  const videos = stringArray(row.videos);
  const videoThumbnail = firstUrl(row.video_thumbnail);
  const documentCover = firstUrl(row.document_cover_image);
  const linkedImage = externalLinkImage(row);
  const linkedUrl = externalLink(row);
  const duration = observedCount(row.video_duration);

  const suppliedHashtags = stringArray(row.hashtags)
    .map((tag) => tag.replace(/^#/, '').trim().toLowerCase())
    .filter(Boolean);
  const hashtags = unique(suppliedHashtags.length > 0 ? suppliedHashtags : extractHashtags(text));

  let mediaUrl: string | null = null;
  if (type === 'video') mediaUrl = videos[0] ?? null;
  else if (type === 'photo' || type === 'carousel') mediaUrl = images[0] ?? null;
  else if (type === 'link' || type === 'article') mediaUrl = linkedUrl ?? null;

  return {
    externalId,
    postedAt,
    type,
    text: text || null,
    permalink: str(row.url) ?? null,
    mediaUrl,
    thumbnailUrl: videoThumbnail ?? documentCover ?? images[0] ?? linkedImage ?? null,
    durationSec: duration !== undefined && duration > 0 ? duration : null,
    language: null,
    hashtags,
    mentions: extractMentions(text),
    urls: unique([
      ...extractUrls(text),
      ...stringArray(row.embedded_links),
      ...(linkedUrl ? [linkedUrl] : []),
    ]),
    applause,
    conversation,
    // Bright Data's verified public response exposes no count for these three
    // fields. They are required numeric normalization slots, not claims that
    // the post received zero shares, saves, or views. Availability metadata is
    // returned beside the collection result above.
    amplification: 0,
    saves: 0,
    views: 0,
  };
}

/** Collect public company posts for the exact requested ISO window. */
export async function fetchLinkedInCompanyPosts(
  company: string,
  apiKey: string,
  opts: VendorCallOptions & {
    since: Date;
    until: Date;
    limit: number;
    expectedCompanyHandle?: string;
  },
): Promise<LinkedInCompanyPostsResult> {
  const url = linkedInCompanyUrl(company);
  const rows = await scrapeSync(
    DATASETS.linkedinCompanyPosts,
    [{
      url,
      start_date: opts.since.toISOString(),
      end_date: opts.until.toISOString(),
    }],
    {
      apiKey,
      platform: PLATFORM,
      discoverBy: 'company_url',
      onApiCall: opts.onApiCall,
      signal: opts.signal,
      resumeSnapshotId: opts.resumeSnapshotId,
    },
  );

  const warnings: string[] = [];
  const byId = new Map<string, NormalizedPost>();
  let errorRows = 0;
  let rejectedRows = 0;
  const expectedCompanyHandle = opts.expectedCompanyHandle
    ?? companyHandleFromUrl(url);

  for (const row of rows) {
    if (!isRecord(row)) continue;
    if (isErrorRow(row)) {
      errorRows += 1;
      const detail = rowError(row);
      if (detail) warnings.push('LinkedIn post row error for ' + company + ': ' + detail);
      continue;
    }
    const mapped = mapLinkedInCompanyPost(row, {
      since: opts.since,
      until: opts.until,
      expectedCompanyHandle,
    });
    if (!mapped) {
      rejectedRows += 1;
      continue;
    }
    byId.set(mapped.externalId, mapped);
  }

  const collected = Array.from(byId.values()).sort(
    (left, right) => right.postedAt.getTime() - left.postedAt.getTime(),
  );
  const limit = Math.max(0, Math.trunc(opts.limit));
  const truncated = collected.length > limit;
  const posts = collected.slice(0, limit);

  if (rejectedRows > 0) {
    warnings.push(
      String(rejectedRows) + ' LinkedIn row(s) were outside the exact window, belonged to a '
        + 'different company, or lacked an observed likes/comments measurement and were ignored.',
    );
  }

  const incompleteReason = errorRows > 0
    ? 'Bright Data returned one or more error rows for this LinkedIn company-post collection. '
      + 'Useful rows were retained, but the requested window cannot be certified.'
    : truncated
      ? 'Bright Data returned more than the local ' + String(limit)
        + '-post limit without a durable data cursor. Useful rows were retained, but the requested '
        + 'window cannot be certified.'
      : posts.length === 0
        ? 'Bright Data returned no usable LinkedIn posts for the requested dates, but the source '
          + 'does not expose a terminal marker that can certify inactivity.'
        : 'Bright Data completed the LinkedIn company-post snapshot but exposed no terminal cursor '
          + 'or completeness marker, so the requested historical window cannot be certified.';
  warnings.push(incompleteReason);

  return {
    posts,
    warnings,
    hasMore: false,
    exhaustive: false,
    incompleteReason,
    metricAvailability: LINKEDIN_BRIGHTDATA_METRIC_AVAILABILITY,
  };
}
