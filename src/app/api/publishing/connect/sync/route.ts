/** POST {brand}: read what the brand linked on Ayrshare and create or update its accounts. Admins only. */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { apiHandler, HttpError } from '@/lib/session';
import { requirePublishingApprover } from '@/lib/publishing/guard';
import { syncBrand } from '@/lib/publishing/connect';
import { AyrshareSetupError } from '@/lib/publishing/providers/ayrshare-profiles';
import { NO_STORE } from '../../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = apiHandler(async (req: NextRequest) => {
  const s = await requirePublishingApprover();
  const { brand } = z.object({ brand: z.string().trim().min(1).max(80) }).parse(await req.json());
  try {
    return Response.json(await syncBrand(s.orgId, brand), NO_STORE);
  } catch (e) {
    if (e instanceof AyrshareSetupError) throw new HttpError(400, e.message, 'setup_required');
    throw e;
  }
});
