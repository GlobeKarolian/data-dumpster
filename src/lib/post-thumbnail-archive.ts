import { get, put } from '@vercel/blob';
import { and, desc, eq, gte, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { posts } from '@/db/schema';
import {
  allowedFacebookRedirect,
  canonicalFacebookPermalink,
  facebookOgImageUrl,
  storedFacebookPosterCandidates,
  type StoredPostPreviewSource,
} from '@/lib/post-preview-source';

const POSTER_CONTENT_TYPES = new Set([
  'image/avif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const MAX_POSTER_BYTES = 8 * 1024 * 1024;
const MAX_FACEBOOK_HTML_BYTES = 3 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 3;
const ARCHIVE_RETRY_HOURS = 6;
const ARCHIVE_MAX_ATTEMPTS = 3;
const ARCHIVE_LOOKBACK_DAYS = 45;

export interface ResolvedPostThumbnail {
  body: ArrayBuffer;
  contentType: string;
}

export interface ArchivedPostThumbnail {
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  contentLength: number;
  etag: string;
}

interface FacebookPostSource extends StoredPostPreviewSource {
  id: string;
  permalink: string | null;
}

function normalizedContentType(value: string | null): string {
  return (value ?? '').split(';', 1)[0].trim().toLowerCase();
}

function extensionFor(contentType: string): string {
  return ({
    'image/avif': 'avif',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  } as Record<string, string>)[contentType] ?? 'bin';
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The upstream response has already ended.
  }
}

async function readBounded(
  response: Response,
  maxBytes: number,
): Promise<ArrayBuffer | null> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await cancelBody(response);
    return null;
  }
  if (!response.body) return null;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string | null> {
  const bytes = await readBounded(response, maxBytes);
  return bytes ? new TextDecoder().decode(bytes) : null;
}

async function freshFacebookPosterUrl(
  permalink: string | null,
  signal: AbortSignal,
): Promise<string | null> {
  const canonical = canonicalFacebookPermalink(permalink);
  if (!canonical) return null;

  try {
    const response = await fetch(canonical, {
      redirect: 'error',
      signal,
      cache: 'no-store',
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': 'Mozilla/5.0 (compatible; DataDumpsterPreview/1.0; +https://www.datadumpster.boston)',
      },
    });
    if (!response.ok || normalizedContentType(response.headers.get('content-type')) !== 'text/html') {
      await cancelBody(response);
      return null;
    }
    const html = await readBoundedText(response, MAX_FACEBOOK_HTML_BYTES);
    return html ? facebookOgImageUrl(html) : null;
  } catch {
    return null;
  }
}

async function fetchFacebookPoster(
  source: string,
  signal: AbortSignal,
): Promise<ResolvedPostThumbnail | null> {
  let current = source;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    let response: Response;
    try {
      response = await fetch(current, {
        redirect: 'manual',
        signal,
        cache: 'no-store',
        headers: {
          accept: 'image/avif,image/webp,image/png,image/jpeg',
          referer: 'https://www.facebook.com/',
          'user-agent': 'Mozilla/5.0 (compatible; DataDumpsterPreview/1.0)',
        },
      });
    } catch {
      return null;
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const next = allowedFacebookRedirect(current, response.headers.get('location'));
      await cancelBody(response);
      if (!next || redirects === MAX_REDIRECTS) return null;
      current = next;
      continue;
    }

    const contentType = normalizedContentType(response.headers.get('content-type'));
    if (!response.ok || !POSTER_CONTENT_TYPES.has(contentType)) {
      await cancelBody(response);
      return null;
    }
    const body = await readBounded(response, MAX_POSTER_BYTES);
    return body ? { body, contentType } : null;
  }
  return null;
}

/** Recover a Facebook poster from fresh public metadata before trying stale storage. */
export async function resolveFacebookPostThumbnail(
  post: FacebookPostSource,
  inheritedSignal?: AbortSignal,
): Promise<ResolvedPostThumbnail | null> {
  const controller = inheritedSignal ? null : new AbortController();
  const signal = inheritedSignal ?? controller!.signal;
  const timeout = controller ? setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS) : null;
  try {
    const fresh = await freshFacebookPosterUrl(post.permalink, signal);
    const candidates = [fresh, ...storedFacebookPosterCandidates(post)]
      .filter((candidate): candidate is string => Boolean(candidate));
    for (const candidate of candidates) {
      const resolved = await fetchFacebookPoster(candidate, signal);
      if (resolved) return resolved;
    }
    return null;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function postThumbnailArchiveConfigured(): boolean {
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN
    || (process.env.BLOB_STORE_ID && process.env.VERCEL_OIDC_TOKEN),
  );
}

