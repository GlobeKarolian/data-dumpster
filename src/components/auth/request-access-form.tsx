'use client';

import * as React from 'react';
import { CheckCircle2, Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/input';

export function RequestAccessForm() {
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [submitted, setSubmitted] = React.useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/access-requests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: String(form.get('name') ?? ''),
          email: String(form.get('email') ?? ''),
          team: String(form.get('team') ?? ''),
          reason: String(form.get('reason') ?? ''),
          website: String(form.get('website') ?? ''),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? 'Your request could not be sent.');
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Your request could not be sent.');
    } finally {
      setSaving(false);
    }
  }

  if (submitted) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950">
        <CheckCircle2 className="h-7 w-7 text-emerald-600" aria-hidden />
        <h2 className="mt-4 text-lg font-semibold">Request received.</h2>
        <p className="mt-1 text-sm leading-relaxed text-emerald-800">
          An administrator has been alerted and will follow up when your request is reviewed.
          Approved requests receive a secure link to create an account.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="request-name">
          <Input id="request-name" name="name" autoComplete="name" required maxLength={120} />
        </Field>
        <Field label="Work email" htmlFor="request-email">
          <Input id="request-email" name="email" type="email" autoComplete="email" required maxLength={320} />
        </Field>
      </div>
      <Field label="Newsroom or team" htmlFor="request-team" hint="Optional">
        <Input id="request-team" name="team" autoComplete="organization" maxLength={120} placeholder="Audience, Sports, Boston.com…" />
      </Field>
      <Field label="What do you want to use Data Dumpster for?" htmlFor="request-reason" hint="Optional, but useful context for the administrator reviewing your request.">
        <Textarea id="request-reason" name="reason" maxLength={1000} rows={4} />
      </Field>

      <div className="sr-only" aria-hidden>
        <label htmlFor="request-website">Website</label>
        <input id="request-website" name="website" tabIndex={-1} autoComplete="off" />
      </div>

      {error ? (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      ) : null}

      <Button type="submit" variant="primary" className="w-full justify-center" disabled={saving}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
        {saving ? 'Sending request…' : 'Request access'}
      </Button>
    </form>
  );
}
