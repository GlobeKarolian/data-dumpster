/**
 * GET: brands that have connected accounts through Ayrshare, and whether the
 * Ayrshare key is configured. POST {brand}: start connecting a brand; returns
 * Ayrshare's sign-in page URL (valid 30 minutes). Admins only.
 */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { apiHandler, HttpError } from '@/lib/session';
import { requirePublishingApprover, requirePublishingUser } from '@/lib/publishing/guard';
import { listBrandConnections, startConnect } from '@/lib/publishing/connect';
import { AyrshareSetupError } from '@/lib/publishing/providers/ayrshare-profiles';
import { NO_STORE } from '../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = apiHandler(async () => {
  const s = await requirePublishingUser();
  return Response.json({
    configured: Boolean(process.env.AYRSHARE_API_KEY),
    xConfigured: Boolean(process.env.AYRSHARE_X_API_KEY && process.env.AYRSHARE_X_API_SECRET),
    brands: await listBrandConnections(s.orgId),
  }, NO_STORE);
});

export const POST = apiHandler(async (req: NextRequest) => {
  const s = await requirePublishingApprover();
  const { brand } = z.object({ brand: z.string().trim().min(1).max(80) }).parse(await req.json());
  const returnTo = new URL(`/publish/accounts?connected=${encodeURIComponent(brand)}`, req.nextUrl.origin).toString();
  try {
    return Response.json({ url: await startConnect(s.orgId, brand, returnTo) }, NO_STORE);
  } catch (e) {
    if (e instanceof AyrshareSetupError) throw new HttpError(400, e.message, 'setup_required');
    throw e;
  }
});
