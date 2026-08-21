'use client';

/**
 * Landscape-first company management.
 *
 * The audit that produced this rewrite found the page inverted: the landscape
 * — the unit every screen in the product answers questions about — was a list
 * at the bottom, while the top of the page was a company table silently scoped
 * by the top-bar switcher. Membership could be added but never removed, a
 * landscape could not be renamed or have its focus changed after creation, and
 * the create form demanded a focus company the schema itself treats as
 * optional.
 *
 * The shape now matches the mental model: pick a landscape on the left, work
 * on it on the right. Everything a landscape needs is on its panel — rename,
 * focus (or none), membership, and every member's platform profiles, where an
 * empty platform cell is itself the affordance for filling it.
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Building2, Check, ExternalLink, FileUp, Loader2, Pencil, Plus, Target, Trash2, X,
} from 'lucide-react';
import { PLATFORM_LABELS, type Platform } from '@/lib/types';
import { cn } from '@/lib/utils';
import { ADDABLE_PUBLIC_PROFILE_PLATFORMS } from '@/lib/adapters/supported-platforms';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Button, ButtonGroup, ButtonGroupItem } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { MultiSelect } from '@/components/ui/multi-select';
import { Badge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { PlatformIcon } from '@/components/ui/platform-icon';
import { useUrlState } from '@/components/common/use-url-state';
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

const MATRIX_PLATFORMS: Platform[] = [
  'facebook',
  ...ADDABLE_PUBLIC_PROFILE_PLATFORMS.filter((p) => p !== 'truth_social'),
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

/* ------------------------------------------------------------------ shell */

export function CompaniesManager({
  companies,
  landscapes,
  canEdit,
  canDeleteCompanies,
  selectedLandscapeId,
}: {
  companies: CompanyRecord[];
  landscapes: LandscapeRecordFull[];
  canEdit: boolean;
  canDeleteCompanies: boolean;
  selectedLandscapeId: string | null;
  landscapeName?: string | null;
}) {
  const router = useRouter();
  const { setParams } = useUrlState();
  const [createOpen, setCreateOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);

  const selected = landscapes.find((l) => l.id === selectedLandscapeId) ?? null;
  const members = selected
    ? companies.filter((c) => selected.memberIds.includes(c.id))
    : [];
  const others = selected
    ? companies.filter((c) => !selected.memberIds.includes(c.id))
    : companies;

  return (
    <div className="grid gap-4 lg:grid-cols-[16.5rem_1fr]">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 px-0.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            Landscapes
          </p>
          {canEdit ? (
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              className="inline-flex items-center gap-1 text-[11px] text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              <FileUp className="h-3 w-3" aria-hidden />
              Import CSV
            </button>
          ) : null}
        </div>

        <div className="space-y-1.5">
          {landscapes.map((l) => {
            const active = l.id === selectedLandscapeId;
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => setParams({ landscape: l.id, companies: null })}
                aria-pressed={active}
                className={cn(
                  'w-full rounded-lg border p-2.5 text-left transition-colors',
                  active
                    ? 'border-accent-600 bg-accent-50/60 dark:border-accent-500 dark:bg-accent-950/20'
                    : 'border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700',
                )}
              >
                <span className="block truncate text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                  {l.name}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-zinc-500">
                  {(l.focusCompanyName ?? 'No focus company')
                    + ' · ' + l.memberCount + (l.memberCount === 1 ? ' company' : ' companies')}
                </span>
              </button>
            );
          })}
        </div>

        {canEdit ? (
          <Button size="sm" variant="primary" className="w-full" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3 w-3" aria-hidden />
            New landscape
          </Button>
        ) : null}
      </div>

      <div className="min-w-0">
        {selected ? (
          <LandscapePanel
            key={selected.id}
            landscape={selected}
            members={members}
            others={others}
            canEdit={canEdit}
            canDelete={canDeleteCompanies}
          />
        ) : (
          <Card>
            <EmptyState
              icon={Target}
              title={landscapes.length === 0 ? 'Create your first landscape' : 'Pick a landscape'}
              description={landscapes.length === 0
                ? 'A landscape is the competitive set every screen answers questions about. Name one, add the brands, connect their profiles.'
                : 'Choose a landscape on the left to manage its companies and their social profiles.'}
            />
          </Card>
        )}
      </div>

      <CreateLandscapeDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        companies={companies}
        onCreated={(id) => {
          setCreateOpen(false);
          router.push('/settings/companies?landscape=' + id);
        }}
      />
      <LandscapeImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={() => router.refresh()}
      />
    </div>
  );
}

