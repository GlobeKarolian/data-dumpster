/**
 * /api/stories -- the Story Cloud.
 *
 * Clustering is CPU bound and runs across the whole window, so this is a node
 * runtime route with a generous duration rather than an edge function.
 */
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { apiHandler, requireOrg, AuthError } from '@/lib/session';
import { db } from '@/db';
import { landscapes } from '@/db/schema';
import { PLATFORMS } from '@/lib/types';
import { parseRangeParams } from '@/lib/dates';
import { getStoryCloud } from '@/lib/stories/query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const querySchema = z.object({
  landscapeId: z.uuid(),
  platforms: z.array(z.enum(PLATFORMS)).optional(),
  companyIds: z.array(z.uuid()).optional(),
  /** Lower merges more aggressively. Exposed so the UI can offer tight and loose. */
  threshold: z.coerce.number().min(0.1).max(0.9).optional(),
  minSize: z.coerce.number().int().min(1).max(20).optional(),
});

export const GET = apiHandler(async (req) => {
  const { orgId } = await requireOrg();
  const sp = req.nextUrl.searchParams;

  const parsed = querySchema.parse({
    landscapeId: sp.get('landscapeId') ?? undefined,
    platforms: sp.getAll('platforms').length ? sp.getAll('platforms') : undefined,
    companyIds: sp.getAll('companyIds').length ? sp.getAll('companyIds') : undefined,
    threshold: sp.get('threshold') ?? undefined,
    minSize: sp.get('minSize') ?? undefined,
  });

  // Tenancy guard. Resolving the landscape inside this org is what stops a
  // guessed id from reading another tenant's posts.
  const [owned] = await db.select({ id: landscapes.id }).from(landscapes)
    .where(and(eq(landscapes.id, parsed.landscapeId), eq(landscapes.orgId, orgId)));
  if (!owned) throw new AuthError('not_found', 'That landscape does not exist.');

  const range = parseRangeParams(sp, 28);

  const cloud = await getStoryCloud({
    landscapeId: parsed.landscapeId,
    start: range.start,
    end: range.end,
    platforms: parsed.platforms,
    companyIds: parsed.companyIds,
    options: { threshold: parsed.threshold, minSize: parsed.minSize },
  });

  // Posts carry raw payloads no client needs. Trim before serialising.
  return Response.json({
    ...cloud,
    clusters: cloud.clusters.map((c) => ({
      ...c,
      posts: c.posts.map((p) => ({
        id: p.id, companyId: p.companyId, companyName: p.companyName,
        platform: p.platform, postedAt: p.postedAt, text: p.text,
        permalink: p.permalink, thumbnailUrl: p.thumbnailUrl,
        engagementTotal: p.engagementTotal, views: p.views,
      })),
    })),
  });
});
