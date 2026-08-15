import { z } from 'zod';
import { assertElectionRaceAccessible } from '@/lib/elections/access';
import { connectPendingElectionSources } from '@/lib/elections/source-connection';
import { apiHandler, requireRole } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const idSchema = z.uuid('That is not a race id.');

export const POST = apiHandler<{ id: string }>(async (_req, ctx) => {
  const session = await requireRole('editor');
  const raceId = idSchema.parse((await ctx.params).id);
  await assertElectionRaceAccessible(raceId, session);
  const result = await connectPendingElectionSources({
    raceId,
    limit: 100,
    concurrency: 5,
  });
  return Response.json(result, { headers: { 'cache-control': 'no-store' } });
});
