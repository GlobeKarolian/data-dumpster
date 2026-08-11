import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { roleEnum } from '@/db/schema';
import { decideAccessRequest } from '@/lib/access-requests';
import { absoluteOrigin } from '@/lib/origin';
import { apiHandler, AuthError, HttpError, requireRole } from '@/lib/session';
import { readJson } from '@/app/api/_lib/query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const idSchema = z.uuid('That is not an access-request id.');
const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve'), role: z.enum(roleEnum.enumValues).default('viewer') }),
  z.object({ action: z.literal('decline') }),
]);

export const POST = apiHandler<{ id: string }>(async (req: NextRequest, ctx) => {
  const actor = await requireRole('admin');
  const id = idSchema.parse((await ctx.params).id);
  const body = await readJson(req, bodySchema);
  if (body.action === 'approve' && body.role === 'owner' && actor.role !== 'owner') {
    throw new AuthError('forbidden', 'Only an owner can approve another owner.');
  }

  const result = await decideAccessRequest({
    id,
    orgId: actor.orgId,
    reviewerId: actor.userId,
    action: body.action,
    role: body.action === 'approve' ? body.role : undefined,
    origin: absoluteOrigin(req),
  });

  if (result.status === 'not_found') {
    throw new AuthError('not_found', 'That access request does not exist.');
  }
  if (result.status === 'already_decided') {
    throw new HttpError(409, 'That request has already been reviewed.', 'request_already_decided');
  }
  if (result.status === 'user_exists') {
    throw new HttpError(409, 'That email address already has an account.', 'user_exists');
  }

  return Response.json(result, { headers: { 'cache-control': 'private, no-store' } });
});
