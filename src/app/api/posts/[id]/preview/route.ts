import type { NextRequest } from 'next/server';
import { and, eq, or } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import {
  landscapeCompanies,
  landscapes,
  posts,
  userLandscapeAccess,
  weeklyReports,
} from '@/db/schema';
import {
  allowedInstagramRedirect,
  allowedTikTokRedirect,
  canonicalInstagramPermalink,
  instagramOgImageUrl,
  isAllowedTikTokMediaUrl,
  isAllowedTikTokPermalink,
  storedInstagramPreviewCandidates,
  storedThreadsPreviewCandidates,
  storedTikTokPosterCandidates,
  type PostPreviewKind,
} from '@/lib/post-preview-source';
import {
  persistPostThumbnail,
  readArchivedPostThumbnail,
  resolveFacebookPostThumbnail,
} from '@/lib/post-thumbnail-archive';
import { sharedReportContainsPost } from '@/lib/reports/share-preview';
import {
  apiHandler,
  AuthError,
  hasRole,
  HttpError,
  requireOrg,
  type OrgContext,
} from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const postIdSchema = z.uuid('That is not a post id.');
const kindSchema = z.enum(['poster', 'video']);
const shareTokenSchema = z.string().regex(
  /^[A-Za-z0-9_-]{21}$/,
  'That is not a valid report share token.',
);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const POSTER_CONTENT_TYPES = new Set([
  'image/avif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const MAX_POSTER_BYTES = 8 * 1024 * 1024;
const MAX_INSTAGRAM_HTML_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const UPSTREAM_TIMEOUT_MS = 12_000;

interface PreviewRecord {
  id: string;
  platform: 'facebook' | 'instagram' | 'tiktok' | 'threads';
  thumbnailUrl: string | null;
  mediaUrl: string | null;
  permalink: string | null;
  raw: Record<string, unknown> | null;
  archivedThumbnailUrl: string | null;
}

function normalizedContentType(value: string | null): string {
  return (value ?? '').split(';', 1)[0].trim().toLowerCase();
}

function singleByteRange(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim();
  const match = /^bytes=(\d*)-(\d*)$/.exec(normalized);
  if (!match || (!match[1] && !match[2])) return '';
  if (match[1] && match[2] && BigInt(match[2]) < BigInt(match[1])) return '';
  return normalized;
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The response has already ended. There is nothing left to release.
  }
}

async function fetchWithValidatedRedirects(
  source: string,
  platform: Exclude<PreviewRecord['platform'], 'facebook'>,
  kind: PostPreviewKind,
  range: string | null,
  signal: AbortSignal,
): Promise<Response | null> {
  let current = source;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    let response: Response;
    try {
      response = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        signal,
        headers: {
          accept: kind === 'poster'
            ? 'image/avif,image/webp,image/png,image/jpeg'
            : 'video/mp4',
          ...(kind === 'video' && range ? { range } : {}),
        },
      });
    } catch {
      return null;
    }

    if (!REDIRECT_STATUSES.has(response.status)) return response;
    const next = platform === 'tiktok'
      ? allowedTikTokRedirect(current, response.headers.get('location'))
      : allowedInstagramRedirect(current, response.headers.get('location'));
    await cancelBody(response);
    if (!next || redirects === MAX_REDIRECTS) return null;
    current = next;
  }
  return null;
}

async function freshTikTokPoster(
  permalink: string | null,
  signal: AbortSignal,
): Promise<string | null> {
  if (!isAllowedTikTokPermalink(permalink)) return null;

  const query = new URLSearchParams({ url: permalink });
  try {
    const response = await fetch('https://www.tiktok.com/oembed?' + query.toString(), {
      headers: { accept: 'application/json' },
      signal,
      cache: 'force-cache',
      next: { revalidate: 21_600 },
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
    const thumbnail = (body as Record<string, unknown>).thumbnail_url;
    return isAllowedTikTokMediaUrl(thumbnail) ? thumbnail : null;
  } catch {
    return null;
  }
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string | null> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await cancelBody(response);
    return null;
  }
  if (!response.body) return null;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let body = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return body;
  } catch {
    return null;
  }
}

/**
 * Instagram's stored CDN signatures expire long before historical posts leave
 * the analytics window. Resolve a fresh public poster from the canonical post
 * page; photo/carousel posts use the lightweight media redirect first, while
 * reels fall back to the page's validated Open Graph image.
 */
