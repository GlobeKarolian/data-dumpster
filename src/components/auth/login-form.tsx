'use client';

import * as React from 'react';
import { useActionState } from 'react';
import { Loader2, LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';

export interface LoginState {
  error: string | null;
}

export function LoginForm({
  action,
  initialError,
}: {
  action: (state: LoginState, formData: FormData) => Promise<LoginState>;
  initialError: string | null;
}) {
  const [state, formAction, pending] = useActionState(action, { error: initialError });

  return (
    <form action={formAction} className="space-y-4">
      <Field label="Email" htmlFor="email" className="[&_label]:text-zinc-700!">
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          autoFocus
          required
          placeholder="you@bostonglobe.com"
          className="border-zinc-200! bg-white! text-zinc-900! placeholder:text-zinc-400! focus:border-accent-600!"
        />
      </Field>

      <Field label="Password" htmlFor="password" className="[&_label]:text-zinc-700!">
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          placeholder="••••••••••••"
          className="border-zinc-200! bg-white! text-zinc-900! placeholder:text-zinc-400! focus:border-accent-600!"
        />
      </Field>

      {state.error ? (
        <p
          role="alert"
          className="rounded-md border border-red-200! bg-red-50! px-3 py-2 text-xs leading-relaxed text-red-700!"
        >
          {state.error}
        </p>
      ) : null}

      <Button type="submit" variant="primary" className="w-full justify-center" disabled={pending}>
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          <LogIn className="h-3.5 w-3.5" aria-hidden />
        )}
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}
