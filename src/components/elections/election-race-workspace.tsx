'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowLeft, CalendarDays, Check, Clock3, ExternalLink, Link2, Plus, ShieldCheck, UserRound, X } from 'lucide-react';
import type { Platform } from '@/lib/types';
import { PLATFORM_LABELS } from '@/lib/types';
import type { ElectionCandidateRecord, ElectionCandidateSource, ElectionRaceDetail } from '@/lib/elections/types';
import { AddChannelForm } from '@/components/settings/sources-manager';
import { RefreshButton } from '@/components/shell/refresh-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { PlatformIcon } from '@/components/ui/platform-icon';
import { cn } from '@/lib/utils';

const SOURCE_PLATFORMS: Platform[] = ['facebook', 'instagram', 'threads', 'twitter', 'youtube', 'tiktok', 'bluesky', 'truth_social'];

function formatDate(date: string | null): string {
  if (!date) return 'Election date not set';
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(date + 'T12:00:00Z'));
}

function ProfileStatus({ source }: { source: ElectionCandidateSource }) {
  const connected = source.status === 'connected';
  const review = source.status === 'review' || source.status === 'error';
  return <Badge tone={connected ? 'positive' : review ? 'warning' : 'outline'}>{connected ? 'Connected' : review ? 'Review needed' : 'Connecting'}</Badge>;
}

