/** PUT: replace an account's settings, posting rules and UTM template (admins). */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { apiHandler, HttpError } from '@/lib/session';
import { encryptJson } from '@/lib/crypto';
import { requirePublishingApprover } from '@/lib/publishing/guard';
import { updateTarget } from '@/lib/publishing/store';
import { NO_STORE, targetSchema } from '../../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PUT = apiHandler<{ id: string }>(async (req: NextRequest, ctx) => {
  const s = await requirePublishingApprover();
  const id = z.string().uuid().parse((await ctx.params).id);
  const t = targetSchema.parse(await req.json());
  const secretEnc = t.secret === undefined ? undefined : t.secret === null ? null : encryptJson(t.secret);
  if (!(await updateTarget(s.orgId, id, { ...t, secretEnc }))) throw new HttpError(404, 'Account not found.', 'not_found');
  return Response.json({ ok: true }, NO_STORE);
});
