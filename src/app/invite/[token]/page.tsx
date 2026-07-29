/**
 * /invite/[token] -- the only door into Data Dumpster that is not the sign-in form.
 *
 * Public by design: the person holding this link has no account yet, so there
 * is nothing to authenticate. The token in the path is the authorization, which
 * is why it is 256 bits of randomness and why it expires. /invite is listed in
 * the middleware public prefixes for the same reason /login is.
 *
 * The four outcomes are four screens, not one. "This link is invalid" is the
 * kind of message that turns a thirty-second fix into a support thread: an
 * expired invitation needs a new one, a spent invitation needs the sign-in page,
 * and an unrecognized one usually means a chat client mangled the URL. Each
 * says so, and each says what to do next.
 *
 * Nothing on this page mentions email. Nothing was emailed.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthError } from 'next-auth';
import { Clock, CircleCheck, CircleSlash } from 'lucide-react';
import { signIn } from '@/auth';
import { acceptInvite, lookupInvite, MIN_PASSWORD_LENGTH } from '@/lib/invites';
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '@/lib/roles';
import { DumpsterLogo } from '@/components/shell/logo';
import { AcceptInviteForm, type AcceptState } from '@/components/auth/accept-invite-form';
import { formatFullDate } from '@/components/ui/format';

export const metadata: Metadata = { title: 'Accept invitation' };
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Shared chrome. Deliberately narrower and quieter than the sign-in screen. */
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col justify-center px-6 py-12">
      <div className="mx-auto w-full max-w-sm">
        <DumpsterLogo className="mb-8" />
        {children}
      </div>
    </div>
  );
}

function Notice({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <span className="mb-3 inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-600">
        <Icon className="h-4 w-4" strokeWidth={1.75} />
      </span>
      <h1 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{title}</h1>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
        {children}
      </div>
    </div>
  );
}

function SignInLink({ label = 'Go to sign in' }: { label?: string }) {
  return (
    <Link
      href="/login"
      className="mt-5 inline-flex h-8 items-center rounded-md border border-zinc-200 px-3 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800"
    >
      {label}
    </Link>
  );
}

const ACCEPT_FAILURE: Record<string, string> = {
  unknown: 'This invitation no longer exists. Ask whoever sent it for a new link.',
  expired: 'This invitation expired while you were filling in the form. Ask for a new link.',
  accepted: 'This invitation has already been used. If that was you, sign in instead.',
  email_taken: 'An account already exists for that address. Sign in with it, or ask an administrator to remove it first.',
  weak_password: 'Choose a password of at least ' + MIN_PASSWORD_LENGTH + ' characters.',
};

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await lookupInvite(token);

  if (found.status === 'unknown') {
    return (
      <Frame>
        <Notice icon={CircleSlash} title="We do not recognize this link">
          <p>
            No invitation matches it. The most common cause is a link that lost some characters on
            the way here, so check that you copied the whole thing.
          </p>
          <p>Otherwise, ask whoever invited you to send a fresh one.</p>
        </Notice>
        <SignInLink label="I already have an account" />
      </Frame>
    );
  }

  const invite = found.invite;
  const inviter = invite.invitedByName ?? invite.invitedByEmail;

  if (found.status === 'accepted') {
    return (
      <Frame>
        <Notice icon={CircleCheck} title="This invitation has already been used">
          <p>
            An account for {invite.email} was created on {formatFullDate(invite.acceptedAt)}. An
            invitation only works once.
          </p>
          <p>If that was you, sign in. If it was not, tell {inviter ?? 'an administrator'} today.</p>
        </Notice>
        <SignInLink />
      </Frame>
    );
  }

  if (found.status === 'expired') {
    return (
      <Frame>
        <Notice icon={Clock} title="This invitation has expired">
          <p>
            It was valid until {formatFullDate(invite.expiresAt)} and is no longer accepted.
            Invitations expire because the link is the whole credential.
          </p>
          <p>
            Ask {inviter ?? 'an administrator'} to send a new one. It takes them about ten seconds.
          </p>
        </Notice>
        <SignInLink label="I already have an account" />
      </Frame>
    );
  }

  async function accept(_state: AcceptState, formData: FormData): Promise<AcceptState> {
    'use server';
    const name = String(formData.get('name') ?? '').trim();
    const password = String(formData.get('password') ?? '');
    const confirm = String(formData.get('confirmPassword') ?? '');

    if (!name) return { error: 'Enter your name.' };
    if (name.length > 120) return { error: 'That name is longer than 120 characters.' };
    if (password.length < MIN_PASSWORD_LENGTH) {
      return { error: 'Choose a password of at least ' + MIN_PASSWORD_LENGTH + ' characters.' };
    }
    if (password !== confirm) return { error: 'The two passwords do not match.' };

    const result = await acceptInvite({ token, name, password });
    if (!result.ok) {
      return { error: ACCEPT_FAILURE[result.reason] ?? 'That invitation could not be accepted.' };
    }

    try {
      // Credentials are posted to Auth.js, never appended to a URL.
      await signIn('credentials', { email: result.user.email, password, redirectTo: '/cross-channel' });
      return { error: null };
    } catch (error) {
      if (error instanceof AuthError) {
        return {
          error:
            'Your account was created, but signing you in failed. Go to the sign-in page and use ' +
            'the password you just chose.',
        };
      }
      // A successful signIn throws a redirect, which must be allowed through.
      throw error;
    }
  }

  return (
    <Frame>
      <h1 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Join {invite.orgName}
      </h1>
      <p className="mt-1 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
        {(inviter ? inviter + ' invited you' : 'You were invited') + ' to Data Dumpster as a ' +
          ROLE_LABELS[invite.role].toLowerCase() + '.'}
      </p>

      <dl className="mt-5 divide-y divide-zinc-100 rounded-md border border-zinc-200 text-xs dark:divide-zinc-800/60 dark:border-zinc-800">
        <div className="flex items-baseline justify-between gap-4 px-3 py-2">
          <dt className="text-zinc-500 dark:text-zinc-400">Organization</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-100">{invite.orgName}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4 px-3 py-2">
          <dt className="text-zinc-500 dark:text-zinc-400">Role</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-100">{ROLE_LABELS[invite.role]}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4 px-3 py-2">
          <dt className="text-zinc-500 dark:text-zinc-400">Link valid until</dt>
          <dd className="pb-num font-medium text-zinc-900 dark:text-zinc-100">
            {formatFullDate(invite.expiresAt)}
          </dd>
        </div>
      </dl>

      <p className="mt-2 mb-6 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-500">
        {ROLE_DESCRIPTIONS[invite.role]}
      </p>

      <AcceptInviteForm action={accept} email={invite.email} minPasswordLength={MIN_PASSWORD_LENGTH} />

      <p className="mt-6 text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-600">
        Data Dumpster carries a full competitive picture of the newsroom, so accounts are created only
        from an invitation. There is no self-service sign-up and no password reset by email.
      </p>
    </Frame>
  );
}
