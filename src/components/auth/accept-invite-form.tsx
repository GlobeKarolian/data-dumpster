'use client';

import * as React from 'react';
import { useActionState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';

export interface AcceptState {
  error: string | null;
}

/**
 * The only form in Data Dumpster that creates an account.
 *
 * The two client-side checks below are courtesy, not enforcement: length and
 * confirmation are both re-checked in the server action and again in
 * acceptInvite, because a check that lives in a browser is a hint. What they
 * buy is that nobody submits a form, waits, and is then told they mistyped a
 * password they can no longer see.
 */
export function AcceptInviteForm({
  action,
  email,
  minPasswordLength,
}: {
  action: (state: AcceptState, formData: FormData) => Promise<AcceptState>;
  email: string;
  minPasswordLength: number;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');

  const tooShort = password.length > 0 && password.length < minPasswordLength;
  const mismatch = confirm.length > 0 && confirm !== password;
  const ready = password.length >= minPasswordLength && confirm === password;

  return (
    <form action={formAction} className="space-y-4">
      <Field label="Email" htmlFor="invite-email" hint="Fixed by the invitation. Ask for a new one if it is wrong.">
        <Input id="invite-email" value={email} readOnly disabled autoComplete="username" />
      </Field>

      <Field label="Your name" htmlFor="name" hint="How you will appear on briefs and reports you create.">
        <Input
          id="name"
          name="name"
          type="text"
          autoComplete="name"
          autoFocus
          required
          maxLength={120}
          placeholder="Alex Reporter"
        />
      </Field>

      <Field
        label="Password"
        htmlFor="password"
        hint={'At least ' + minPasswordLength + ' characters. Length beats punctuation; a phrase is fine.'}
        error={tooShort ? minPasswordLength + ' characters minimum. You have ' + password.length + '.' : null}
      >
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={minPasswordLength}
          maxLength={512}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••••••"
        />
      </Field>

      <Field
        label="Confirm password"
        htmlFor="confirmPassword"
        error={mismatch ? 'These do not match.' : null}
      >
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          maxLength={512}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="••••••••••••"
        />
      </Field>

      {state.error ? (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400"
        >
          {state.error}
        </p>
      ) : null}

      <Button type="submit" variant="primary" className="w-full justify-center" disabled={pending || !ready}>
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          <Check className="h-3.5 w-3.5" aria-hidden />
        )}
        Create account and sign in
      </Button>
    </form>
  );
}