/** Persist the first good poster and attach its private object URL to the post. */
export async function persistPostThumbnail(
  postId: string,
  thumbnail: ResolvedPostThumbnail,
): Promise<string | null> {
  if (!postThumbnailArchiveConfigured()) return null;

  const pathname = `post-thumbnails/v1/${postId}.${extensionFor(thumbnail.contentType)}`;
  const blob = await put(pathname, thumbnail.body, {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 31_536_000,
    contentType: thumbnail.contentType,
  });
  await db.update(posts).set({
    archivedThumbnailUrl: blob.url,
    archivedThumbnailContentType: thumbnail.contentType,
    archivedThumbnailBytes: thumbnail.body.byteLength,
    archivedThumbnailAt: new Date(),
    thumbnailArchiveAttemptedAt: new Date(),
    thumbnailArchiveError: null,
  }).where(eq(posts.id, postId));
  return blob.url;
}

/** Read a retained private poster without exposing the storage capability. */
export async function readArchivedPostThumbnail(
  url: string | null,
): Promise<ArchivedPostThumbnail | null> {
  if (!url || !postThumbnailArchiveConfigured()) return null;
  try {
    const result = await get(url, { access: 'private' });
    if (!result || result.statusCode !== 200 || !POSTER_CONTENT_TYPES.has(result.blob.contentType)) {
      return null;
    }
    return {
      stream: result.stream,
      contentType: result.blob.contentType,
      contentLength: result.blob.size,
      etag: result.blob.etag,
    };
  } catch {
    return null;
  }
}

function compactError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'No recoverable public poster was found.';
  return message.replace(/\s+/g, ' ').trim().slice(0, 500);
}

async function archiveFacebookPost(post: FacebookPostSource): Promise<'archived' | 'unavailable'> {
  const attemptedAt = new Date();
  await db.update(posts).set({
    thumbnailArchiveAttemptedAt: attemptedAt,
    thumbnailArchiveAttempts: sql`${posts.thumbnailArchiveAttempts} + 1`,
    thumbnailArchiveError: null,
  }).where(eq(posts.id, post.id));

  try {
    const resolved = await resolveFacebookPostThumbnail(post);
    if (!resolved) throw new Error('No recoverable public Facebook poster was found.');
    const archivedUrl = await persistPostThumbnail(post.id, resolved);
    if (!archivedUrl) throw new Error('Private thumbnail storage is not configured.');
    return 'archived';
  } catch (error) {
    await db.update(posts).set({
      thumbnailArchiveAttemptedAt: attemptedAt,
      thumbnailArchiveError: compactError(error),
    }).where(eq(posts.id, post.id));
    return 'unavailable';
  }
}

/**
 * Drain a small, engagement-first Facebook archive batch. The existing
 * ten-minute recovery cron calls this without opening a paid vendor refresh.
 */
export async function archiveFacebookPostThumbnails(options?: {
  limit?: number;
  concurrency?: number;
}): Promise<{ attempted: number; archived: number; unavailable: number; skipped: boolean }> {
  if (!postThumbnailArchiveConfigured()) {
    return { attempted: 0, archived: 0, unavailable: 0, skipped: true };
  }

  const limit = Math.max(1, Math.min(options?.limit ?? 4, 20));
  const concurrency = Math.max(1, Math.min(options?.concurrency ?? 2, 4));
  const now = Date.now();
  const retryBefore = new Date(now - ARCHIVE_RETRY_HOURS * 60 * 60 * 1000);
  const postedAfter = new Date(now - ARCHIVE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const candidates = await db.select({
    id: posts.id,
    platform: posts.platform,
    thumbnailUrl: posts.thumbnailUrl,
    mediaUrl: posts.mediaUrl,
    permalink: posts.permalink,
    raw: posts.raw,
  }).from(posts).where(and(
    eq(posts.platform, 'facebook'),
    isNull(posts.archivedThumbnailUrl),
    gte(posts.postedAt, postedAfter),
    or(isNotNull(posts.thumbnailUrl), isNotNull(posts.permalink)),
    lt(posts.thumbnailArchiveAttempts, ARCHIVE_MAX_ATTEMPTS),
    or(
      isNull(posts.thumbnailArchiveAttemptedAt),
      lte(posts.thumbnailArchiveAttemptedAt, retryBefore),
    ),
  )).orderBy(desc(posts.engagementTotal), desc(posts.postedAt)).limit(limit);

  let cursor = 0;
  let archived = 0;
  let unavailable = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, async () => {
    while (cursor < candidates.length) {
      const post = candidates[cursor++];
      if (post.platform !== 'facebook') continue;
      const result = await archiveFacebookPost(post as FacebookPostSource);
      if (result === 'archived') archived += 1;
      else unavailable += 1;
    }
  }));

  return { attempted: candidates.length, archived, unavailable, skipped: false };
}
