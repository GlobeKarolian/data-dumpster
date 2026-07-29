'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, MailX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ROLE_DESCRIPTIONS, ROLE_LABELS, ROLE_OPTIONS, type Role } from '@/lib/roles';
import { CopyButton } from './copy-button';

export interface CreatedInviteLink {
  email: string;
  role: Role;
  acceptUrl: string;
  expiresAt: string;
}

/**
 * Creating an invitation.
 *
 * The success state is the whole point of this component. There is no email
 * provider configured for this deployment, so the link this returns is the only
 * copy that will ever exist and handing it over is a human act. The panel says
 * that in plain words rather than showing a checkmark and letting the
 * administrator assume a message went out, which is the failure mode that ends
 * with a new hire waiting three days for an email nobody sent.
 */
export function InviteForm({
  canGrantOwner,
  onCancel,
}: {
  canGrantOwner: boolean;
  onCancel: () => void;
}) {
  const router = useRouter();
  const [email, setEmail] = React.useState('');
  const [role, setRole] = React.useState<Role>('viewer');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [created, setCreated] = React.useState<CreatedInviteLink | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/settings/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), role }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string; acceptUrl?: string; email?: string; role?: Role; expiresAt?: string;
      };
      if (!res.ok || !body.acceptUrl) {
        throw new Error(body.error ?? 'The invitation could not be created.');
      }
      setCreated({
        email: body.email ?? email.trim().toLowerCase(),
        role: body.role ?? role,
        acceptUrl: body.acceptUrl,
        expiresAt: body.expiresAt ?? '',
      });
      setEmail('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The invitation could not be created.');
    } finally {
      setSaving(false);
    }
  };

  if (created) {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-accent-600/30 bg-accent-600/10 text-accent-600 dark:text-accent-500">
            <MailX className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
              Nothing was emailed. This link is the only way {created.email} gets in.
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
              Data Dumpster has no email provider configured, so no message was sent and none will be.
              Send this to them yourself. You can copy it again from the list below until it is used
              or revoked.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Input
            id="invite-accept-url"
            readOnly
            value={created.acceptUrl}
            onFocus={(e) => e.currentTarget.select()}
            className="pb-num font-mono text-[11px]"
            aria-label={'Invitation link for ' + created.email}
          />
          <CopyButton
            value={created.acceptUrl}
            selectTargetId="invite-accept-url"
            variant="primary"
            size="sm"
          />
        </div>

        <div className="flex items-center gap-2">
          <Button type="button" size="sm" onClick={() => setCreated(null)}>
            Invite someone else
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
        <Field label="Email address" htmlFor="invite-email">
          <Input
            id="invite-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="off"
            spellCheck={false}
            placeholder="colleague@bostonglobe.com"
          />
        </Field>
        <Field label="Role" htmlFor="invite-role">
          <Select
            id="invite-role"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            options={ROLE_OPTIONS.map((o) => ({
              value: o.value,
              label: o.label,
              disabled: o.value === 'owner' && !canGrantOwner,
            }))}
          />
        </Field>
      </div>

      <dl className="rounded-md border border-zinc-200 text-[11px] leading-relaxed dark:border-zinc-800">
        {ROLE_OPTIONS.map((o) => (
          <div
            key={o.value}
            className={
              'flex gap-3 border-b border-zinc-100 px-3 py-1.5 last:border-0 dark:border-zinc-800/60 ' +
              (o.value === role ? 'bg-zinc-50 dark:bg-zinc-800/40' : '')
            }
          >
            <dt
              className={
                'w-14 shrink-0 font-medium ' +
                (o.value === role
                  ? 'text-accent-600 dark:text-accent-500'
                  : 'text-zinc-700 dark:text-zinc-300')
              }
            >
              {ROLE_LABELS[o.value]}
            </dt>
            <dd className="text-zinc-500 dark:text-zinc-400">{ROLE_DESCRIPTIONS[o.value]}</dd>
          </div>
        ))}
      </dl>

      {canGrantOwner ? null : (
        <p className="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-500">
          Only an owner can grant the owner role, so that option is unavailable to you.
        </p>
      )}

      <p className="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-500">
        This creates a link that expires in seven days. Nothing is emailed; you will be shown the
        link and you deliver it yourself.
      </p>

      {error ? <p className="text-[11px] text-red-600 dark:text-red-400">{error}</p> : null}

      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={saving || !email.trim()}>
          {saving ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
          Create invitation link
        </Button>
        <Button type="button" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
