'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Building2, Check, FileUp, Loader2, Plus, Target, Trash2, X } from 'lucide-react';
import { PLATFORM_LABELS, type Platform } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Button, ButtonGroup, ButtonGroupItem } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { MultiSelect } from '@/components/ui/multi-select';
import { Badge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { PlatformIcon } from '@/components/ui/platform-icon';
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
  /** Whether this workspace created the pooled row and may edit its descriptive metadata. */
  attributedToOrg: boolean;
  channelCount: number;
  channels: CompanyProfileRecord[];
  /** Whether this company belongs to the landscape currently selected. */
  inSelectedLandscape: boolean;
}

export interface LandscapeRecordFull {
  id: string;
  name: string;
  focusCompanyId: string | null;
  focusCompanyName: string | null;
  memberIds: string[];
  memberCount: number;
}

const COMPANY_PLATFORM_ORDER: Platform[] = [
  'facebook',
  'instagram',
  'threads',
  'twitter',
  'youtube',
  'tiktok',
  'bluesky',
  'reddit',
];

async function send<T = void>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(detail?.error ?? 'Request failed with status ' + res.status + '.');
  }
  if (res.status === 204) return undefined as T;
  return await res.json() as T;
}

export function CompaniesManager({
  companies,
  landscapes,
  canEdit,
  canDeleteCompanies,
  selectedLandscapeId,
  landscapeName,
}: {
  companies: CompanyRecord[];
  landscapes: LandscapeRecordFull[];
  canEdit: boolean;
  canDeleteCompanies: boolean;
  selectedLandscapeId: string | null;
  landscapeName: string | null;
}) {
  /*
   * Split by the selected landscape.
   *
   * This screen listed every company the workspace could see, in one flat
   * list, and did not change when the landscape switcher did. Switching from a
   * three-company landscape to a twenty-two-company one showed the same rows
   * either way, which makes the switcher look broken and makes the page
   * useless for the question people actually bring to it: who is in this
   * landscape.
   *
   * The rest are still here, below and collapsed, because they have to be. A
   * company has to exist before it can be added to a landscape, and companies
   * are pooled, so the ones not in this landscape are exactly the candidates.
   */
  const inLandscape = companies.filter((c) => c.inSelectedLandscape);
  const others = companies.filter((c) => !c.inSelectedLandscape);

  return (
    <div className="space-y-4">
      <CompaniesCard
        companies={inLandscape}
        canEdit={canEdit}
        selectedLandscapeId={selectedLandscapeId}
        reusableCompanies={others}
        landscapeName={landscapeName}
        title={landscapeName ? 'Companies in ' + landscapeName : 'Companies'}
        emptyHint={landscapeName
          ? 'This landscape has no companies yet. Reuse an existing company or create a new one.'
          : undefined}
      />
      {others.length > 0 ? (
        <CompaniesCard
          companies={others}
          canEdit={canEdit}
          title={'Other companies in your workspace (' + others.length + ')'}
          subtitle={landscapeName
            ? 'Tracked elsewhere, or not yet in this landscape. Use Add company above to reuse one here.'
            : undefined}
          startCollapsed
          showAddCompany={false}
        />
      ) : null}
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
  title = 'Companies',
  subtitle,
  emptyHint,
  startCollapsed = false,
  selectedLandscapeId = null,
  reusableCompanies = [],
  landscapeName = null,
  showAddCompany = true,
}: {
  companies: CompanyRecord[];
  canEdit: boolean;
  title?: string;
  subtitle?: string;
  emptyHint?: string;
  startCollapsed?: boolean;
  selectedLandscapeId?: string | null;
  reusableCompanies?: CompanyRecord[];
  landscapeName?: string | null;
  showAddCompany?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(!startCollapsed && companies.length === 0);
  const [addMode, setAddMode] = React.useState<'existing' | 'new'>(
    selectedLandscapeId && reusableCompanies.length > 0 ? 'existing' : 'new',
  );
  const [existingCompanyId, setExistingCompanyId] = React.useState('');
  const [addingFor, setAddingFor] = React.useState<string | null>(null);
  const [name, setName] = React.useState('');
  const [website, setWebsite] = React.useState('');
  const [segment, setSegment] = React.useState('');
  const [color, setColor] = React.useState('#2563EB');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const profileCompany = companies.find((company) => company.id === addingFor) ?? null;

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const created = await send<{ id: string }>('/api/companies', 'POST', {
        name: name.trim(),
        website: website.trim() || null,
        segment: segment.trim() || null,
        color,
      });
      if (selectedLandscapeId) {
        await send('/api/landscapes/' + selectedLandscapeId + '/companies', 'POST', {
          companyId: created.id,
        });
      }
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

  const addExisting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLandscapeId || !existingCompanyId) return;
    setBusy(true);
    setError(null);
    try {
      await send('/api/landscapes/' + selectedLandscapeId + '/companies', 'POST', {
        companyId: existingCompanyId,
      });
      setExistingCompanyId('');
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the company to this landscape.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>{title}</CardTitle>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              {subtitle
                ?? 'Add each brand once, then connect every social profile Data Dumpster should measure.'}
            </p>
          </div>
          {canEdit && showAddCompany ? (
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                setError(null);
                setOpen((v) => !v);
              }}
            >
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

        {open && canEdit && showAddCompany ? (
          <div className="space-y-3 border-b border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
          {selectedLandscapeId ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                  {landscapeName ? 'Add to ' + landscapeName : 'Add to this landscape'}
                </p>
                <p className="mt-0.5 text-[11px] text-zinc-500">
                  Reusing a company keeps its profiles, history, and membership in every other landscape.
                </p>
              </div>
              <ButtonGroup aria-label="Company source">
                <ButtonGroupItem
                  active={addMode === 'existing'}
                  disabled={reusableCompanies.length === 0}
                  onClick={() => {
                    setError(null);
                    setAddMode('existing');
                  }}
                >
                  Use existing
                </ButtonGroupItem>
                <ButtonGroupItem
                  active={addMode === 'new'}
                  onClick={() => {
                    setError(null);
                    setAddMode('new');
                  }}
                >
                  Create new
                </ButtonGroupItem>
              </ButtonGroup>
            </div>
          ) : null}

          {selectedLandscapeId && addMode === 'existing' ? (
            <form onSubmit={addExisting} className="space-y-3">
              <Field
                label="Existing company"
                htmlFor="existing-company"
                hint="Companies already tracked in another landscape are available here."
              >
                <Select
                  id="existing-company"
                  value={existingCompanyId}
                  onChange={(e) => setExistingCompanyId(e.target.value)}
                  placeholder="Choose a company"
                  options={reusableCompanies.map((company) => ({
                    value: company.id,
                    label: company.name,
                  }))}
                  required
                />
              </Field>
              <div className="flex items-center gap-2">
                <Button type="submit" variant="primary" size="sm" disabled={busy || !existingCompanyId}>
                  {busy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
                  Add to landscape
                </Button>
                <Button type="button" size="sm" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
          <form onSubmit={create} className="space-y-3">
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
              {selectedLandscapeId ? 'Create and add to landscape' : 'Create company'}
            </Button>
            <Button type="button" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
          </form>
          )}
          </div>
        ) : null}

        {companies.length === 0 && !open ? (
          <EmptyState
            compact
            icon={Building2}
            title="No companies yet"
            description={emptyHint
              ?? 'Start with your own brand, then add the outlets you actually compete with for attention.'}
          />
        ) : (
          <div className="overflow-x-auto [scrollbar-width:thin]">
            <table className="w-full min-w-[52rem] border-collapse text-left">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50/70 dark:border-zinc-800 dark:bg-zinc-900/40">
                  <th scope="col" className="sticky left-0 z-10 min-w-56 bg-zinc-50 px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:bg-zinc-900">
                    Company
                  </th>
                  {COMPANY_PLATFORM_ORDER.map((platform) => (
                    <th key={platform} scope="col" className="w-16 px-2 py-2 text-center">
                      <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-950 dark:ring-zinc-800">
                        <PlatformIcon platform={platform} label className="h-5 w-5" />
                      </span>
                    </th>
                  ))}
                  {canEdit ? <th scope="col" className="w-28 px-4 py-2"><span className="sr-only">Actions</span></th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                {companies.map((company) => (
                  <tr key={company.id} className="group hover:bg-zinc-50/70 dark:hover:bg-zinc-900/30">
                    <th scope="row" className="sticky left-0 z-10 bg-white px-4 py-3 group-hover:bg-zinc-50 dark:bg-zinc-950 dark:group-hover:bg-zinc-900">
                      <span className="flex min-w-0 items-center gap-3">
                        <span
                          aria-hidden
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white shadow-sm"
                          style={{ backgroundColor: company.color ?? '#71717a' }}
                        >
                          {company.name.slice(0, 2).toUpperCase()}
                        </span>
                        <span className="min-w-0">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                              {company.name}
                            </span>
                            {!company.attributedToOrg ? <Badge tone="outline">Shared</Badge> : null}
                          </span>
                          <span className="block max-w-44 truncate text-[10px] font-normal text-zinc-500">
                            {[company.segment, company.website].filter(Boolean).join(' · ')
                              || company.channelCount + (company.channelCount === 1 ? ' profile' : ' profiles')}
                          </span>
                        </span>
                      </span>
                    </th>
                    {COMPANY_PLATFORM_ORDER.map((platform) => {
                      const channel = company.channels.find((candidate) => candidate.platform === platform);
                      const connected = Boolean(channel?.active);
                      return (
                        <td key={platform} className="px-2 py-3 text-center">
                          <span
                            role="img"
                            aria-label={channel
                              ? PLATFORM_LABELS[platform] + (connected ? ' connected' : ' paused') + ': ' + channel.handle
                              : PLATFORM_LABELS[platform] + ' not connected'}
                            title={channel ? channel.handle + (connected ? '' : ' (paused)') : 'Not connected'}
                            className={cn(
                              'inline-flex h-8 w-8 items-center justify-center rounded-full',
                              connected
                                ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:ring-emerald-900'
                                : channel
                                  ? 'bg-amber-50 text-amber-600 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:ring-amber-900'
                                  : 'bg-zinc-100 text-zinc-300 dark:bg-zinc-900 dark:text-zinc-700',
                            )}
                          >
                            {channel ? <Check className="h-4 w-4" aria-hidden /> : null}
                          </span>
                        </td>
                      );
                    })}
                    {canEdit ? (
                      <td className="px-4 py-3 text-right">
                        {company.attributedToOrg ? (
                          <Button size="sm" onClick={() => setAddingFor(company.id)}>
                            <Plus className="h-3 w-3" aria-hidden />
                            Profile
                          </Button>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
  const [focusMode, setFocusMode] = React.useState<'existing' | 'new'>(
    companies.length > 0 ? 'existing' : 'new',
  );
  const [focusCompanyId, setFocusCompanyId] = React.useState('');
  const [newCompanyName, setNewCompanyName] = React.useState('');
  const [newCompanyWebsite, setNewCompanyWebsite] = React.useState('');
  const [newCompanySegment, setNewCompanySegment] = React.useState('');
  const [newCompanyColor, setNewCompanyColor] = React.useState('#2563EB');
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
      const ids = focusMode === 'existing' && focusCompanyId && !memberIds.includes(focusCompanyId)
        ? [focusCompanyId, ...memberIds]
        : memberIds;
      const created = await send<{ id: string }>('/api/landscapes', 'POST', {
        name: name.trim(),
        focusCompanyId: focusMode === 'existing' ? focusCompanyId || null : null,
        newFocusCompany: focusMode === 'new' ? {
          name: newCompanyName.trim(),
          website: newCompanyWebsite.trim() || null,
          segment: newCompanySegment.trim() || null,
          color: newCompanyColor,
        } : null,
        companyIds: ids,
      });
      setName('');
      setFocusCompanyId('');
      setNewCompanyName('');
      setNewCompanyWebsite('');
      setNewCompanySegment('');
      setMemberIds([]);
      setOpen(false);
      router.push('/settings/companies?landscape=' + created.id);
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
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Landscape name" htmlFor="landscape-name">
              <Input
                id="landscape-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Boston metro news"
                required
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
          <div className="space-y-3 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-medium text-zinc-900 dark:text-zinc-100">Focus company</p>
                <p className="text-[11px] text-zinc-500">The brand every comparison is written from.</p>
              </div>
              <ButtonGroup aria-label="Focus company source">
                <ButtonGroupItem
                  active={focusMode === 'existing'}
                  disabled={companies.length === 0}
                  onClick={() => setFocusMode('existing')}
                >
                  Use existing
                </ButtonGroupItem>
                <ButtonGroupItem
                  active={focusMode === 'new'}
                  onClick={() => setFocusMode('new')}
                >
                  Create new
                </ButtonGroupItem>
              </ButtonGroup>
            </div>
            {focusMode === 'existing' ? (
              <Field label="Existing company" htmlFor="focus-company">
                <Select
                  id="focus-company"
                  value={focusCompanyId}
                  onChange={(e) => setFocusCompanyId(e.target.value)}
                  placeholder="Choose a focus company"
                  options={companies.map((c) => ({ value: c.id, label: c.name }))}
                  required
                />
              </Field>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Company name" htmlFor="new-focus-name">
                  <Input
                    id="new-focus-name"
                    value={newCompanyName}
                    onChange={(e) => setNewCompanyName(e.target.value)}
                    placeholder="The Boston Globe"
                    required
                  />
                </Field>
                <Field label="Website" htmlFor="new-focus-website" hint="Optional">
                  <Input
                    id="new-focus-website"
                    type="url"
                    value={newCompanyWebsite}
                    onChange={(e) => setNewCompanyWebsite(e.target.value)}
                    placeholder="https://example.com"
                  />
                </Field>
                <Field label="Peer group" htmlFor="new-focus-segment" hint="Optional">
                  <Input
                    id="new-focus-segment"
                    value={newCompanySegment}
                    onChange={(e) => setNewCompanySegment(e.target.value)}
                    placeholder="Metro daily"
                  />
                </Field>
                <Field label="Chart color" htmlFor="new-focus-color">
                  <Input
                    id="new-focus-color"
                    type="color"
                    value={newCompanyColor}
                    onChange={(e) => setNewCompanyColor(e.target.value)}
                    className="p-1"
                  />
                </Field>
              </div>
            )}
          </div>
          <p className="text-[11px] leading-relaxed text-zinc-500">
            Share of voice and share of engagement are relative to whoever is in here, so adding or
            removing a company changes everyone’s number without anyone changing behavior. Pick the
            set you would actually defend in a meeting.
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={busy || (focusMode === 'existing' ? !focusCompanyId : !newCompanyName.trim())}
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
              {focusMode === 'new' ? 'Create landscape and company' : 'Create landscape'}
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
