'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, Trash2, UserPlus } from 'lucide-react';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { DataTable, type Column } from '@/components/ui/table';
import { formatFullDate, formatRelative } from '@/components/ui/format';
import { ROLE_LABELS, type Role } from '@/lib/roles';
import { InviteForm } from './invite-form';
import { CopyButton } from './copy-button';

export interface InviteRecord {
  id: string;
  email: string;
  role: Role;
  invitedByName: string | null;
  invitedByEmail: string | null;
  expiresAt: string;
  createdAt: string;
  expired: boolean;
  /** The link. Present so a lost one can be copied again rather than reissued. */
  acceptUrl: string;
}

/**
 * Outstanding invitations.
 *
 * The link is copyable from every row on purpose. An invitation that was sent
 * in Slack and then scrolled away is the most likely thing to go wrong with
 * this flow, and revoke-and-reissue is a worse answer than copy-again for
 * something that is already time-limited and single-use.
 */
export function PendingInvites({
  invites,
  canManage,
  canGrantOwner,
}: {
  invites: InviteRecord[];
  canManage: boolean;
  canGrantOwner: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [confirmId, setConfirmId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const revoke = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch('/api/settings/users/invites/' + id, { method: 'DELETE' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'The invitation could not be revoked.');
      }
      setConfirmId(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The invitation could not be revoked.');
    } finally {
      setBusyId(null);
    }
  };

  const columns: Column<InviteRecord>[] = [
    {
      id: 'email',
      header: 'Email',
      sortValue: (r) => r.email,
      cell: (r) => <span className="font-medium text-zinc-900 dark:text-zinc-100">{r.email}</span>,
    },
    {
      id: 'role',
      header: 'Role',
      width: 'w-24',
      sortValue: (r) => r.role,
      cell: (r) => <Badge tone="neutral">{ROLE_LABELS[r.role]}</Badge>,
    },
    {
      id: 'invitedBy',
      header: 'Invited by',
      hideBelow: 'md',
      sortValue: (r) => r.invitedByName ?? r.invitedByEmail ?? '',
      cell: (r) => (
        <span className="text-zinc-500 dark:text-zinc-400">
          {(r.invitedByName ?? r.invitedByEmail ?? 'account removed') + ' · ' + formatRelative(r.createdAt)}
        </span>
      ),
    },
    {
      id: 'expires',
      header: 'Expires',
      align: 'right',
      width: 'w-32',
      sortValue: (r) => new Date(r.expiresAt).getTime(),
      cell: (r) =>
        r.expired ? (
          <Badge tone="critical">Expired</Badge>
        ) : (
          <span className="text-zinc-500 dark:text-zinc-400" title={formatFullDate(r.expiresAt)}>
            {'in ' + Math.max(1, Math.ceil((new Date(r.expiresAt).getTime() - Date.now()) / 86400000)) + 'd'}
          </span>
        ),
    },
  ];

  if (canManage) {
    columns.push({
      id: 'actions',
      header: '',
      align: 'right',
      width: 'w-60',
      sortable: false,
      cell: (r) =>
        confirmId === r.id ? (
          <div className="flex items-center justify-end gap-1.5">
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">Kill this link?</span>
            <Button size="sm" variant="danger" disabled={busyId === r.id} onClick={() => revoke(r.id)}>
              {busyId === r.id ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
              Revoke
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmId(null)}>
              Keep
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-1">
            <CopyButton value={r.acceptUrl} size="sm" />
            <Button
              size="icon"
              variant="ghost"
              aria-label={'Revoke the invitation for ' + r.email}
              onClick={() => setConfirmId(r.id)}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </div>
        ),
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>Pending invitations</CardTitle>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            Manual fallback for adding someone directly. Each row is a live, single-use link
            that you deliver yourself.
          </p>
        </div>
        {canManage ? (
          <Button size="sm" variant="primary" onClick={() => setAdding((v) => !v)}>
            <Plus className="h-3 w-3" aria-hidden />
            Create manual invite
          </Button>
        ) : null}
      </CardHeader>

      {error ? (
        <p className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </p>
      ) : null}

      {adding && canManage ? (
        <div className="border-b border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
          <InviteForm canGrantOwner={canGrantOwner} onCancel={() => setAdding(false)} />
        </div>
      ) : null}

      {invites.length === 0 ? (
        <EmptyState
          compact
          icon={UserPlus}
          title="No invitations outstanding"
          description={
            canManage
              ? 'Use the public request page for normal onboarding, or create a manual invite when you need to initiate access yourself.'
              : 'Only an admin or an owner can see or create invitations.'
          }
        />
      ) : (
        <DataTable
          rows={invites}
          columns={columns}
          getRowKey={(r) => r.id}
          defaultSort={{ id: 'expires', direction: 'asc' }}
          caption="Pending invitations"
        />
      )}
    </Card>
  );
}