function CandidateCard({ candidate, canEdit }: { candidate: ElectionCandidateRecord; canEdit: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = React.useState<ElectionCandidateSource | null>(null);
  const connected = new Set(candidate.profiles.map((profile) => profile.platform));
  return (
    <Card>
      <CardHeader className="items-start">
        <div className="flex min-w-0 items-center gap-3">
          {candidate.logoUrl ? (
            // Public campaign avatars can come from many CDNs; next/image would require a brittle host allowlist.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={candidate.logoUrl} alt="" className="h-11 w-11 rounded-full object-cover" referrerPolicy="no-referrer" />
          ) : <span className="inline-flex h-11 w-11 items-center justify-center rounded-full text-sm font-bold text-white" style={{ backgroundColor: candidate.color ?? '#52525b' }}>{candidate.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('')}</span>}
          <div className="min-w-0"><CardTitle className="text-base">{candidate.name}</CardTitle><p className="mt-1 text-xs text-zinc-500">{[candidate.party, candidate.incumbent ? 'Incumbent' : null].filter(Boolean).join(' · ') || 'Candidate'}</p></div>
        </div>
        <Badge tone={candidate.status === 'withdrawn' ? 'neutral' : 'outline'}>{candidate.status}</Badge>
      </CardHeader>
      <CardBody className="grid gap-2 sm:grid-cols-2">
        {candidate.sources.map((source) => {
          const profile = candidate.profiles.find((item) => item.platform === source.platform);
          const needsReview = canEdit && !profile && (source.status === 'review' || source.status === 'error');
          return (
            <div key={source.id} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="flex items-start gap-2.5">
                <PlatformIcon platform={source.platform} className="mt-0.5 h-5 w-5 shrink-0" label />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><p className="text-xs font-semibold">{PLATFORM_LABELS[source.platform]}</p><ProfileStatus source={source} /></div>
                  <a href={profile?.profileUrl ?? source.url} target="_blank" rel="noopener noreferrer" className="mt-1 block truncate text-[11px] text-zinc-500 hover:text-red-700 hover:underline">{profile ? '@' + profile.handle.replace(/^@/, '') : source.url}</a>
                </div>
                {profile ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : needsReview ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /> : <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />}
              </div>
              {source.note ? <p className="mt-2 text-[10px] leading-4 text-amber-700 dark:text-amber-400">{source.note}</p> : null}
              {needsReview ? <Button className="mt-2" size="sm" onClick={() => setSelected(source)}>Review source</Button> : null}
            </div>
          );
        })}
      </CardBody>
      <CardBody className="flex items-center justify-between border-t border-zinc-200 py-3 dark:border-zinc-800">
        <span className="text-[11px] text-zinc-500">{connected.size + ' of ' + candidate.sources.length + ' supplied profiles connected'}</span>
        {candidate.website ? <a href={candidate.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-zinc-600 hover:text-red-700">Campaign site <ExternalLink className="h-3.5 w-3.5" /></a> : null}
      </CardBody>
      <Dialog open={selected !== null} onOpenChange={(open) => { if (!open) setSelected(null); }} labelledBy={'verify-' + candidate.id} className="max-w-3xl">
        {selected ? <><div className="flex items-start justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800"><div><h2 id={'verify-' + candidate.id} className="text-lg font-semibold">Resolve {candidate.name} on {PLATFORM_LABELS[selected.platform]}</h2><p className="mt-1 text-xs text-zinc-500">Automatic connection found an identity conflict. Review this one source before it joins the shared dataset.</p></div><Button variant="ghost" size="icon" onClick={() => setSelected(null)}><X className="h-4 w-4" /></Button></div><div className="max-h-[70vh] overflow-y-auto p-5"><AddChannelForm companyId={candidate.companyId} existing={candidate.profiles.map((profile) => profile.platform)} preferredPlatform={selected.platform} initialInput={selected.url} onCancel={() => setSelected(null)} onDone={() => { setSelected(null); router.refresh(); }} /></div></> : null}
      </Dialog>
    </Card>
  );
}

function AddCandidateDialog({ raceId, open, onOpenChange }: { raceId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(null);
    const form = new FormData(event.currentTarget);
    const sources = SOURCE_PLATFORMS.flatMap((platform) => {
      const url = String(form.get('source-' + platform) ?? '').trim();
      return url ? [{ platform, url }] : [];
    });
    try {
      const response = await fetch('/api/elections/races/' + raceId + '/candidates', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: String(form.get('name') ?? ''), party: String(form.get('party') ?? '') || null, website: String(form.get('website') ?? '') || null, color: String(form.get('color') ?? '') || null, incumbent: form.get('incumbent') === 'on', sources }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? 'The candidate could not be added.');
      onOpenChange(false); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The candidate could not be added.'); }
    finally { setSaving(false); }
  }
  return <Dialog open={open} onOpenChange={onOpenChange} labelledBy="add-candidate-title" className="max-w-3xl"><div className="flex items-start justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800"><div><h2 id="add-candidate-title" className="text-lg font-semibold">Add a candidate</h2><p className="mt-1 text-xs text-zinc-500">Paste campaign accounts. Data Dumpster connects and starts collecting them automatically.</p></div><Button size="icon" variant="ghost" onClick={() => onOpenChange(false)}><X className="h-4 w-4" /></Button></div><form onSubmit={submit} className="max-h-[78vh] space-y-4 overflow-y-auto p-5"><div className="grid gap-4 sm:grid-cols-2"><Field label="Candidate name"><Input name="name" required autoFocus data-dialog-initial-focus /></Field><Field label="Party"><Input name="party" /></Field><Field label="Campaign website"><Input name="website" type="url" placeholder="https://" /></Field><Field label="Chart color"><Input name="color" type="color" defaultValue="#52525B" /></Field></div><label className="flex items-center gap-2 text-xs"><input name="incumbent" type="checkbox" /> Incumbent in this race</label><div className="border-t border-zinc-200 pt-4 dark:border-zinc-800"><p className="text-xs font-semibold">Campaign profile URLs</p><div className="mt-3 grid gap-3 sm:grid-cols-2">{SOURCE_PLATFORMS.map((platform) => <Field key={platform} label={PLATFORM_LABELS[platform]}><div className="relative"><PlatformIcon platform={platform} className="absolute left-2.5 top-2.5 h-4 w-4" /><Input name={'source-' + platform} type="url" placeholder="https://" className="pl-8" /></div></Field>)}</div></div>{error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}<div className="flex justify-end gap-2"><Button type="button" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" variant="primary" disabled={saving}>{saving ? 'Adding…' : 'Add candidate'}</Button></div></form></Dialog>;
}

export function ElectionRaceWorkspace({ race, canEdit, manualRefreshAllowed }: { race: ElectionRaceDetail; canEdit: boolean; manualRefreshAllowed: boolean }) {
  const router = useRouter();
  const [adding, setAdding] = React.useState(false);
  const pendingSources = race.candidates.reduce(
    (sum, candidate) => sum + candidate.sources.filter((source) => ['pending', 'paused'].includes(source.status)).length,
    0,
  );
  React.useEffect(() => {
    if (!canEdit || pendingSources === 0) return;
    const controller = new AbortController();
    void fetch('/api/elections/races/' + race.id + '/connect-sources', {
      method: 'POST',
      signal: controller.signal,
    }).then((response) => {
      if (response.ok) router.refresh();
    }).catch(() => undefined);
    return () => controller.abort();
  }, [canEdit, pendingSources, race.id, router]);
  const connected = race.candidates.reduce((sum, candidate) => sum + candidate.profiles.length, 0);
  const platforms = new Set(race.candidates.flatMap((candidate) => candidate.sources.map((source) => source.platform)));
  return <div className="space-y-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><Link href="/elections" className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-red-700"><ArrowLeft className="h-3.5 w-3.5" /> Election Center</Link><div className="mt-3 flex flex-wrap items-center gap-2"><h2 className="text-2xl font-semibold tracking-[-0.025em]">{race.name}</h2><Badge tone={race.status === 'active' ? 'positive' : 'warning'}>{race.status === 'active' ? 'Collecting' : 'Setup'}</Badge></div><p className="mt-1 flex items-center gap-1.5 text-sm text-zinc-500"><CalendarDays className="h-4 w-4" /> {formatDate(race.electionDate)} · {race.jurisdiction}</p></div><div className="flex flex-wrap gap-2"><RefreshButton landscapeId={race.landscapeId} manualRefreshAllowed={manualRefreshAllowed} className="w-auto" />{canEdit ? <Button variant="primary" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add candidate</Button> : null}</div></div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
      { icon: UserRound, label: 'Candidates', value: race.candidates.length, note: 'campaign entities in this race' },
      { icon: Link2, label: 'Supplied profiles', value: race.profileCount, note: connected + ' verified and connected' },
      { icon: ShieldCheck, label: 'Networks', value: platforms.size, note: 'campaign channels represented' },
      { icon: CalendarDays, label: 'Election day', value: race.electionDate ? new Date(race.electionDate + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—', note: race.electionDate?.slice(0, 4) ?? 'date not set' },
    ].map(({ icon: Icon, label, value, note }) => <Card key={label}><CardBody><div className="flex items-center gap-2 text-zinc-500"><Icon className="h-4 w-4" /><span className="text-[10px] font-semibold uppercase tracking-[0.14em]">{label}</span></div><strong className="pb-num mt-3 block text-2xl tracking-tight">{value}</strong><p className="mt-1 text-[11px] text-zinc-500">{note}</p></CardBody></Card>)}</div>
    <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-xs leading-5 text-blue-900 dark:border-blue-900/60 dark:bg-blue-950/25 dark:text-blue-300"><strong>Campaign accounts only.</strong> Data Dumpster connects supplied profiles and begins collection automatically. Official government accounts stay outside this race unless explicitly added.</div>
    <div className="grid gap-4 xl:grid-cols-2">{race.candidates.map((candidate) => <CandidateCard key={candidate.id} candidate={candidate} canEdit={canEdit} />)}</div>
    <Card className={cn('overflow-hidden', connected === 0 && 'border-dashed')}><CardHeader><div><CardTitle>Race intelligence</CardTitle><p className="mt-1 text-xs text-zinc-500">Audience momentum, engagement share, posting pace, and top content will appear here as profiles finish their first collection.</p></div><Badge tone="outline">{connected === 0 ? 'Waiting for sources' : 'Building history'}</Badge></CardHeader><CardBody><div className="grid gap-3 sm:grid-cols-3"><div className="h-24 rounded-lg bg-gradient-to-r from-zinc-100 to-zinc-50 dark:from-zinc-800 dark:to-zinc-900" /><div className="h-24 rounded-lg bg-gradient-to-r from-zinc-100 to-zinc-50 dark:from-zinc-800 dark:to-zinc-900" /><div className="h-24 rounded-lg bg-gradient-to-r from-zinc-100 to-zinc-50 dark:from-zinc-800 dark:to-zinc-900" /></div></CardBody></Card>
    <AddCandidateDialog raceId={race.id} open={adding} onOpenChange={setAdding} />
  </div>;
}
