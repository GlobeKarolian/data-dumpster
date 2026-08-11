/**
 * /settings/users -- membership, access requests and manual invitations.
 *
 * Read server side and rendered whole, because both tables are small by nature
 * (a newsroom has dozens of accounts, not thousands) and a settings screen that
 * flashes a spinner over four rows is worse than one that arrives complete.
 *
 * The accept URL for every pending invitation is built here rather than in the
 * browser. The origin has to come from the deployment, not from location.href,
 * or an administrator opening this page through a preview URL would copy a link
 * that stops working the moment that preview is torn down.
 */
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { BellRing, KeyRound, ShieldCheck } from 'lucide-react';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { UsersTable, type MemberRecord } from '@/components/settings/users-table';
import { PendingInvites, type InviteRecord } from '@/components/settings/pending-invites';
import {
  PendingAccessRequests,
  type AccessRequestRecord,
} from '@/components/settings/pending-access-requests';
import { buildInviteUrl, listInvites, listOrgMembers, DEFAULT_INVITE_DAYS } from '@/lib/invites';
import { listPendingAccessRequests } from '@/lib/access-requests';
import { roleAtLeast } from '@/lib/roles';
import { originFromHeaders } from '@/lib/origin';
import { query, tryQuery } from '../../_lib/data';

export const metadata: Metadata = { title: 'Users and Access' };
export const dynamic = 'force-dynamic';

type LandscapeRow = { id: string; name: string };
type LandscapeGrantRow = { user_id: string; landscape_id: string };

const PILLARS = [
  {
    icon: BellRing,
    title: 'People request access themselves',
    body: 'Send people to the public request page. Admins are alerted here and by email, so you no longer need to initiate every account invitation.',
  },
  {
    icon: KeyRound,
    title: 'Approval sends secure setup',
    body: 'Approval creates a single-use account link, emails it automatically, and expires it after ' + DEFAULT_INVITE_DAYS + ' days. If email delivery is unavailable, the same link remains copyable.',
  },
  {
    icon: ShieldCheck,
    title: 'The last owner is protected',
    body: 'An organization with no owner has nobody who can appoint one, so the final owner can be neither demoted nor removed. Only an owner can grant the owner role or act on another owner.',
  },
];

export default async function UsersSettingsPage() {
  const { requireOrg } = await import('@/lib/session');
  const { orgId, userId, role } = await requireOrg();
  const canManage = roleAtLeast(role, 'admin');

  const origin = originFromHeaders(await headers());

  const [members, accessRequests, invites, landscapes, grants] = await Promise.all([
    tryQuery(() => listOrgMembers(orgId), []),
    canManage
      ? tryQuery(() => listPendingAccessRequests(orgId), [])
      : Promise.resolve({ data: [], error: null }),
    canManage ? tryQuery(() => listInvites(orgId), []) : Promise.resolve({ data: [], error: null }),
    query<LandscapeRow>(({ sql }) => sql`
      SELECT id, name
        FROM landscapes
       WHERE org_id = ${orgId}::uuid
       ORDER BY name ASC
    `),
    query<LandscapeGrantRow>(({ sql }) => sql`
      SELECT ula.user_id, ula.landscape_id
        FROM user_landscape_access ula
        JOIN users u ON u.id = ula.user_id
        JOIN landscapes l ON l.id = ula.landscape_id
       WHERE u.org_id = ${orgId}::uuid
         AND l.org_id = ${orgId}::uuid
    `),
  ]);

  const grantsByUser = new Map<string, string[]>();
  for (const grant of grants.data) {
    const ids = grantsByUser.get(grant.user_id) ?? [];
    ids.push(grant.landscape_id);
    grantsByUser.set(grant.user_id, ids);
  }

  const memberRecords: MemberRecord[] = members.data.map((m) => ({
    id: m.id,
    email: m.email,
    name: m.name,
    role: m.role,
    createdAt: m.createdAt.toISOString(),
    lastSeenAt: m.lastSeenAt ? m.lastSeenAt.toISOString() : null,
    isSelf: m.id === userId,
    landscapeIds: grantsByUser.get(m.id) ?? [],
  }));

  const inviteRecords: InviteRecord[] = invites.data.map((i) => ({
    id: i.id,
    email: i.email,
    role: i.role,
    invitedByName: i.invitedByName,
    invitedByEmail: i.invitedByEmail,
    expiresAt: i.expiresAt.toISOString(),
    createdAt: i.createdAt.toISOString(),
    expired: i.expired,
    acceptUrl: buildInviteUrl(origin, i.token),
  }));

  const accessRequestRecords: AccessRequestRecord[] = accessRequests.data.map((request) => ({
    id: request.id,
    email: request.email,
    name: request.name,
    team: request.team,
    reason: request.reason,
    createdAt: request.createdAt.toISOString(),
  }));

  const loadError = members.error ?? accessRequests.error ?? invites.error ?? landscapes.error ?? grants.error;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Card>
        <CardHeader>
          <div className="min-w-0">
            <CardTitle className="text-base">Who gets in, and how</CardTitle>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
              People can ask to join without receiving an invitation first. Nothing is opened
              until an administrator approves the request and chooses the account role.
            </p>
          </div>
        </CardHeader>
        <CardBody>
          <ul className="grid gap-4 sm:grid-cols-3">
            {PILLARS.map((p) => (
              <li key={p.title}>
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                  <p.icon className="h-3.5 w-3.5 text-accent-600" strokeWidth={1.75} aria-hidden />
                </span>
                <h3 className="mt-2 text-xs font-semibold text-zinc-900 dark:text-zinc-100">{p.title}</h3>
                <p className="mt-1 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">{p.body}</p>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      {loadError ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
          {'This screen could not be read in full: ' + loadError}
        </p>
      ) : null}

      <PendingAccessRequests
        requests={accessRequestRecords}
        canManage={canManage}
        canGrantOwner={role === 'owner'}
      />

      <UsersTable
        members={memberRecords}
        viewerRole={role}
        landscapes={landscapes.data.map((landscape) => ({
          id: landscape.id,
          name: landscape.name,
        }))}
      />

      <PendingInvites
        invites={inviteRecords}
        canManage={canManage}
        canGrantOwner={role === 'owner'}
      />
    </div>
  );
}
