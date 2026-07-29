/**
 * /api/settings/users/invites/[id]
 *
 * DELETE revoke a pending invitation (admin or owner).
 *
 * Revoking is a real deletion, and it is immediate: the link stops working the
 * moment this returns, which is the point. An invitation that has already been
 * accepted is refused rather than deleted, because that row is the record of
 * how somebody got in and the account it created still exists. Removing the
 * person is what DELETE /api/settings/users/[id] is for, and saying so is more
 * useful than silently doing nothing.
 *
 * Scoped by org like everything else, and a foreign id answers 404 so it cannot
 * be distinguished from one that never existed.
 */
import { z } from 'zod';
import { apiHandler, requireRole, AuthError, HttpError } from '@/lib/session';
import { revokeInvite } from '@/lib/invites';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const idSchema = z.uuid('That is not an invitation id.');

export const DELETE = apiHandler<{ id: string }>(async (_req, ctx) => {
  const { orgId } = await requireRole('admin');
  const id = idSchema.parse((await ctx.params).id);

  const result = await revokeInvite(id, orgId);

  if (result === 'not_found') {
    throw new AuthError('not_found', 'That invitation does not exist.');
  }
  if (result === 'already_accepted') {
    throw new HttpError(
      409,
      'That invitation has already been accepted, so revoking it would do nothing. Remove the account instead.',
      'invite_accepted',
    );
  }

  return new Response(null, { status: 204 });
});