/* --------------------------------------------------------- landscape panel */

function LandscapePanel({
  landscape,
  members,
  others,
  canEdit,
  canDelete,
}: {
  landscape: LandscapeRecordFull;
  members: CompanyRecord[];
  others: CompanyRecord[];
  canEdit: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [renaming, setRenaming] = React.useState(false);
  const [name, setName] = React.useState(landscape.name);
  const [deleting, setDeleting] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [profileTarget, setProfileTarget] =
    React.useState<{ company: CompanyRecord; platform?: Platform } | null>(null);
  const [removingId, setRemovingId] = React.useState<string | null>(null);

  const patch = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await send('/api/landscapes/' + landscape.id, 'PATCH', body);
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the change.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const rename = async () => {
    const trimmed = name.trim();
    setRenaming(false);
    if (!trimmed || trimmed === landscape.name) {
      setName(landscape.name);
      return;
    }
    await patch({ name: trimmed });
  };

  const setFocus = async (companyId: string) => {
    await patch({ focusCompanyId: companyId || null });
  };

  const removeMember = async (companyId: string) => {
    if (removingId !== companyId) {
      setRemovingId(companyId);
      window.setTimeout(() => setRemovingId((current) => (current === companyId ? null : current)), 2600);
      return;
    }
    setRemovingId(null);
    const next = landscape.memberIds.filter((id) => id !== companyId);
    const body: Record<string, unknown> = { companyIds: next };
    // Removing the focus company also clears the focus, explicitly: leaving a
    // focus pointing at a brand outside the landscape would be a quiet lie.
    if (landscape.focusCompanyId === companyId) body.focusCompanyId = null;
    await patch(body);
  };

  const destroy = async () => {
    setBusy(true);
    setError(null);
    try {
      await send('/api/landscapes/' + landscape.id, 'DELETE');
      router.push('/settings/companies');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the landscape.');
      setBusy(false);
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="min-w-0">
            {renaming && canEdit ? (
              <form onSubmit={(e) => { e.preventDefault(); void rename(); }}>
                <Input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => void rename()}
                  className="h-7 max-w-xs text-sm"
                  aria-label="Landscape name"
                />
              </form>
            ) : (
              <CardTitle className="inline-flex items-center gap-1.5">
                {landscape.name}
                {canEdit ? (
                  <button
                    type="button"
                    onClick={() => setRenaming(true)}
                    className="text-zinc-400 transition-colors hover:text-zinc-700 dark:hover:text-zinc-200"
                    aria-label="Rename this landscape"
                    title="Rename"
                  >
                    <Pencil className="h-3 w-3" aria-hidden />
                  </button>
                ) : null}
              </CardTitle>
            )}
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              {members.length + (members.length === 1 ? ' company' : ' companies')
                + '. Share of voice and share of engagement are defined entirely by who is in here.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <label className="flex items-center gap-1.5 text-[11px] text-zinc-500" htmlFor="focus-select">
              Focus
              <Select
                id="focus-select"
                value={landscape.focusCompanyId ?? ''}
                disabled={!canEdit || busy}
                onChange={(e) => void setFocus(e.target.value)}
                className="h-7 w-44 text-xs"
                options={[
                  { value: '', label: 'No focus company' },
                  ...members.map((c) => ({ value: c.id, label: c.name })),
                ]}
              />
            </label>
            {canDelete ? (
              deleting ? (
                <span className="flex items-center gap-1.5">
                  <span className="text-[11px] text-zinc-600 dark:text-zinc-300">Delete landscape?</span>
                  <Button size="sm" variant="danger" onClick={() => void destroy()} disabled={busy}>
                    Delete
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeleting(false)} disabled={busy}>
                    Keep
                  </Button>
                </span>
              ) : (
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={'Delete ' + landscape.name}
                  title="Delete landscape"
                  disabled={busy}
                  onClick={() => setDeleting(true)}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </Button>
              )
            ) : null}
          </div>
        </CardHeader>

        {error ? (
          <p className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
            {error}
          </p>
        ) : null}

        {members.length === 0 ? (
          <EmptyState
            compact
            icon={Building2}
            title="No companies in this landscape yet"
            description="Add the brands below. A company added here keeps its profiles and history everywhere else it appears."
          />
        ) : (
          <MembersTable
            members={members}
            focusCompanyId={landscape.focusCompanyId}
            canEdit={canEdit}
            removingId={removingId}
            onOpenProfiles={(company, platform) => setProfileTarget({ company, platform })}
            onRemove={(companyId) => void removeMember(companyId)}
          />
        )}

        {canEdit ? (
          <AddCompanyPanel landscape={landscape} others={others} />
        ) : null}
      </Card>

      <ProfilesDialog
        target={profileTarget}
        onClose={() => setProfileTarget(null)}
        canEdit={canEdit}
      />
    </div>
  );
}

/* ------------------------------------------------------------ member table */

function MembersTable({
  members,
  focusCompanyId,
  canEdit,
  removingId,
  onOpenProfiles,
  onRemove,
}: {
  members: CompanyRecord[];
  focusCompanyId: string | null;
  canEdit: boolean;
  removingId: string | null;
  onOpenProfiles: (company: CompanyRecord, platform?: Platform) => void;
  onRemove: (companyId: string) => void;
}) {
  return (
    <div className="overflow-x-auto [scrollbar-width:thin]">
      <table className="w-full min-w-[56rem] border-collapse text-left">
        <thead>
          <tr className="border-b border-zinc-200 bg-zinc-50/70 dark:border-zinc-800 dark:bg-zinc-900/40">
            <th scope="col" className="sticky left-0 z-10 min-w-56 bg-zinc-50 px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:bg-zinc-900">
              Company
            </th>
            {MATRIX_PLATFORMS.map((platform) => (
              <th key={platform} scope="col" className="w-14 px-1.5 py-2 text-center">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-950 dark:ring-zinc-800">
                  <PlatformIcon platform={platform} label className="h-[18px] w-[18px]" />
                </span>
              </th>
            ))}
            <th scope="col" className="w-24 px-3 py-2 text-right">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
          {members.map((company) => (
            <tr key={company.id} className="group hover:bg-zinc-50/70 dark:hover:bg-zinc-900/30">
              <th scope="row" className="sticky left-0 z-10 bg-white px-4 py-2.5 group-hover:bg-zinc-50 dark:bg-zinc-950 dark:group-hover:bg-zinc-900">
                <span className="flex min-w-0 items-center gap-3">
                  <span
                    aria-hidden
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold text-white shadow-sm"
                    style={{ backgroundColor: company.color ?? '#71717a' }}
                  >
                    {company.name.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="min-w-0">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                        {company.name}
                      </span>
                      {company.id === focusCompanyId ? <Badge tone="accent">Focus</Badge> : null}
                      {!company.attributedToOrg ? <Badge tone="outline">Shared</Badge> : null}
                    </span>
                    <span className="block max-w-44 truncate text-[10px] font-normal text-zinc-500">
                      {company.channelCount + (company.channelCount === 1 ? ' profile' : ' profiles')
                        + (company.segment ? ' · ' + company.segment : '')}
                    </span>
                  </span>
                </span>
              </th>
              {MATRIX_PLATFORMS.map((platform) => {
                const channel = company.channels.find((candidate) => candidate.platform === platform);
                const connected = Boolean(channel?.active);
                const label = channel
                  ? PLATFORM_LABELS[platform] + (connected ? ': ' : ' (paused): ') + channel.handle
                  : 'Add ' + PLATFORM_LABELS[platform] + ' for ' + company.name;
                return (
                  <td key={platform} className="px-1.5 py-2.5 text-center">
                    <button
                      type="button"
                      onClick={() => onOpenProfiles(company, channel ? undefined : platform)}
                      aria-label={label}
                      title={channel ? channel.handle + (connected ? '' : ' (paused)') : label}
                      className={cn(
                        'inline-flex h-8 w-8 items-center justify-center rounded-full transition-transform',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500',
                        canEdit && 'hover:scale-110',
                        connected
                          ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:ring-emerald-900'
                          : channel
                            ? 'bg-amber-50 text-amber-600 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:ring-amber-900'
                            : 'bg-zinc-100 text-zinc-300 ring-1 ring-transparent hover:ring-zinc-300 dark:bg-zinc-900 dark:text-zinc-700 dark:hover:ring-zinc-700',
                      )}
                    >
                      {channel
                        ? <Check className="h-4 w-4" aria-hidden />
                        : canEdit
                          ? <Plus className="h-3.5 w-3.5" aria-hidden />
                          : null}
                    </button>
                  </td>
                );
              })}
              <td className="px-3 py-2.5 text-right">
                <span className="inline-flex items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={() => onOpenProfiles(company)}>
                    Profiles
                  </Button>
                  {canEdit ? (
                    removingId === company.id ? (
                      <Button size="sm" variant="danger" onClick={() => onRemove(company.id)}>
                        Remove?
                      </Button>
                    ) : (
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={'Remove ' + company.name + ' from this landscape'}
                        title="Remove from this landscape"
                        onClick={() => onRemove(company.id)}
                      >
                        <X className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    )
                  ) : null}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* -------------------------------------------------------- add company panel */

function AddCompanyPanel({
  landscape,
  others,
}: {
  landscape: LandscapeRecordFull;
  others: CompanyRecord[];
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [mode, setMode] = React.useState<'existing' | 'new'>(others.length > 0 ? 'existing' : 'new');
  const [existingCompanyId, setExistingCompanyId] = React.useState('');
  const [name, setName] = React.useState('');
  const [website, setWebsite] = React.useState('');
  const [segment, setSegment] = React.useState('');
  const [color, setColor] = React.useState('#2563EB');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const addExisting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!existingCompanyId) return;
    setBusy(true);
    setError(null);
    try {
      await send('/api/landscapes/' + landscape.id + '/companies', 'POST', {
        companyId: existingCompanyId,
      });
      setExistingCompanyId('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the company to this landscape.');
    } finally {
      setBusy(false);
    }
  };

  const createNew = async (e: React.FormEvent) => {
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
      await send('/api/landscapes/' + landscape.id + '/companies', 'POST', {
        companyId: created.id,
      });
      setName('');
      setWebsite('');
      setSegment('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the company.');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div className="border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <Button size="sm" variant="primary" onClick={() => setOpen(true)}>
          <Plus className="h-3 w-3" aria-hidden />
          Add company
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 border-t border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
            {'Add to ' + landscape.name}
          </p>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            Reusing a company keeps its profiles, history, and membership in every other landscape.
          </p>
        </div>
        <ButtonGroup aria-label="Company source">
          <ButtonGroupItem
            active={mode === 'existing'}
            disabled={others.length === 0}
            onClick={() => { setError(null); setMode('existing'); }}
          >
            Use existing
          </ButtonGroupItem>
          <ButtonGroupItem
            active={mode === 'new'}
            onClick={() => { setError(null); setMode('new'); }}
          >
            Create new
          </ButtonGroupItem>
        </ButtonGroup>
      </div>

      {error ? <p className="text-[11px] text-red-600 dark:text-red-400">{error}</p> : null}

      {mode === 'existing' ? (
        <form onSubmit={addExisting} className="flex flex-wrap items-end gap-2">
          <Field label="Existing company" htmlFor="existing-company" className="min-w-64 flex-1">
            <Select
              id="existing-company"
              value={existingCompanyId}
              onChange={(e) => setExistingCompanyId(e.target.value)}
              placeholder="Choose a company"
              options={others.map((company) => ({ value: company.id, label: company.name }))}
              required
            />
          </Field>
          <Button type="submit" variant="primary" size="sm" disabled={busy || !existingCompanyId}>
            {busy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
            Add to landscape
          </Button>
          <Button type="button" size="sm" onClick={() => setOpen(false)}>
            Done
          </Button>
        </form>
      ) : (
        <form onSubmit={createNew} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
            <Field label="Segment" hint="Free-form peer grouping.">
              <Input value={segment} onChange={(e) => setSegment(e.target.value)} placeholder="metro daily" />
            </Field>
            <Field label="Chart color">
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                aria-label="Chart color"
                className="h-8 w-16 cursor-pointer rounded border border-zinc-200 bg-transparent dark:border-zinc-800"
              />
            </Field>
          </div>
          <div className="flex items-center gap-2">
            <Button type="submit" variant="primary" size="sm" disabled={busy || !name.trim()}>
              {busy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
              Create and add to landscape
            </Button>
            <Button type="button" size="sm" onClick={() => setOpen(false)}>
              Done
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

/* --------------------------------------------------------- profiles dialog */

function ProfilesDialog({
  target,
  onClose,
  canEdit,
}: {
  target: { company: CompanyRecord; platform?: Platform } | null;
  onClose: () => void;
  canEdit: boolean;
}) {
  const company = target?.company ?? null;
  return (
    <Dialog
      open={company !== null}
      onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}
      labelledBy="company-profiles-title"
      className="max-w-2xl"
    >
      {company ? (
        <ProfilesDialogBody
          // Keyed so opening for a different company or cell starts fresh
          // state without effect-driven synchronization.
          key={company.id + ':' + (target?.platform ?? '')}
          company={company}
          initialPlatform={target?.platform ?? null}
          onClose={onClose}
          canEdit={canEdit}
        />
      ) : null}
    </Dialog>
  );
}

function ProfilesDialogBody({
  company,
  initialPlatform,
  onClose,
  canEdit,
}: {
  company: CompanyRecord;
  initialPlatform: Platform | null;
  onClose: () => void;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = React.useState<Platform | null>(initialPlatform);
  const addable = new Set<string>(ADDABLE_PUBLIC_PROFILE_PLATFORMS);

  return (
    <>
      {company ? (
        <>
          <div className="flex items-start gap-4 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
            <span
              aria-hidden
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white"
              style={{ backgroundColor: company.color ?? '#71717a' }}
            >
              {company.name.slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <h2 id="company-profiles-title" className="text-base font-semibold text-zinc-950 dark:text-zinc-50">
                {company.name + ' — social profiles'}
              </h2>
              <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
                Every platform in one place. Add the handles this company should be measured on.
              </p>
            </div>
            <Button size="icon" variant="ghost" aria-label="Close profiles dialog" onClick={onClose}>
              <X className="h-4 w-4" aria-hidden />
            </Button>
          </div>

          <div className="max-h-[calc(100vh-14rem)] overflow-y-auto p-5">
            {adding ? (
              <AddChannelForm
                companyId={company.id}
                existing={company.channels.map((channel) => channel.platform)}
                preferredPlatform={adding}
                onDone={() => {
                  setAdding(null);
                  onClose();
                  router.refresh();
                }}
                onCancel={() => setAdding(null)}
              />
            ) : (
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                {MATRIX_PLATFORMS.map((platform) => {
                  const channel = company.channels.find((candidate) => candidate.platform === platform);
                  return (
                    <li key={platform} className="flex items-center gap-3 py-2.5">
                      <PlatformIcon platform={platform} label className="h-5 w-5 shrink-0" />
                      <span className="w-24 shrink-0 text-xs font-medium text-zinc-700 dark:text-zinc-300">
                        {PLATFORM_LABELS[platform]}
                      </span>
                      {channel ? (
                        <>
                          <span className="min-w-0 flex-1 truncate text-xs text-zinc-600 dark:text-zinc-400">
                            {channel.handle}
                            {!channel.active ? (
                              <span className="ml-2 text-amber-600 dark:text-amber-400">paused</span>
                            ) : null}
                          </span>
                          {channel.profileUrl ? (
                            <a
                              href={channel.profileUrl}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="text-zinc-400 transition-colors hover:text-zinc-700 dark:hover:text-zinc-200"
                              aria-label={'Open ' + channel.handle + ' on ' + PLATFORM_LABELS[platform]}
                            >
                              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                            </a>
                          ) : null}
                        </>
                      ) : (
                        <>
                          <span className="min-w-0 flex-1 text-xs text-zinc-400">Not connected</span>
                          {canEdit && addable.has(platform) && company.attributedToOrg ? (
                            <Button size="sm" onClick={() => setAdding(platform)}>
                              <Plus className="h-3 w-3" aria-hidden />
                              Add
                            </Button>
                          ) : null}
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {!adding ? (
              <p className="mt-4 text-[11px] leading-relaxed text-zinc-500">
                {company.attributedToOrg
                  ? 'Pausing or correcting an existing profile lives in Settings → Social Profiles.'
                  : 'This company is shared from another workspace; its profiles are managed there.'}
              </p>
            ) : null}
          </div>
        </>
      ) : null}
    </>
  );
}

/* ---------------------------------------------------- create landscape flow */

function CreateLandscapeDialog({
  open,
  onOpenChange,
  companies,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companies: CompanyRecord[];
  onCreated: (id: string) => void;
}) {
  const [name, setName] = React.useState('');
  const [focusMode, setFocusMode] = React.useState<'none' | 'existing' | 'new'>('none');
  const [focusCompanyId, setFocusCompanyId] = React.useState('');
  const [newCompanyName, setNewCompanyName] = React.useState('');
  const [newCompanyWebsite, setNewCompanyWebsite] = React.useState('');
  const [newCompanySegment, setNewCompanySegment] = React.useState('');
  const [newCompanyColor, setNewCompanyColor] = React.useState('#2563EB');
  const [memberIds, setMemberIds] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
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
        newFocusCompany: focusMode === 'new' && newCompanyName.trim() ? {
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
      setMemberIds([]);
      setFocusMode('none');
      onCreated(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the landscape.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      labelledBy="create-landscape-title"
      className="max-w-xl"
    >
      <div className="border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
        <h2 id="create-landscape-title" className="text-base font-semibold text-zinc-950 dark:text-zinc-50">
          New landscape
        </h2>
        <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
          Name the competitive set. Companies and profiles can be added now or any time after.
        </p>
      </div>
      <form onSubmit={create} className="space-y-4 p-5">
        <Field label="Landscape name" htmlFor="landscape-name">
          <Input
            id="landscape-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Boston metro news"
            required
          />
        </Field>

        <div className="space-y-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-medium text-zinc-900 dark:text-zinc-100">Focus company</p>
              <p className="text-[11px] text-zinc-500">
                Optional. The brand comparisons are written from — leave it off for a market you watch from outside.
              </p>
            </div>
            <ButtonGroup aria-label="Focus company source">
              <ButtonGroupItem active={focusMode === 'none'} onClick={() => setFocusMode('none')}>
                None
              </ButtonGroupItem>
              <ButtonGroupItem
                active={focusMode === 'existing'}
                disabled={companies.length === 0}
                onClick={() => setFocusMode('existing')}
              >
                Use existing
              </ButtonGroupItem>
              <ButtonGroupItem active={focusMode === 'new'} onClick={() => setFocusMode('new')}>
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
          ) : null}
          {focusMode === 'new' ? (
            <div className="grid gap-3 sm:grid-cols-2">
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
          ) : null}
        </div>

        <Field label="Companies" hint="Who belongs in the comparison. Add more later at any time.">
          <MultiSelect
            label="Companies"
            searchable={companies.length > 8}
            options={companies.map((c) => ({ value: c.id, label: c.name, color: c.color ?? undefined }))}
            value={memberIds}
            onChange={setMemberIds}
            allLabel="None selected"
          />
        </Field>

        <p className="text-[11px] leading-relaxed text-zinc-500">
          Share of voice and share of engagement are relative to whoever is in here, so adding or
          removing a company changes everyone’s number without anyone changing behavior. Pick the
          set you would actually defend in a meeting.
        </p>

        {error ? <p className="text-[11px] text-red-600 dark:text-red-400">{error}</p> : null}

        <div className="flex items-center gap-2">
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={busy
              || !name.trim()
              || (focusMode === 'existing' && !focusCompanyId)
              || (focusMode === 'new' && !newCompanyName.trim())}
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
            {focusMode === 'new' ? 'Create landscape and company' : 'Create landscape'}
          </Button>
          <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
