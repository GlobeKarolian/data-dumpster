import type { NextRequest } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { posts, landscapeCompanies, landscapes } from '@/db/schema';
import { apiHandler, requireOrg, assertLandscapeAccessible } from '@/lib/session';
import { readArchivedPostThumbnail } from '@/lib/post-thumbnail-archive';
import { readStoredPoster } from '@/lib/v2/archive';
export const dynamic = 'force-dynamic';
/** Private archived bytes only. No vendor requests, refreshes or archive writes. */
export const GET = apiHandler<{ id: string }>(async (request: NextRequest, route) => {
  const ctx = await requireOrg();
  const id = (await route.params).id;
  const landscapeId = request.nextUrl.searchParams.get('landscape') ?? '';
  const poster = await readStoredPoster(id, landscapeId, {
    authorize: async landscape => { await assertLandscapeAccessible(landscape, ctx); },
    storedUrl: async (postId, landscape) => {
      // Asset membership lookup, not a measurement query; no raw payload leaves the server.
      const [row] = await db.select({ url: posts.archivedThumbnailUrl }).from(posts)
        .innerJoin(landscapeCompanies, eq(landscapeCompanies.companyId, posts.companyId))
        .innerJoin(landscapes, eq(landscapes.id, landscapeCompanies.landscapeId))
        .where(and(eq(posts.id, postId), eq(landscapes.id, landscape), eq(landscapes.orgId, ctx.orgId))).limit(1);
      return row?.url ?? null;
    },
    stream: readArchivedPostThumbnail,
  });
  if (!poster) return new Response(null, { status: 404, headers: { 'cache-control': 'private, no-store' } });
  return new Response(poster.stream, { headers: { 'content-type': poster.contentType, 'content-length': String(poster.contentLength), etag: poster.etag, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
});
