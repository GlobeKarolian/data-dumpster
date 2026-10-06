/**
 * GET: is publishing paused for this org. PUT {paused}: pause or resume.
 * Anyone with publishing access can pause (it is a brake); only admins resume.
 */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { apiHandler, HttpError } from '@/lib/session';
import { requirePublishingUser } from '@/lib/publishing/guard';
import { getPause } from '@/lib/publishing/store';
import { setPaused } from '@/lib/publishing/service';
import { NO_STORE } from '../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = apiHandler(async () => {
  const s = await requirePublishingUser();
  return Response.json(await getPause(s.orgId), NO_STORE);
});

export const PUT = apiHandler(async (req: NextRequest) => {
  const s = await requirePublishingUser();
  const { paused } = z.object({ paused: z.boolean() }).parse(await req.json());
  if (!paused && !s.canApprove) throw new HttpError(403, 'Only admins can resume publishing.', 'forbidden');
  const result = await setPaused(s.orgId, paused, s.email);
  return Response.json({ ...(await getPause(s.orgId)), ...result }, NO_STORE);
});
