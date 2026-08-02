import type { NextRequest } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { landscapeCompanies, landscapes, posts } from '@/db/schema';
import {
  allowedInstagramRedirect,
  storedInstagramPreviewCandidates,
  type PostPreviewKind,
} from '@/lib/post-preview-source';
import { apiHandler, AuthError, HttpError, requireOrg } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const postIdSchema = z.uuid('That is not a post id.');
const kindSchema = z.enum(['poster', 'video']);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const POSTER_CONTENT_TYPES = new Set([
  'image/avif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const MAX_POSTER_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const UPSTREAM_TIMEOUT_MS = 12_000;

interface PreviewRecord {
  platform: 'instagram';
  thumbnailUrl: string | null;
  mediaUrl: string | null;
  raw: Record<string, unknown> | null;
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
    const next = allowedInstagramRedirect(current, response.headers.get('location'));
    await cancelBody(response);
    if (!next || redirects === MAX_REDIRECTS) return null;
    current = next;
  }
  return null;
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

async function visibleInstagramPost(postId: string, orgId: string): Promise<PreviewRecord | null> {
  const [row] = await db
    .select({
      platform: posts.platform,
      thumbnailUrl: posts.thumbnailUrl,
      mediaUrl: posts.mediaUrl,
      raw: posts.raw,
    })
    .from(posts)
    .innerJoin(landscapeCompanies, eq(landscapeCompanies.companyId, posts.companyId))
    .innerJoin(landscapes, eq(landscapes.id, landscapeCompanies.landscapeId))
    .where(and(
      eq(posts.id, postId),
      eq(posts.platform, 'instagram'),
      eq(landscapes.orgId, orgId),
    ))
    .limit(1);

  return row?.platform === 'instagram' ? row as PreviewRecord : null;
}

export const GET = apiHandler<{ id: string }>(async (req: NextRequest, ctx) => {
  const { orgId } = await requireOrg();
  const postId = postIdSchema.parse((await ctx.params).id);
  const kind = kindSchema.parse(req.nextUrl.searchParams.get('kind') ?? 'poster');
  const requestedRange = kind === 'video' ? singleByteRange(req.headers.get('range')) : null;
  if (requestedRange === '') {
    throw new HttpError(416, 'Only one valid byte range may be requested.', 'invalid_range');
  }

  const post = await visibleInstagramPost(postId, orgId);
  if (!post) {
    throw new AuthError('not_found', 'That post does not exist in this workspace.');
  }

  const candidates = storedInstagramPreviewCandidates(post, kind)
    .slice(0, kind === 'poster' ? 12 : 6);
  if (candidates.length === 0) {
    throw new AuthError('not_found', 'No stored preview is available for that post.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    for (const candidate of candidates) {
      const upstream = await fetchWithValidatedRedirects(
        candidate,
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
    'The stored preview could not be read from Instagram.',
    'preview_unavailable',
  );
});
