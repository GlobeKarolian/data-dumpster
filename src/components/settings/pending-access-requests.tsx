'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Check, Clock3, Inbox, Loader2, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Select } from '@/components/ui/select';
import { formatRelative } from '@/components/ui/format';
import { ROLE_OPTIONS, type Role } from '@/lib/roles';
import { CopyButton } from './copy-button';

export interface AccessRequestRecord {
  id: string;
  email: string;
  name: string;
  team: string | null;
  reason: string | null;
  createdAt: string;
}

type Decision = {
  status?: 'approved' | 'declined';
  email?: string;
  acceptUrl?: string;
  delivery?: { status: 'sent' | 'not_configured' | 'failed'; error: string | null };
  error?: string;
};

export function PendingAccessRequests({
  requests,
  canManage,
  canGrantOwner,
}: {
  requests: AccessRequestRecord[];
  canManage: boolean;
  canGrantOwner: boolean;
}) {
  const router = useRouter();
  const [roles, setRoles] = React.useState<Record<string, Role>>({});
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<Decision | null>(null);

  async function decide(id: string, action: 'approve' | 'decline') {
    setBusy(id + ':' + action);
    setError(null);
    setResult(null);
    try {
      const response = await fetch('/api/settings/users/access-requests/' + id, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(action === 'approve'
          ? { action, role: roles[id] ?? 'viewer' }
          : { action }),
      });
      const body = (await response.json().catch(() => ({}))) as Decision;
      if (!response.ok) throw new Error(body.error ?? 'The request could not be reviewed.');
      setResult(body);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The request could not be reviewed.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <CardTitle>Access requests</CardTitle>
            {requests.length > 0 ? <Badge tone="critical">{requests.length} waiting</Badge> : null}
          </div>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            Approving creates a secure account-setup link. It is emailed when delivery is configured,
            and remains copyable here as a fallback.
          </p>
        </div>
      </CardHeader>

      {error ? <p className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">{error}</p> : null}
      {result ? (
        <div className="border-b border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-900">
          <p className="font-semibold">
            {result.status === 'approved' ? result.email + ' was approved.' : result.email + ' was declined.'}
          </p>
          {result.status === 'approved' && result.delivery?.status === 'sent' ? (
            <p className="mt-0.5">The secure setup link was emailed automatically.</p>
          ) : result.status === 'approved' && result.acceptUrl ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span>Email delivery was unavailable. Send this setup link directly:</span>
              <CopyButton value={result.acceptUrl} size="sm" />
            </div>
          ) : null}
        </div>
      ) : null}

      {requests.length === 0 ? (
        <EmptyState compact icon={Inbox} title="No access requests waiting" description="New requests from the public access page will appear here." />
      ) : (
        <CardBody className="space-y-3">
          {requests.map((request) => {
            const role = roles[request.id] ?? 'viewer';
            return (
              <article key={request.id} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-100">{request.name}</h3>
                      {request.team ? <Badge tone="neutral">{request.team}</Badge> : null}
                    </div>
                    <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">{request.email}</p>
                    {request.reason ? <p className="mt-3 max-w-2xl text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">{request.reason}</p> : null}
                    <p className="mt-2 flex items-center gap-1 text-[11px] text-zinc-400"><Clock3 className="h-3 w-3" aria-hidden />Requested {formatRelative(request.createdAt)}</p>
                  </div>

                  {canManage ? (
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <Select
                        size="sm"
                        aria-label={'Role for ' + request.name}
                        className="w-28"
                        value={role}
                        onChange={(event) => setRoles((current) => ({ ...current, [request.id]: event.target.value as Role }))}
                        options={ROLE_OPTIONS.map((option) => ({
                          ...option,
                          disabled: option.value === 'owner' && !canGrantOwner,
                        }))}
                      />
                      <Button size="sm" variant="primary" disabled={Boolean(busy)} onClick={() => decide(request.id, 'approve')}>
                        {busy === request.id + ':approve' ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Check className="h-3 w-3" aria-hidden />}
                        Approve
                      </Button>
                      <Button size="sm" variant="danger" disabled={Boolean(busy)} onClick={() => decide(request.id, 'decline')}>
                        {busy === request.id + ':decline' ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <X className="h-3 w-3" aria-hidden />}
                        Decline
                      </Button>
                    </div>
                  ) : null}
                </div>
              </article>
            );
          })}
        </CardBody>
      )}
    </Card>
  );
}
