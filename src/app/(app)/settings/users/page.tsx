/**
 * /settings/users -- membership and invitations.
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
import { KeyRound, Link2, ShieldCheck } from 'lucide-react';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { UsersTable, type MemberRecord } from '@/components/settings/users-table';
import { PendingInvites, type InviteRecord } from '@/components/settings/pending-invites';
import { buildInviteUrl, listInvites, listOrgMembers, DEFAULT_INVITE_DAYS } from '@/lib/invites';
import { roleAtLeast } from '@/lib/roles';
import { originFromHeaders } from '@/lib/origin';
import { tryQuery } from '../../_lib/data';

export const metadata: Metadata = { title: 'Users and Invitations' };
export const dynamic = 'force-dynamic';

const PILLARS = [
  {
    icon: Link2,
    title: 'An invitation is a link, not an email',
    body: 'No email provider is configured for this deployment and no budget decision has been made about one. Creating an invitation produces a URL and shows it to you once. Delivering it is your job: Slack, a message, a desk.',
  },
  {
    icon: KeyRound,
    title: 'The link is the whole credential',
    body: 'It carries 256 bits of randomness, expires after ' + DEFAULT_INVITE_DAYS + ' days, and works exactly once. Treat it like a password: send it in a private channel, and revoke it here if it goes somewhere it should not.',
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

  const [members, invites] = await Promise.all([
    tryQuery(() => listOrgMembers(orgId), []),
    canManage ? tryQuery(() => listInvites(orgId), []) : Promise.resolve({ data: [], error: null }),
  ]);

  const memberRecords: MemberRecord[] = members.data.map((m) => ({
    id: m.id,
    email: m.email,
    name: m.name,
    role: m.role,
    createdAt: m.createdAt.toISOString(),
    lastSeenAt: m.lastSeenAt ? m.lastSeenAt.toISOString() : null,
    isSelf: m.id === userId,
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

  const loadError = members.error ?? invites.error;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Card>
        <CardHeader>
          <div className="min-w-0">
            <CardTitle className="text-base">Who gets in, and how</CardTitle>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
              Data Dumpster holds a full competitive picture of the newsroom, so there is no
              self-service sign-up. Every account starts as an invitation from someone already
              inside, and the invitation is a link you hand over yourself.
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

      <UsersTable members={memberRecords} viewerRole={role} />

      <PendingInvites
        invites={inviteRecords}
        canManage={canManage}
        canGrantOwner={role === 'owner'}
      />
    </div>
  );
}
