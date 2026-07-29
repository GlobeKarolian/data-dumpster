/**
 * /api/content -- the content analysis behind the Social Posts screen.
 */
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { apiHandler, requireOrg, AuthError } from '@/lib/session';
import { db } from '@/db';
import { landscapes } from '@/db/schema';
import { PLATFORMS } from '@/lib/types';
import { parseRangeParams } from '@/lib/dates';
import { getContentAnalysis } from '@/lib/metrics/content-analysis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const schema = z.object({
  landscapeId: z.uuid(),
  platforms: z.array(z.enum(PLATFORMS)).optional(),
});

export const GET = apiHandler(async (req) => {
  const { orgId } = await requireOrg();
  const sp = req.nextUrl.searchParams;
  const parsed = schema.parse({
    landscapeId: sp.get('landscapeId') ?? undefined,
    platforms: sp.getAll('platforms').length ? sp.getAll('platforms') : undefined,
  });

  const [owned] = await db.select({ id: landscapes.id }).from(landscapes)
    .where(and(eq(landscapes.id, parsed.landscapeId), eq(landscapes.orgId, orgId)));
  if (!owned) throw new AuthError('not_found', 'That landscape does not exist.');

  const range = parseRangeParams(sp, 28);
  return Response.json(await getContentAnalysis({
    landscapeId: parsed.landscapeId,
    orgId,
    start: range.start,
    end: range.end,
    platforms: parsed.platforms,
  }));
});
