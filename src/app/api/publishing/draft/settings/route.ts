/**
 * GET: the drafting model and prompts (defaults filled in) and which model
 * connection drafting will use. PUT: admins change them. Blank means default.
 */
import type { NextRequest } from 'next/server';
import { apiHandler } from '@/lib/session';
import { requirePublishingApprover, requirePublishingUser } from '@/lib/publishing/guard';
import { draftConnectionStatus, draftSettingsSchema, getDraftSettings, saveDraftSettings } from '@/lib/publishing/drafting';
import { NO_STORE } from '../../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = apiHandler(async () => {
  const s = await requirePublishingUser();
  const [settings, connection] = await Promise.all([getDraftSettings(s.orgId), draftConnectionStatus(s.orgId)]);
  return Response.json({ ...settings, connection }, NO_STORE);
});

export const PUT = apiHandler(async (req: NextRequest) => {
  const s = await requirePublishingApprover();
  const input = draftSettingsSchema.parse(await req.json());
  const [settings, connection] = await Promise.all([saveDraftSettings(s.orgId, input, s.email), draftConnectionStatus(s.orgId)]);
  return Response.json({ ...settings, connection }, NO_STORE);
});
