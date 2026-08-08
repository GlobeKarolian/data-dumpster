/**
 * PUT /api/settings/users/[id]/landscapes
 *
 * Replace one restricted member's complete landscape allow-list. Owners and
 * admins are intentionally universal, so this endpoint refuses to create the
 * misleading appearance that their access can be narrowed here.
 */
import { z } from 'zod';
import { and, eq, inArray } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { apiHandler, requireRole, AuthError, HttpError } from '@/lib/session';
import { db } from '@/db';
import { landscapes, userLandscapeAccess, users } from '@/db/schema';
import { roleAtLeast } from '@/lib/roles';
import { readJson } from '../../../../_lib/query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const idSchema = z.uuid('That is not a user id.');
const bodySchema = z.object({
  landscapeIds: z.array(z.uuid()).max(100),
});

export const PUT = apiHandler<{ id: string }>(async (req: NextRequest, ctx) => {
  const actor = await requireRole('admin');
  const userId = idSchema.parse((await ctx.params).id);
  const body = await readJson(req, bodySchema);
  const landscapeIds = [...new Set(body.landscapeIds)];

  const [target] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.orgId, actor.orgId)))
    .limit(1);
  if (!target) {
    throw new AuthError('not_found', 'That person is not a member of this organization.');
  }
  if (roleAtLeast(target.role, 'admin')) {
    throw new HttpError(
      409,
      'Admins and owners already have access to every landscape.',
      'universal_landscape_access',
    );
  }

  if (landscapeIds.length > 0) {
    const valid = await db
      .select({ id: landscapes.id })
      .from(landscapes)
      .where(and(
        eq(landscapes.orgId, actor.orgId),
        inArray(landscapes.id, landscapeIds),
      ));
    if (valid.length !== landscapeIds.length) {
      throw new HttpError(
        422,
        'One or more selected landscapes do not belong to this organization.',
        'unknown_landscape',
      );
    }
  }

  // Replacing the allow-list is deliberately fail-closed: if the insert ever
  // fails after deletion, the member loses access rather than gaining access
  // to data the admin did not select.
  await db.delete(userLandscapeAccess).where(eq(userLandscapeAccess.userId, target.id));
  if (landscapeIds.length > 0) {
    await db.insert(userLandscapeAccess).values(landscapeIds.map((landscapeId) => ({
      userId: target.id,
      landscapeId,
      grantedBy: actor.userId,
    })));
  }

  return Response.json(
    { userId: target.id, landscapeIds },
    { headers: { 'cache-control': 'private, no-store' } },
  );
});
