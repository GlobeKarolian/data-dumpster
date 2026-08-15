'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  DollarSign,
  Flag,
  Gauge,
  Landmark,
  Plus,
  Radio,
  Vote,
  X,
} from 'lucide-react';
import type { ElectionRaceSummary } from '@/lib/elections/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';

function apiMessage(body: unknown): string {
  return typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
    ? body.error
    : 'The race could not be created.';
}

function formatElectionDate(date: string | null): string {
  if (!date) return 'Date not set';
  return new Intl.DateTimeFormat('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(date + 'T12:00:00Z'));
}

function RaceCard({ race }: { race: ElectionRaceSummary }) {
  return (
    <Link
      href={'/elections/' + race.slug}
      className="group rounded-xl border border-zinc-200 bg-white p-5 transition hover:-translate-y-0.5 hover:border-red-300 hover:shadow-lg hover:shadow-red-950/5 dark:border-zinc-800 dark:bg-zinc-900/50 dark:hover:border-red-800"
    >
      <div className="flex items-start justify-between gap-4">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400">
          <Vote className="h-5 w-5" aria-hidden />
        </span>
        <Badge tone={race.status === 'active' ? 'positive' : 'warning'}>
          {race.status === 'active' ? 'Collecting' : 'Setup'}
        </Badge>
      </div>
      <h3 className="mt-5 text-lg font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
        {race.name}
      </h3>
      <p className="mt-1 text-sm text-zinc-500">{race.jurisdiction + ' · ' + formatElectionDate(race.electionDate)}</p>
      <div className="mt-5 grid grid-cols-3 divide-x divide-zinc-200 rounded-lg bg-zinc-50 py-3 text-center dark:divide-zinc-800 dark:bg-zinc-950/60">
        <div><strong className="pb-num block text-lg text-zinc-950 dark:text-zinc-50">{race.candidateCount}</strong><span className="text-[10px] uppercase tracking-wide text-zinc-500">Candidates</span></div>
        <div><strong className="pb-num block text-lg text-zinc-950 dark:text-zinc-50">{race.profileCount}</strong><span className="text-[10px] uppercase tracking-wide text-zinc-500">Profiles</span></div>
        <div><strong className="pb-num block text-lg text-zinc-950 dark:text-zinc-50">{race.platformCount}</strong><span className="text-[10px] uppercase tracking-wide text-zinc-500">Networks</span></div>
      </div>
      <span className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-red-700 group-hover:gap-2 dark:text-red-400">
        Open race tracker <ArrowRight className="h-3.5 w-3.5 transition-all" aria-hidden />
      </span>
    </Link>
  );
}

function CreateRaceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/elections/races', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: String(form.get('name') ?? ''),
          office: String(form.get('office') ?? ''),
          jurisdiction: String(form.get('jurisdiction') ?? ''),
          electionDate: String(form.get('electionDate') ?? '') || null,
          description: String(form.get('description') ?? '') || null,
        }),
      });
      const body = await response.json() as unknown;
      if (!response.ok) throw new Error(apiMessage(body));
      const race = body as { slug: string };
      onOpenChange(false);
      router.push('/elections/' + race.slug);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The race could not be created.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} labelledBy="create-race-title" className="max-w-2xl">
      <div className="flex items-start justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
        <div><h2 id="create-race-title" className="text-lg font-semibold">Create a race tracker</h2><p className="mt-1 text-xs text-zinc-500">The race stays private. Candidate profiles reuse Data Dumpster&apos;s pooled history.</p></div>
        <Button size="icon" variant="ghost" aria-label="Close" onClick={() => onOpenChange(false)}><X className="h-4 w-4" /></Button>
      </div>
      <form onSubmit={submit} className="space-y-4 p-5">
        <Field label="Race name" htmlFor="race-name"><Input id="race-name" name="name" placeholder="Massachusetts U.S. Senate Democratic Primary" required autoFocus data-dialog-initial-focus /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Office" htmlFor="race-office"><Input id="race-office" name="office" placeholder="U.S. Senate" required /></Field>
          <Field label="Jurisdiction" htmlFor="race-jurisdiction"><Input id="race-jurisdiction" name="jurisdiction" placeholder="Massachusetts" required /></Field>
        </div>
        <Field label="Election date" htmlFor="race-date"><Input id="race-date" name="electionDate" type="date" /></Field>
        <Field label="What are we watching?" htmlFor="race-description"><Textarea id="race-description" name="description" placeholder="A short internal description of the field and what the newsroom needs to learn." /></Field>
        {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}
        <div className="flex justify-end gap-2"><Button type="button" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" variant="primary" disabled={saving}>{saving ? 'Creating…' : 'Create race'}</Button></div>
      </form>
    </Dialog>
  );
}

