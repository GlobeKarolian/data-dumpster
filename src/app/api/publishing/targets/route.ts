/** GET: publishing accounts. POST: add one (admins). Secrets are write-only. */
import type { NextRequest } from 'next/server';
import { apiHandler } from '@/lib/session';
import { encryptJson } from '@/lib/crypto';
import { requirePublishingApprover, requirePublishingUser } from '@/lib/publishing/guard';
import { insertTarget, listTargets } from '@/lib/publishing/store';
import { NO_STORE, targetSchema } from '../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = apiHandler(async () => {
  const s = await requirePublishingUser();
  return Response.json({ targets: await listTargets(s.orgId) }, NO_STORE);
});

export const POST = apiHandler(async (req: NextRequest) => {
  const s = await requirePublishingApprover();
  const t = targetSchema.parse(await req.json());
  const id = await insertTarget(s.orgId, { ...t, secretEnc: t.secret ? encryptJson(t.secret) : null });
  return Response.json({ id }, { status: 201, ...NO_STORE });
});
