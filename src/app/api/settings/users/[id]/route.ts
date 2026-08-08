/**
 * /api/settings/users/[id]
 *
 * PATCH  change a member's role (admin or owner).
 * DELETE remove a member (admin or owner).
 *
 * Every statement carries org_id in its WHERE clause, and a member in another
 * org answers 404 rather than 403. A 403 would confirm that a user with that id
 * exists somewhere on this instance, which is the first half of an enumeration
 * attack; a foreign id should be indistinguishable from a deleted one.
 *
 * Four rules are enforced here rather than in the UI, because a rule that lives
 * only in a form is not a rule:
 *
 *  - The last owner cannot be demoted or removed, by anyone, including
 *    themselves. An org with no owner has no one who can appoint one.
 *  - Only an owner can grant the owner role.
 *  - Only an owner can act on another owner. Without this an admin could demote
 *    the owner and then promote themselves, which is the whole ladder in two
 *    requests.
 *  - Nobody can act on a member of another org.
 *
 * One honest caveat, which the UI repeats: role lives on the JWT and is copied
 * at sign-in, so a change here takes effect the next time that person signs in.
 * See the note on the jwt callback in auth.ts.
 */
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { apiHandler, requireRole, AuthError, HttpError } from '@/lib/session';
import { db } from '@/db';
import { landscapes, roleEnum, userLandscapeAccess, users } from '@/db/schema';
import { countOwners } from '@/lib/invites';
import { readJson } from '../../../_lib/query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const idSchema = z.uuid('That is not a user id.');

const updateUserSchema = z.object({
  role: z.enum(roleEnum.enumValues),
});

interface TargetUser {
  id: string;
  email: string;
  name: string | null;
  role: (typeof roleEnum.enumValues)[number];
}

async function loadMember(id: string, orgId: string): Promise<TargetUser> {
  const [row] = await db
    .select({ id: users.id, email: users.email, name: users.name, role: users.role })
    .from(users)
    .where(and(eq(users.id, id), eq(users.orgId, orgId)))
    .limit(1);
  if (!row) throw new AuthError('not_found', 'That person is not a member of this organization.');
  return row;
}

/** Shared by PATCH and DELETE: an owner may only be touched by an owner. */
function assertMayActOnOwner(targetRole: string, actorRole: string): void {
  if (targetRole === 'owner' && actorRole !== 'owner') {
    throw new HttpError(
      403,
      'Only an owner can change or remove another owner.',
      'owner_target_forbidden',
    );
  }
}

async function assertNotLastOwner(orgId: string, verb: string): Promise<void> {
  const owners = await countOwners(orgId);
  if (owners <= 1) {
    throw new HttpError(
      409,
      'This is the only owner of this organization, so they cannot be ' + verb +
        '. Make somebody else an owner first.',
      'last_owner',
    );
  }
}

export const PATCH = apiHandler<{ id: string }>(async (req, ctx) => {
  const actor = await requireRole('admin');
  const id = idSchema.parse((await ctx.params).id);
  const body = await readJson(req, updateUserSchema);
  const target = await loadMember(id, actor.orgId);

  if (target.role === body.role) {
    return Response.json(
      { id: target.id, email: target.email, name: target.name, role: target.role, changed: false },
      { headers: { 'cache-control': 'private, no-store' } },
    );
  }

  if (body.role === 'owner' && actor.role !== 'owner') {
    throw new HttpError(403, 'Only an owner can grant the owner role.', 'owner_grant_forbidden');
  }

  assertMayActOnOwner(target.role, actor.role);

  if (target.role === 'owner') {
    await assertNotLastOwner(actor.orgId, 'demoted');
  }

  const [updated] = await db
    .update(users)
    .set({ role: body.role })
    .where(and(eq(users.id, id), eq(users.orgId, actor.orgId)))
    .returning({ id: users.id, email: users.email, name: users.name, role: users.role });

  if (!updated) throw new AuthError('not_found', 'That person is not a member of this organization.');

  // Demotion should narrow administrative power, not unexpectedly strand the
  // person on a blank screen. Start a newly restricted member with every
  // current landscape, then let the admin deliberately reduce that set.
  if (
    (target.role === 'admin' || target.role === 'owner')
    && (updated.role === 'editor' || updated.role === 'viewer')
  ) {
    const currentLandscapes = await db
      .select({ id: landscapes.id })
      .from(landscapes)
      .where(eq(landscapes.orgId, actor.orgId));
    if (currentLandscapes.length > 0) {
      await db.insert(userLandscapeAccess)
        .values(currentLandscapes.map((landscape) => ({
          userId: updated.id,
          landscapeId: landscape.id,
          grantedBy: actor.userId,
        })))
        .onConflictDoNothing();
    }
  }

  return Response.json(
    {
      id: updated.id,
      email: updated.email,
      name: updated.name,
      role: updated.role,
      changed: true,
      /** Repeated in the response so a client cannot claim it was not told. */
      effective: 'next-sign-in',
    },
    { headers: { 'cache-control': 'private, no-store' } },
  );
});

export const DELETE = apiHandler<{ id: string }>(async (_req, ctx) => {
  const actor = await requireRole('admin');
  const id = idSchema.parse((await ctx.params).id);
  const target = await loadMember(id, actor.orgId);

  assertMayActOnOwner(target.role, actor.role);

  if (target.role === 'owner') {
    await assertNotLastOwner(actor.orgId, 'removed');
  }

  const [deleted] = await db
    .delete(users)
    .where(and(eq(users.id, id), eq(users.orgId, actor.orgId)))
    .returning({ id: users.id });

  if (!deleted) throw new AuthError('not_found', 'That person is not a member of this organization.');
  return new Response(null, { status: 204 });
});
