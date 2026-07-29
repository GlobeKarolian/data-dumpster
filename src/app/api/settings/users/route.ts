/**
 * /api/settings/users -- who is in the org, and who has been asked to join.
 *
 * GET  members always; pending invitations only to an admin or owner.
 * POST create an invitation and return the link (admin or owner).
 *
 * The one thing this endpoint does not do is send anything. There is no email
 * provider configured for this deployment, so POST returns the accept URL in
 * the response body and the administrator delivers it themselves. The response
 * is honest about that and the UI says so in as many words.
 *
 * Pending invitations carry their token, and therefore their working link, so
 * an admin who lost the Slack message can copy it again rather than revoking
 * and reissuing. That is exactly the privilege they already hold -- anyone who
 * can mint an invitation can mint another one -- which is why the invite list
 * is gated on admin while the member list is not.
 */
import { z } from 'zod';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { apiHandler, requireOrg, requireRole, hasRole, HttpError } from '@/lib/session';
import { db } from '@/db';
import { invites, roleEnum, users } from '@/db/schema';
import {
  createInvite, listInvites, listOrgMembers, buildInviteUrl,
  DEFAULT_INVITE_DAYS, type InviteListItem, type OrgMember,
} from '@/lib/invites';
import { absoluteOrigin } from '@/lib/origin';
import { readJson } from '../../_lib/query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Fields listed one by one rather than spread, so that a column added to the
 * users table later cannot become part of an API response by accident. That is
 * exactly how password_hash would otherwise escape one day.
 */
function presentMember(row: OrgMember, selfId: string) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    image: row.image,
    role: row.role,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
    isSelf: row.id === selfId,
  };
}

function presentInvite(row: InviteListItem, origin: string) {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    invitedByName: row.invitedByName,
    invitedByEmail: row.invitedByEmail,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    expired: row.expired,
    acceptUrl: buildInviteUrl(origin, row.token),
  };
}

export const GET = apiHandler(async (req: NextRequest) => {
  const { orgId, userId, role } = await requireOrg();
  const canManage = hasRole(role, 'admin');

  const [members, pending] = await Promise.all([
    listOrgMembers(orgId),
    canManage ? listInvites(orgId) : Promise.resolve<InviteListItem[]>([]),
  ]);

  const origin = absoluteOrigin(req);
  return Response.json(
    {
      canManage,
      users: members.map((m) => presentMember(m, userId)),
      invites: pending.map((i) => presentInvite(i, origin)),
    },
    { headers: { 'cache-control': 'private, no-store' } },
  );
});

const createInviteSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').max(320),
  role: z.enum(roleEnum.enumValues),
  expiresInDays: z.number().int().min(1).max(90).optional(),
});

export const POST = apiHandler(async (req: NextRequest) => {
  const ctx = await requireRole('admin');
  const body = await readJson(req, createInviteSchema);

  /**
   * Granting owner is the one privilege an admin does not have. Without this an
   * admin could invite themselves a second account at owner and walk straight
   * past every other check in this file.
   */
  if (body.role === 'owner' && ctx.role !== 'owner') {
    throw new HttpError(
      403,
      'Only an owner can grant the owner role. Invite them as an admin, or ask an owner to send this one.',
      'owner_grant_forbidden',
    );
  }

  /**
   * Email is unique across the whole instance, not per org, so an address that
   * already has an account anywhere cannot be invited: the accept would fail on
   * the unique index at the worst possible moment, in front of the new hire.
   * The message deliberately does not say which org the account is in.
   */
  const [existing] = await db
    .select({ id: users.id, orgId: users.orgId })
    .from(users)
    .where(eq(users.email, body.email))
    .limit(1);

  if (existing) {
    throw new HttpError(
      409,
      existing.orgId === ctx.orgId
        ? 'That address is already a member of this organization. Change their role instead.'
        : 'That address already has an account on this instance. Accounts are unique by email.',
      'user_exists',
    );
  }

  const [pending] = await db
    .select({ id: invites.id })
    .from(invites)
    .where(and(
      eq(invites.orgId, ctx.orgId),
      eq(invites.email, body.email),
      isNull(invites.acceptedAt),
      gt(invites.expiresAt, new Date()),
    ))
    .limit(1);

  if (pending) {
    throw new HttpError(
      409,
      'There is already a live invitation for that address. Copy its link, or revoke it and send a new one.',
      'invite_exists',
    );
  }

  const invite = await createInvite({
    orgId: ctx.orgId,
    email: body.email,
    role: body.role,
    invitedByUserId: ctx.userId,
    expiresInDays: body.expiresInDays ?? DEFAULT_INVITE_DAYS,
  });

  return Response.json(
    {
      id: invite.id,
      email: invite.email,
      role: invite.role,
      expiresAt: invite.expiresAt,
      createdAt: invite.createdAt,
      acceptUrl: buildInviteUrl(absoluteOrigin(req), invite.token),
      /** Stated in the payload so no client can assume otherwise. */
      delivery: 'none',
    },
    { status: 201, headers: { 'cache-control': 'private, no-store' } },
  );
});