async function freshInstagramPoster(
  permalink: string | null,
  signal: AbortSignal,
): Promise<string | null> {
  const canonical = canonicalInstagramPermalink(permalink);
  if (!canonical) return null;

  if (new URL(canonical).pathname.startsWith('/p/')) {
    const mediaUrl = canonical + 'media/?size=l';
    try {
      const mediaResponse = await fetch(mediaUrl, {
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; DataDumpsterPreview/1.0)' },
        redirect: 'manual',
        signal,
        cache: 'force-cache',
        next: { revalidate: 21_600 },
      });
      const fresh = REDIRECT_STATUSES.has(mediaResponse.status)
        ? allowedInstagramRedirect(mediaUrl, mediaResponse.headers.get('location'))
        : null;
      await cancelBody(mediaResponse);
      if (fresh) return fresh;
    } catch {
      // Fall through to the public page metadata path.
    }
  }

  try {
    const response = await fetch(canonical, {
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; DataDumpsterPreview/1.0)',
        accept: 'text/html',
      },
      signal,
      cache: 'force-cache',
      next: { revalidate: 21_600 },
    });
    if (!response.ok || normalizedContentType(response.headers.get('content-type')) !== 'text/html') {
      await cancelBody(response);
      return null;
    }
    const html = await readBoundedText(response, MAX_INSTAGRAM_HTML_BYTES);
    return html ? instagramOgImageUrl(html) : null;
  } catch {
    return null;
  }
}