const FUTURE_MODULES = [
  { icon: Gauge, title: 'Polling', copy: 'Put toplines, movement, and poll quality beside the attention race.' },
  { icon: DollarSign, title: 'Fundraising', copy: 'Compare money raised, small-dollar momentum, and paid-versus-organic reach.' },
  { icon: CalendarDays, title: 'Events & debates', copy: 'Anchor social spikes to debates, visits, endorsements, and breaking news.' },
  { icon: Flag, title: 'Issues', copy: 'See which candidates own an issue, which messages travel, and where narratives cross networks.' },
] as const;

export function ElectionCenter({ races, canEdit }: { races: ElectionRaceSummary[]; canEdit: boolean }) {
  const [creating, setCreating] = React.useState(false);
  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-950 px-6 py-8 text-white dark:border-zinc-800 sm:px-8">
        <div className="absolute -right-16 -top-24 h-64 w-64 rounded-full bg-red-600/25 blur-3xl" />
        <div className="relative max-w-3xl">
          <Badge tone="critical">Newsroom intelligence</Badge>
          <h2 className="mt-4 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">Election Center</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-300 sm:text-base">
            Track the digital contest inside every race: who is building an audience, who is earning attention, and which messages are breaking through. One candidate profile is collected once and can be reused across races.
          </p>
          <div className="mt-6 flex flex-wrap gap-3 text-xs text-zinc-300">
            <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-emerald-400" /> Shared history, no duplicate crawls</span>
            <span className="inline-flex items-center gap-1.5"><Radio className="h-4 w-4 text-red-400" /> Nine social networks plus Truth Social</span>
            <span className="inline-flex items-center gap-1.5"><Landmark className="h-4 w-4 text-blue-400" /> Multiple races, one private newsroom workspace</span>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-red-700 dark:text-red-400">Race tracker</p><h2 className="mt-1 text-xl font-semibold tracking-tight">Active and upcoming races</h2></div>
        {canEdit ? <Button variant="primary" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Add race</Button> : null}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {races.map((race) => <RaceCard key={race.id} race={race} />)}
      </div>

      <Card>
        <CardHeader><div><CardTitle>What Election Center grows into</CardTitle><p className="mt-1 text-xs text-zinc-500">The social race is the first module. These are the next logical data layers—not pretend features.</p></div><Badge tone="outline">Roadmap</Badge></CardHeader>
        <CardBody className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {FUTURE_MODULES.map(({ icon: Icon, title, copy }) => <div key={title} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"><Icon className="h-5 w-5 text-red-700 dark:text-red-400" /><h3 className="mt-3 text-sm font-semibold">{title}</h3><p className="mt-1 text-xs leading-5 text-zinc-500">{copy}</p></div>)}
        </CardBody>
      </Card>

      <Link href="/elections/2028" className="flex items-center justify-between rounded-xl border border-dashed border-zinc-300 px-5 py-4 text-sm hover:border-red-300 hover:bg-red-50/40 dark:border-zinc-700 dark:hover:border-red-900 dark:hover:bg-red-950/10">
        <span><strong className="block text-zinc-900 dark:text-zinc-100">Explore the 2028 presidential concept</strong><span className="mt-0.5 block text-xs text-zinc-500">Sample-data preview for testing future national-race views.</span></span><ArrowRight className="h-4 w-4" />
      </Link>
      <CreateRaceDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}
