'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Building2, FileUp, Loader2, Plus, Target, Trash2, X } from 'lucide-react';
import type { Platform } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { MultiSelect } from '@/components/ui/multi-select';
import { Badge, PlatformBadge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { AddChannelForm } from '@/components/settings/sources-manager';
import { LandscapeImportDialog } from '@/components/settings/landscape-import-dialog';

export interface CompanyProfileRecord {
  id: string;
  platform: Platform;
  handle: string;
  profileUrl: string | null;
  active: boolean;
}

export interface CompanyRecord {
  id: string;
  name: string;
  website: string | null;
  segment: string | null;
  color: string | null;
  /** Whether this workspace created the pooled row and may offer destructive controls for it. */
  attributedToOrg: boolean;
  channelCount: number;
  channels: CompanyProfileRecord[];
}

export interface LandscapeRecordFull {
  id: string;
  name: string;
  focusCompanyId: string | null;
  focusCompanyName: string | null;
  memberIds: string[];
  memberCount: number;
}

async function send(url: string, method: string, body?: unknown): Promise<void> {
  const res = await fetch(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(detail.slice(0, 300) || 'Request failed with status ' + res.status + '.');
  }
}

export function CompaniesManager({
  companies,
  landscapes,
  canEdit,
  canDeleteCompanies,
}: {
  companies: CompanyRecord[];
  landscapes: LandscapeRecordFull[];
  canEdit: boolean;
  canDeleteCompanies: boolean;
}) {
  return (
    <div className="space-y-4">
      <CompaniesCard
        companies={companies}
        canEdit={canEdit}
        canDeleteCompanies={canDeleteCompanies}
      />
      <LandscapesCard
        companies={companies}
        landscapes={landscapes}
        canEdit={canEdit}
        canDelete={canDeleteCompanies}
      />
    </div>
  );
}

function CompaniesCard({
  companies,
  canEdit,
  canDeleteCompanies,
}: {
  companies: CompanyRecord[];
  canEdit: boolean;
  canDeleteCompanies: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(companies.length === 0);
  const [addingFor, setAddingFor] = React.useState<string | null>(null);
  const [name, setName] = React.useState('');
  const [website, setWebsite] = React.useState('');
  const [segment, setSegment] = React.useState('');
  const [color, setColor] = React.useState('#2563EB');
  const [busy, setBusy] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const profileCompany = companies.find((company) => company.id === addingFor) ?? null;

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await send('/api/companies', 'POST', {
        name: name.trim(),
        website: website.trim() || null,
        segment: segment.trim() || null,
        color,
      });
      setName('');
      setWebsite('');
      setSegment('');
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the company.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      await send('/api/companies/' + id, 'DELETE');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the company.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Companies and social profiles</CardTitle>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              Add each brand once, then connect every social profile Data Dumpster should measure.
            </p>
          </div>
          {canEdit ? (
            <Button size="sm" variant="primary" onClick={() => setOpen((v) => !v)}>
              <Plus className="h-3 w-3" aria-hidden />
              Add company
            </Button>
          ) : null}
        </CardHeader>

        {error ? (
          <p className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
            {error}
          </p>
        ) : null}

        {open && canEdit ? (
          <form onSubmit={create} className="space-y-3 border-b border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Name" htmlFor="company-name">
              <Input
                id="company-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="The Boston Globe"
                required
              />
            </Field>
            <Field label="Website" hint="Used for posted-URL attribution.">
              <Input
                type="url"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="https://www.bostonglobe.com"
              />
            </Field>
            <Field label="Segment" hint="Free-form peer grouping, e.g. metro daily.">
              <Input value={segment} onChange={(e) => setSegment(e.target.value)} placeholder="metro daily" />
            </Field>
          </div>
          <Field label="Chart color" hint="Used consistently for this company on every chart.">
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              aria-label="Chart color"
              className="h-8 w-16 cursor-pointer rounded border border-zinc-200 bg-transparent dark:border-zinc-800"
            />
          </Field>
          <div className="flex items-center gap-2">
            <Button type="submit" variant="primary" size="sm" disabled={busy}>
              {busy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
              Create company
            </Button>
            <Button type="button" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
          </form>
        ) : null}

        {companies.length === 0 && !open ? (
          <EmptyState
            compact
            icon={Building2}
            title="No companies yet"
            description="Start with your own brand, then add the outlets you actually compete with for attention."
          />
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {companies.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: c.color ?? '#71717a' }}
                />
                <span className="min-w-40 flex-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-xs font-medium text-zinc-900 dark:text-zinc-100">
                      {c.name}
                    </span>
                    {!c.attributedToOrg ? <Badge tone="outline">Shared</Badge> : null}
                  </span>
                  <span className="block truncate text-[11px] text-zinc-500">
                    {[c.segment, c.website].filter(Boolean).join(' · ') || 'No segment or website set'}
                  </span>
                </span>

                <span className="flex min-w-0 basis-full items-center gap-3 pl-5 sm:basis-auto sm:pl-0">
                  {c.channels.length === 0 ? (
                    <span className="text-[11px] text-zinc-400">No social profiles</span>
                  ) : (
                    <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                      {c.channels.slice(0, 4).map((channel) => (
                        <span
                          key={channel.id}
                          className={cn(!channel.active && 'opacity-50')}
                          title={'@' + channel.handle}
                        >
                          <PlatformBadge platform={channel.platform} />
                        </span>
                      ))}
                      {c.channels.length > 4 ? (
                        <span className="text-[11px] text-zinc-400">
                          {'+' + (c.channels.length - 4)}
                        </span>
                      ) : null}
                    </span>
                  )}
                  <span className="pb-num shrink-0 text-[11px] text-zinc-400">
                    {c.channelCount + (c.channelCount === 1 ? ' profile' : ' profiles')}
                  </span>
                </span>

                {canEdit && c.attributedToOrg ? (
                  <Button size="sm" onClick={() => setAddingFor(c.id)}>
                    <Plus className="h-3 w-3" aria-hidden />
                    Add profile
                  </Button>
                ) : null}
                {canDeleteCompanies && c.attributedToOrg ? (
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={'Delete ' + c.name}
                    disabled={busyId === c.id}
                    onClick={() => {
                      if (!window.confirm(
                        'Delete ' + c.name + '? This removes its social profiles and all collected history. '
                        + 'This cannot be undone.',
                      )) return;
                      void remove(c.id);
                    }}
                  >
                    {busyId === c.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    )}
                  </Button>
                ) : (
                  <span className="w-8" aria-hidden />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Dialog
        open={profileCompany !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setAddingFor(null);
        }}
        labelledBy="add-social-profile-title"
        describedBy="add-social-profile-description"
        className="max-w-2xl"
      >
        {profileCompany ? (
          <>
            <div className="flex items-start gap-4 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
              <div className="min-w-0 flex-1">
                <h2 id="add-social-profile-title" className="text-base font-semibold text-zinc-950 dark:text-zinc-50">
                  Add a social profile
                </h2>
                <p id="add-social-profile-description" className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  {'Connect a public account to ' + profileCompany.name + '. We will look it up before anything is saved.'}
                </p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Close add profile dialog"
                onClick={() => setAddingFor(null)}
              >
                <X className="h-4 w-4" aria-hidden />
              </Button>
            </div>
            <div className="max-h-[calc(100vh-12rem)] overflow-y-auto p-5">
              <AddChannelForm
                companyId={profileCompany.id}
                existing={profileCompany.channels.map((channel) => channel.platform)}
                onDone={() => {
                  setAddingFor(null);
                  router.refresh();
                }}
                onCancel={() => setAddingFor(null)}
              />
            </div>
          </>
        ) : null}
      </Dialog>
    </>
  );
}

function LandscapesCard({
  companies,
  landscapes,
  canEdit,
  canDelete,
}: {
  companies: CompanyRecord[];
  landscapes: LandscapeRecordFull[];
  canEdit: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const [focusCompanyId, setFocusCompanyId] = React.useState('');
  const [memberIds, setMemberIds] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const ids = focusCompanyId && !memberIds.includes(focusCompanyId)
        ? [focusCompanyId, ...memberIds]
        : memberIds;
      await send('/api/landscapes', 'POST', {
        name: name.trim(),
        focusCompanyId: focusCompanyId || null,
        companyIds: ids,
      });
      setName('');
      setMemberIds([]);
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the landscape.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      await send('/api/landscapes/' + id, 'DELETE');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the landscape.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <Card>
      <CardHeader>
        <div>
          <CardTitle>Landscapes</CardTitle>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            One focus company plus the set it is measured against. Every screen answers a question
            about exactly one of these.
          </p>
        </div>
        {canEdit ? (
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => setImportOpen(true)}>
              <FileUp className="h-3 w-3" aria-hidden />
              Import CSV
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={companies.length === 0}
              onClick={() => setOpen((v) => !v)}
            >
              <Plus className="h-3 w-3" aria-hidden />
              New landscape
            </Button>
          </div>
        ) : null}
      </CardHeader>

      {error ? (
        <p className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </p>
      ) : null}

      {open && canEdit ? (
        <form onSubmit={create} className="space-y-3 border-b border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Landscape name" htmlFor="landscape-name">
              <Input
                id="landscape-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Boston metro news"
                required
              />
            </Field>
            <Field label="Focus company" hint="The brand this landscape is written from.">
              <Select
                value={focusCompanyId}
                onChange={(e) => setFocusCompanyId(e.target.value)}
                placeholder="Choose a focus company"
                options={companies.map((c) => ({ value: c.id, label: c.name }))}
              />
            </Field>
            <Field label="Competitors" hint="Who else belongs in the comparison.">
              <MultiSelect
                label="Competitors"
                searchable={companies.length > 8}
                options={companies.map((c) => ({ value: c.id, label: c.name, color: c.color ?? undefined }))}
                value={memberIds}
                onChange={setMemberIds}
                allLabel="None selected"
              />
            </Field>
          </div>
          <p className="text-[11px] leading-relaxed text-zinc-500">
            Share of voice and share of engagement are relative to whoever is in here, so adding or
            removing a company changes everyone’s number without anyone changing behavior. Pick the
            set you would actually defend in a meeting.
          </p>
          <div className="flex items-center gap-2">
            <Button type="submit" variant="primary" size="sm" disabled={busy}>
              {busy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
              Create landscape
            </Button>
            <Button type="button" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {landscapes.length === 0 && !open ? (
        <EmptyState
          compact
          icon={Target}
          title="No landscapes yet"
          description="A landscape is the unit of comparison. Without one, there is nothing for the dashboards to be about."
        />
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
          {landscapes.map((l) => (
            <li key={l.id} className={cn('flex items-center gap-3 px-4 py-2.5')}>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-zinc-900 dark:text-zinc-100">
                  {l.name}
                </span>
                <span className="block truncate text-[11px] text-zinc-500">
                  {(l.focusCompanyName ?? 'No focus company') +
                    ' · ' +
                    l.memberCount +
                    (l.memberCount === 1 ? ' company' : ' companies')}
                </span>
              </span>
              {l.focusCompanyId ? <Badge tone="accent">Focus set</Badge> : <Badge tone="warning">No focus</Badge>}
              {canDelete ? (
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={'Delete ' + l.name}
                  disabled={busyId === l.id}
                  onClick={() => remove(l.id)}
                >
                  {busyId === l.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  )}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      </Card>
      <LandscapeImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={() => router.refresh()}
      />
    </>
  );
}
