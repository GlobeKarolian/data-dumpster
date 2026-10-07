/**
 * POST {landscapeIds, days, platforms?}: the Prompt Lab. Learns each network's
 * drafting instruction from the posts collected for those landscapes and returns
 * suggestions with the measurements behind them. Admins only; changes nothing.
 */
import type { NextRequest } from 'next/server';
import { apiHandler } from '@/lib/session';
import { requirePublishingApprover } from '@/lib/publishing/guard';
import { labRequestSchema, runPromptLab } from '@/lib/publishing/prompt-lab';
import { NO_STORE } from '../../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export const POST = apiHandler(async (req: NextRequest) => {
  const s = await requirePublishingApprover();
  const input = labRequestSchema.parse(await req.json());
  return Response.json({ results: await runPromptLab(s.orgId, input) }, NO_STORE);
});