async function readPoster(response: Response): Promise<ArrayBuffer | null> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_POSTER_BYTES) {
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
      if (total > MAX_POSTER_BYTES) {
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

function copyHeader(upstream: Response, headers: Headers, name: string): void {
  const value = upstream.headers.get(name);
  if (value) headers.set(name, value);
}

function baseResponseHeaders(kind: PostPreviewKind, contentType: string): Headers {
  return new Headers({
    'cache-control': kind === 'poster'
      ? 'private, max-age=21600, stale-while-revalidate=86400'
      : 'private, max-age=3600',
    'content-type': contentType,
    'cross-origin-resource-policy': 'same-origin',
    'x-content-type-options': 'nosniff',
  });
}

async function visiblePreviewPost(postId: string, ctx: OrgContext): Promise<PreviewRecord | null> {
  const [row] = await db
    .select({
      id: posts.id,
      platform: posts.platform,
      thumbnailUrl: posts.thumbnailUrl,
      mediaUrl: posts.mediaUrl,
      permalink: posts.permalink,
      raw: posts.raw,
      archivedThumbnailUrl: posts.archivedThumbnailUrl,
    })
    .from(posts)
    .innerJoin(landscapeCompanies, eq(landscapeCompanies.companyId, posts.companyId))
    .innerJoin(landscapes, eq(landscapes.id, landscapeCompanies.landscapeId))
    .leftJoin(
      userLandscapeAccess,
      and(
        eq(userLandscapeAccess.landscapeId, landscapes.id),
        eq(userLandscapeAccess.userId, ctx.userId),
      ),
    )
    .where(and(
      eq(posts.id, postId),
      or(
        eq(posts.platform, 'facebook'),
        eq(posts.platform, 'instagram'),
        eq(posts.platform, 'tiktok'),
        eq(posts.platform, 'threads'),
      ),
      eq(landscapes.orgId, ctx.orgId),
      hasRole(ctx.role, 'admin')
        ? eq(landscapes.orgId, ctx.orgId)
        : eq(userLandscapeAccess.userId, ctx.userId),
    ))
    .limit(1);

  return row?.platform === 'facebook'
    || row?.platform === 'instagram'
    || row?.platform === 'tiktok'
    || row?.platform === 'threads'
    ? row as PreviewRecord
    : null;
}

async function sharedPreviewPost(postId: string, shareToken: string): Promise<PreviewRecord | null> {
  const [report] = await db
    .select({ computed: weeklyReports.computed })
    .from(weeklyReports)
    .where(eq(weeklyReports.shareToken, shareToken))
    .limit(1);

  if (!report || !sharedReportContainsPost(report.computed, postId)) return null;

  const [row] = await db
    .select({
      id: posts.id,
      platform: posts.platform,
      thumbnailUrl: posts.thumbnailUrl,
      mediaUrl: posts.mediaUrl,
      permalink: posts.permalink,
      raw: posts.raw,
      archivedThumbnailUrl: posts.archivedThumbnailUrl,
    })
    .from(posts)
    .where(and(
      eq(posts.id, postId),
      or(
        eq(posts.platform, 'facebook'),
        eq(posts.platform, 'instagram'),
        eq(posts.platform, 'tiktok'),
        eq(posts.platform, 'threads'),
      ),
    ))
    .limit(1);

  return row?.platform === 'facebook'
    || row?.platform === 'instagram'
    || row?.platform === 'tiktok'
    || row?.platform === 'threads'
    ? row as PreviewRecord
    : null;
}

export const GET = apiHandler<{ id: string }>(async (req: NextRequest, ctx) => {
  const postId = postIdSchema.parse((await ctx.params).id);
  const kind = kindSchema.parse(req.nextUrl.searchParams.get('kind') ?? 'poster');
  const rawShareToken = req.nextUrl.searchParams.get('share');
  const requestedRange = kind === 'video' ? singleByteRange(req.headers.get('range')) : null;
  if (requestedRange === '') {
    throw new HttpError(416, 'Only one valid byte range may be requested.', 'invalid_range');
  }

  const post = rawShareToken
    ? await sharedPreviewPost(postId, shareTokenSchema.parse(rawShareToken))
    : await visiblePreviewPost(postId, await requireOrg());
  if (!post) {
    throw new AuthError('not_found', 'That post does not exist in this workspace.');
  }

  if (kind === 'poster' && post.archivedThumbnailUrl) {
    const archived = await readArchivedPostThumbnail(post.archivedThumbnailUrl);
    if (archived) {
      const headers = baseResponseHeaders(kind, archived.contentType);
      headers.set('content-length', String(archived.contentLength));
      headers.set('etag', archived.etag);
      headers.set('x-data-dumpster-media', 'archived');
      return new Response(archived.stream, { status: 200, headers });
    }
  }

  if (kind === 'video' && (post.platform === 'facebook' || post.platform === 'tiktok')) {
    throw new AuthError('not_found', 'No proxied video preview is available for that post.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    if (post.platform === 'facebook') {
      const resolved = await resolveFacebookPostThumbnail(post, controller.signal);
      if (!resolved) {
        throw new HttpError(
          502,
          'The public preview could not be recovered from Facebook.',
          'preview_unavailable',
        );
      }
      try {
        await persistPostThumbnail(post.id, resolved);
      } catch (error) {
        // The recovered image is still useful for this request. Storage errors
        // remain visible in logs and the background archive sweep will retry.
        console.error('[data-dumpster:post-preview] thumbnail archive failed', {
          postId: post.id,
          platform: post.platform,
          error: error instanceof Error ? error.message : 'Unknown archive failure.',
        });
      }
      const headers = baseResponseHeaders(kind, resolved.contentType);
      headers.set('content-length', String(resolved.body.byteLength));
      headers.set('x-data-dumpster-media', 'recovered');
      return new Response(resolved.body, { status: 200, headers });
    }

    const candidates = post.platform === 'instagram'
      ? [
          kind === 'poster' ? await freshInstagramPoster(post.permalink, controller.signal) : null,
          ...storedInstagramPreviewCandidates(post, kind).slice(0, kind === 'poster' ? 12 : 6),
        ].filter((candidate): candidate is string => Boolean(candidate))
      : post.platform === 'threads'
        ? storedThreadsPreviewCandidates(post, kind).slice(0, kind === 'poster' ? 12 : 6)
        : [
          await freshTikTokPoster(post.permalink, controller.signal),
          ...storedTikTokPosterCandidates(post),
        ].filter((candidate): candidate is string => Boolean(candidate));
    if (candidates.length === 0) {
      throw new AuthError('not_found', 'No public preview is available for that post.');
    }

    for (const candidate of candidates) {
      const upstream = await fetchWithValidatedRedirects(
        candidate,
        post.platform,
        kind,
        requestedRange,
        controller.signal,
      );
      if (!upstream) continue;

      if (kind === 'poster') {
        const contentType = normalizedContentType(upstream.headers.get('content-type'));
        if (!upstream.ok || !POSTER_CONTENT_TYPES.has(contentType)) {
          await cancelBody(upstream);
          continue;
        }
        const body = await readPoster(upstream);
        if (!body) continue;

        try {
          await persistPostThumbnail(post.id, { body, contentType });
        } catch (error) {
          console.error('[data-dumpster:post-preview] thumbnail archive failed', {
            postId: post.id,
            platform: post.platform,
            error: error instanceof Error ? error.message : 'Unknown archive failure.',
          });
        }

        const headers = baseResponseHeaders(kind, contentType);
        headers.set('content-length', String(body.byteLength));
        copyHeader(upstream, headers, 'etag');
        copyHeader(upstream, headers, 'last-modified');
        return new Response(body, { status: 200, headers });
      }

      const contentType = normalizedContentType(upstream.headers.get('content-type'));
      if (upstream.status === 416) {
        const headers = baseResponseHeaders(kind, 'video/mp4');
        copyHeader(upstream, headers, 'content-range');
        return new Response(null, { status: 416, headers });
      }
      if (
        (upstream.status !== 200 && upstream.status !== 206)
        || contentType !== 'video/mp4'
        || !upstream.body
      ) {
        await cancelBody(upstream);
        continue;
      }

      const headers = baseResponseHeaders(kind, contentType);
      headers.set('accept-ranges', upstream.headers.get('accept-ranges') ?? 'bytes');
      for (const name of ['content-length', 'content-range', 'etag', 'last-modified']) {
        copyHeader(upstream, headers, name);
      }
      return new Response(upstream.body, { status: upstream.status, headers });
    }
  } finally {
    clearTimeout(timeout);
  }

  throw new HttpError(
    502,
    'The public preview could not be read from '
      + ({ instagram: 'Instagram', tiktok: 'TikTok', threads: 'Threads' } as const)[post.platform]
      + '.',
    'preview_unavailable',
  );
});
