/**
 * POST: dry run of a composed post. Returns, per account, the exact text, the
 * tagged link, problems and the slot the scheduler would pick. Writes nothing.
 */
import type { NextRequest } from 'next/server';
import { apiHandler } from '@/lib/session';
import { requirePublishingUser } from '@/lib/publishing/guard';
import { composeSchema, planDeliveries } from '@/lib/publishing/service';
import { fetchLinkPreview } from '@/lib/publishing/preview';
import { NO_STORE } from '../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = apiHandler(async (req: NextRequest) => {
  const s = await requirePublishingUser();
  const body = await req.json();
  const input = composeSchema.parse(body);
  const [plans, card] = await Promise.all([
    planDeliveries(s.orgId, input, 'preview'),
    body.withCard && input.linkUrl ? fetchLinkPreview(input.linkUrl) : Promise.resolve(null),
  ]);
  return Response.json({ plans, card }, NO_STORE);
});
