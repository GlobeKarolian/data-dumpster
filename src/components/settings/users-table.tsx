'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Trash2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardNote } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { DataTable, type Column } from '@/components/ui/table';
import { formatRelative } from '@/components/ui/format';
import { ROLE_LABELS, ROLE_OPTIONS, roleAtLeast, type Role } from '@/lib/roles';

export interface MemberRecord {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  createdAt: string;
  lastSeenAt: string | null;
  isSelf: boolean;
}

/**
 * Everyone with an account in this org.
 *
 * The guards below mirror the ones in the API exactly, and they are here for
 * the same reason a good form disables a button it knows will fail: to explain
 * before the request, not after. They are not the enforcement. Every rule --
 * last owner, who may grant owner, who may touch an owner -- is re-decided in
 * /api/settings/users/[id] against the database, because a check that lives in
 * a browser is a suggestion.
 */
export function UsersTable({
  members,
  viewerRole,
}: {
  members: MemberRecord[];
  viewerRole: Role;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [confirmId, setConfirmId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const canManage = roleAtLeast(viewerRole, 'admin');
  const isOwner = viewerRole === 'owner';
  const ownerCount = members.filter((m) => m.role === 'owner').length;

  /** Null when the row is editable; otherwise the reason it is not. */
  const lockedReason = (m: MemberRecord): string | null => {
    if (!canManage) return 'Only an admin or an owner can change this.';
    if (m.role === 'owner' && !isOwner) return 'Only an owner can change or remove another owner.';
    if (m.role === 'owner' && ownerCount <= 1) {
      return 'This is the only owner. Make somebody else an owner first.';
    }
    return null;
  };

  const changeRole = async (id: string, role: Role) => {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch('/api/settings/users/' + id, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'The role could not be changed.');
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The role could not be changed.');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch('/api/settings/users/' + id, { method: 'DELETE' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'That account could not be removed.');
      }
      setConfirmId(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That account could not be removed.');
    } finally {
      setBusyId(null);
    }
  };

  const columns: Column<MemberRecord>[] = [
    {
      id: 'person',
      header: 'Person',
      sortValue: (m) => (m.name ?? m.email).toLowerCase(),
      cell: (m) => (
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-medium text-zinc-900 dark:text-zinc-100">
              {m.name ?? 'No name set'}
            </span>
            {m.isSelf ? <Badge tone="outline">You</Badge> : null}
          </div>
          <p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">{m.email}</p>
        </div>
      ),
    },
    {
      id: 'role',
      header: 'Role',
      width: 'w-32',
      sortValue: (m) => ROLE_OPTIONS.findIndex((o) => o.value === m.role),
      cell: (m) => {
        const locked = lockedReason(m);
        if (locked) {
          return (
            <span title={locked} className="inline-flex">
              <Badge tone={m.role === 'owner' ? 'accent' : 'neutral'}>{ROLE_LABELS[m.role]}</Badge>
            </span>
          );
        }
        return (
          <Select
            size="sm"
            value={m.role}
            disabled={busyId === m.id}
            aria-label={'Role for ' + m.email}
            onChange={(e) => changeRole(m.id, e.target.value as Role)}
            options={ROLE_OPTIONS.map((o) => ({
              value: o.value,
              label: o.label,
              disabled: o.value === 'owner' && !isOwner,
            }))}
          />
        );
      },
    },
    {
      id: 'lastSeen',
      header: 'Last seen',
      align: 'right',
      width: 'w-28',
      hideBelow: 'sm',
      sortValue: (m) => (m.lastSeenAt ? new Date(m.lastSeenAt).getTime() : 0),
      cell: (m) => (
        <span className="text-zinc-500 dark:text-zinc-400">
          {m.lastSeenAt ? formatRelative(m.lastSeenAt) : 'not recorded'}
        </span>
      ),
    },
  ];

  if (canManage) {
    columns.push({
      id: 'actions',
      header: '',
      align: 'right',
      width: 'w-44',
      sortable: false,
      cell: (m) => {
        const locked = lockedReason(m);
        if (locked) {
          return <span className="text-[11px] text-zinc-400 dark:text-zinc-600">Locked</span>;
        }
        if (confirmId === m.id) {
          return (
            <div className="flex items-center justify-end gap-1.5">
              <span className="text-[11px] text-zinc-500 dark:text-zinc-400">Remove?</span>
              <Button size="sm" variant="danger" disabled={busyId === m.id} onClick={() => remove(m.id)}>
                {busyId === m.id ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
                Remove
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmId(null)}>
                Cancel
              </Button>
            </div>
          );
        }
        return (
          <Button
            size="icon"
            variant="ghost"
            aria-label={'Remove ' + m.email}
            onClick={() => setConfirmId(m.id)}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </Button>
        );
      },
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>People</CardTitle>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            {members.length === 1
              ? 'One account has access to this organization.'
              : members.length + ' accounts have access to this organization.'}
          </p>
        </div>
      </CardHeader>

      {error ? (
        <p className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </p>
      ) : null}

      <DataTable
        rows={members}
        columns={columns}
        getRowKey={(m) => m.id}
        defaultSort={{ id: 'role', direction: 'desc' }}
        caption="Members of this organization"
      />

      <CardNote>
        A role is copied onto the session token at sign-in, so a change here takes effect the next
        time that person signs in. Removing an account takes effect immediately.
      </CardNote>
    </Card>
  );
}
