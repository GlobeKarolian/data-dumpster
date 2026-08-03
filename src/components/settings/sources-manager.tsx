'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Check, Loader2, PauseCircle, PlayCircle, Plus, Radio, Search, Trash2 } from 'lucide-react';
import { PLATFORM_COLORS, PLATFORM_LABELS, type Platform } from '@/lib/types';
import { ADAPTER_SUPPORTED_PLATFORMS } from '@/lib/adapters/supported-platforms';
import { platformAudienceNoun, platformHandleLabel } from '@/lib/platform-language';
import { cn } from '@/lib/utils';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Toggle } from '@/components/ui/toggle';
import { Badge, Dot } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Tooltip } from '@/components/ui/tooltip';
import { formatRelative } from '@/components/ui/format';

export interface ChannelRecord {
  id: string;
  platform: Platform;
  handle: string;
  profileUrl: string | null;
  active: boolean;
  isOwned: boolean;
  lastIngestedAt: string | null;
  lastRunStatus: string | null;
  lastRunError: string | null;
  collectionStatus: 'queued' | 'running' | 'succeeded' | 'partial' | 'failed' | null;
  collectionRequiredSince: string | null;
  collectionRequiredUntil: string | null;
  collectionCoverageSince: string | null;
  collectionCoverageUntil: string | null;
  collectionAttempts: number;
  collectionNextAttemptAt: string | null;
  collectionLeaseUntil: string | null;
  collectionHasMore: boolean | null;
  collectionLastError: string | null;
  collectionUpdatedAt: string | null;
  postCount: number;
}

export interface CompanySources {
  id: string;
  name: string;
  /** Shared pooled companies are visible here but mutate only from their curator workspace. */
  manageable: boolean;
  channels: ChannelRecord[];
}

export type CollectionHealth = 'complete' | 'collecting' | 'blocked' | 'paused';

interface BlockedCause {
  key: string;
  title: string;
  action: string;
}

export interface CollectionViewState {
  health: CollectionHealth;
  label: string;
  explanation: string;
  color: string;
  error: string | null;
  cause: BlockedCause | null;
}

export interface CollectionHealthSummary {
  total: number;
  complete: number;
  collecting: number;
  blocked: number;
  paused: number;
  blockedCauses: Array<BlockedCause & {
    count: number;
    profiles: string[];
    errors: string[];
  }>;
}

function time(value: string | null): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function coversRequiredWindow(channel: ChannelRecord): boolean {
  const requiredSince = time(channel.collectionRequiredSince);
  const requiredUntil = time(channel.collectionRequiredUntil);
  const coverageSince = time(channel.collectionCoverageSince);
  const coverageUntil = time(channel.collectionCoverageUntil);
  return requiredSince !== null
    && requiredUntil !== null
    && coverageSince !== null
    && coverageUntil !== null
    && coverageSince <= requiredSince
    && coverageUntil >= requiredUntil;
}

function errorCause(error: string | null): BlockedCause {
  const value = error?.toLowerCase() ?? '';
  if (/not implemented|unsupported|no adapter/.test(value)) {
    return {
      key: 'unsupported',
      title: 'Platform collection is not configured',
      action: 'Connect a supported source for this platform, then refresh data.',
    };
  }
  if (/customer is not active|subscription|credits|quota|billing/.test(value)) {
    return {
      key: 'vendor-access',
      title: 'Collection vendor access is blocked',
      action: 'Restore the vendor account or quota, then refresh data.',
    };
  }
  if (/credential|api key|token|unauthorized|forbidden|\b401\b|\b403\b|authentication/.test(value)) {
    return {
      key: 'credentials',
      title: 'Credentials need attention',
      action: 'Correct the platform or vendor credentials, then refresh data.',
    };
  }
  if (/not found|no match|does not exist|invalid (?:handle|profile|user)|private account/.test(value)) {
    return {
      key: 'profile',
      title: 'Profile could not be read',
      action: 'Check the handle or profile URL, replace it if needed, then refresh data.',
    };
  }
  return {
    key: 'collection-error',
    title: 'Collection stopped with an error',
    action: 'Resolve the error shown below, then refresh data.',
  };
}

/**
 * A profile is complete only when its durable coverage bounds contain the
 * entire requested window. A successful page fetch or a recent timestamp is
 * deliberately insufficient.
 */
export function collectionStateOf(
  channel: ChannelRecord,
  nowMs = Date.now(),
): CollectionViewState {
  const error = (channel.collectionLastError ?? channel.lastRunError)?.trim() || null;

  if (!channel.active) {
    if (channel.platform === 'linkedin' && !channel.isOwned) {
      return {
        health: 'paused',
        label: 'Unavailable',
        explanation: 'Public LinkedIn competitor collection is unavailable. This profile is retained but excluded from completeness totals.',
        color: '#f59e0b',
        error,
        cause: null,
      };
    }
    if (channel.platform === 'reddit' && /^r\//i.test(channel.handle)) {
      return {
        health: 'paused',
        label: 'Needs account',
        explanation: 'This landscape tracks Reddit user accounts. Replace this community with a u/<user> profile to collect it.',
        color: '#f59e0b',
        error,
        cause: null,
      };
    }
    return {
      health: 'paused',
      label: 'Paused',
      explanation: 'Polling is paused. Existing history is retained.',
      color: '#a1a1aa',
      error,
      cause: null,
    };
  }

  if (
    channel.collectionStatus === 'succeeded'
    && channel.collectionHasMore === false
    && coversRequiredWindow(channel)
  ) {
    return {
      health: 'complete',
      label: 'Complete',
      explanation: 'The full requested window is covered.',
      color: '#10b981',
      error: null,
      cause: null,
    };
  }

  if (!channel.collectionStatus) {
    return {
      health: 'blocked',
      label: 'Not queued',
      explanation: 'No durable collection request exists for this profile.',
      color: '#ef4444',
      error,
      cause: {
        key: 'not-queued',
        title: 'Profiles have not been queued',
        action: 'Use Refresh data to create collection work for these profiles.',
      },
    };
  }

  if (channel.collectionStatus === 'running') {
    const leaseUntil = time(channel.collectionLeaseUntil);
    if (leaseUntil !== null && leaseUntil > nowMs) {
      return {
        health: 'collecting',
        label: 'Collecting',
        explanation: 'A worker is actively collecting this profile.',
        color: '#2563eb',
        error,
        cause: null,
      };
    }
    return {
      health: 'blocked',
      label: 'Stalled',
      explanation: 'The worker lease expired before collection finished.',
      color: '#ef4444',
      error,
      cause: {
        key: 'stalled',
        title: 'Collection workers stalled',
        action: 'Use Refresh data to requeue the expired work.',
      },
    };
  }

  if (channel.collectionNextAttemptAt) {
    const label = channel.collectionStatus === 'failed'
      ? 'Retrying'
      : channel.collectionStatus === 'partial'
        ? 'Continuing'
        : 'Queued';
    return {
      health: 'collecting',
      label,
      explanation: channel.collectionStatus === 'failed'
        ? 'A retry is scheduled after a recoverable error.'
        : 'More collection work is queued for this profile.',
      color: '#2563eb',
      error,
      cause: null,
    };
  }

  if (channel.collectionStatus === 'succeeded') {
    return {
      health: 'blocked',
      label: 'Coverage gap',
      explanation: 'The run ended without covering the full requested window.',
      color: '#ef4444',
      error,
      cause: {
        key: 'coverage-gap',
        title: 'Requested history is incomplete',
        action: 'Use Refresh data to request the missing part of the window.',
      },
    };
  }

  const cause = errorCause(error);
  return {
    health: 'blocked',
    label: channel.collectionStatus === 'queued' ? 'Not scheduled' : 'Blocked',
    explanation: error
      ? 'Collection stopped and no retry is scheduled.'
      : 'Collection is incomplete and no next attempt is scheduled.',
    color: '#ef4444',
    error,
    cause: channel.collectionStatus === 'queued' && !error
      ? {
          key: 'not-scheduled',
          title: 'Queued profiles have no scheduled attempt',
          action: 'Use Refresh data to schedule this work.',
        }
      : cause,
  };
}

export function summarizeCollectionHealth(
  companies: CompanySources[],
  nowMs = Date.now(),
): CollectionHealthSummary {
  const summary: CollectionHealthSummary = {
    total: 0,
    complete: 0,
    collecting: 0,
    blocked: 0,
    paused: 0,
    blockedCauses: [],
  };
  const groups = new Map<string, CollectionHealthSummary['blockedCauses'][number]>();

  for (const company of companies) {
    for (const channel of company.channels) {
      const state = collectionStateOf(channel, nowMs);
      if (state.health === 'paused') {
        summary.paused += 1;
        continue;
      }
      summary.total += 1;
      summary[state.health] += 1;
      if (state.health !== 'blocked' || !state.cause) continue;

      const group = groups.get(state.cause.key) ?? {
        ...state.cause,
        count: 0,
        profiles: [],
        errors: [],
      };
      group.count += 1;
      group.profiles.push(company.name + ' · ' + platformHandleLabel(channel.platform, channel.handle));
      if (state.error && !group.errors.includes(state.error)) group.errors.push(state.error);
      groups.set(state.cause.key, group);
    }
  }

  summary.blockedCauses = [...groups.values()].sort((a, b) => b.count - a.count);
  return summary;
}

/**
 * Sources.
 *
 * Every comparison in Data Dumpster is only as honest as its durable collection
 * coverage. Summary counts, row labels, and terminal errors are visible without
 * requiring a hover so incomplete inputs cannot hide behind a fresh timestamp.
 */
export function SourcesManager({
  companies,
  landscapeName,
}: {
  companies: CompanySources[];
  landscapeName: string;
}) {
  const router = useRouter();
  const [addingFor, setAddingFor] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const health = summarizeCollectionHealth(companies);

  const toggleChannel = async (companyId: string, channelId: string, active: boolean) => {
    setBusyId(channelId);
    setError(null);
    try {
      const res = await fetch('/api/companies/' + companyId + '/channels', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ channelId, active }),
      });
      if (!res.ok) throw new Error(await readApiError(res));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the channel.');
    } finally {
      setBusyId(null);
    }
  };

  const removeChannel = async (companyId: string, channelId: string) => {
    setBusyId(channelId);
    setError(null);
    try {
      const res = await fetch(
        '/api/companies/' + companyId + '/channels?channelId=' + encodeURIComponent(channelId),
        {
        method: 'DELETE',
        },
      );
      if (!res.ok) throw new Error(await readApiError(res));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the channel.');
    } finally {
      setBusyId(null);
    }
  };

  if (companies.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={Radio}
          title="No companies to connect"
          description="Add the companies you want to measure first; channels hang off them."
          action={{ label: 'Add companies', href: '/settings/companies' }}
        />
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Collection coverage</CardTitle>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              Durable status for every active profile in {landscapeName}.
            </p>
          </div>
          <Badge tone={health.blocked > 0 ? 'critical' : health.collecting > 0 ? 'accent' : 'positive'}>
            {health.blocked > 0
              ? health.blocked + ' blocked'
              : health.collecting > 0
                ? 'Collection in progress'
                : health.total > 0 ? 'Complete' : 'No active profiles'}
          </Badge>
        </CardHeader>
        <div className="grid grid-cols-2 divide-x divide-y divide-zinc-200 sm:grid-cols-4 sm:divide-y-0 dark:divide-zinc-800">
          {([
            ['Active profiles', health.total, 'text-zinc-900 dark:text-zinc-100'],
            ['Complete', health.complete, 'text-emerald-700 dark:text-emerald-400'],
            ['Collecting', health.collecting, 'text-blue-700 dark:text-blue-400'],
            ['Blocked', health.blocked, health.blocked > 0 ? 'text-red-700 dark:text-red-400' : 'text-zinc-900 dark:text-zinc-100'],
          ] as const).map(([label, value, color]) => (
            <div key={label} className="px-4 py-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{label}</p>
              <p className={cn('pb-num mt-1 text-xl font-semibold', color)}>{value}</p>
            </div>
          ))}
        </div>

        {health.blockedCauses.length > 0 ? (
          <div className="border-t border-red-200 bg-red-50/60 px-4 py-3 dark:border-red-900/50 dark:bg-red-950/20">
            <p className="text-xs font-semibold text-red-900 dark:text-red-200">
              Resolve these before using the landscape’s rankings
            </p>
            <ul className="mt-2 space-y-2">
              {health.blockedCauses.map((cause) => (
                <li
                  key={cause.key}
                  className="rounded-md border border-red-200 bg-white px-3 py-2 dark:border-red-900/50 dark:bg-zinc-950/60"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                      {cause.title}
                    </p>
                    <Badge tone="critical">{cause.count} {cause.count === 1 ? 'profile' : 'profiles'}</Badge>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">
                    {cause.action}
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-500">
                    {cause.profiles.join(', ')}
                  </p>
                  {cause.errors.map((causeError) => (
                    <p
                      key={causeError}
                      className="mt-1 break-words rounded bg-red-50 px-2 py-1 font-mono text-[10px] leading-relaxed text-red-700 dark:bg-red-950/40 dark:text-red-300"
                    >
                      {causeError}
                    </p>
                  ))}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {health.paused > 0 ? (
          <p className="border-t border-zinc-200 px-4 py-2 text-[11px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            {health.paused} paused or unavailable {health.paused === 1 ? 'profile is' : 'profiles are'} excluded from the active total and shown below.
          </p>
        ) : null}
      </Card>

      {companies.map((company) => {
        const companyHealth = summarizeCollectionHealth([company]);
        return (
          <Card key={company.id}>
          <CardHeader>
            <div>
              <div className="flex items-center gap-2">
                <CardTitle>{company.name}</CardTitle>
                {!company.manageable ? <Badge tone="outline">Shared</Badge> : null}
              </div>
              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                {company.channels.length === 0
                  ? 'No channels connected'
                  : companyHealth.complete + ' of ' + companyHealth.total + ' active profiles complete'
                    + (companyHealth.paused > 0 ? ' · ' + companyHealth.paused + ' paused' : '')}
              </p>
            </div>
            {company.manageable ? (
              <Button
                size="sm"
                onClick={() => setAddingFor((prev) => (prev === company.id ? null : company.id))}
              >
                <Plus className="h-3 w-3" aria-hidden />
                Add profile
              </Button>
            ) : null}
          </CardHeader>

          {addingFor === company.id ? (
            <div className="border-b border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
              <AddChannelForm
                companyId={company.id}
                existing={company.channels.map((c) => c.platform)}
                onDone={() => {
                  setAddingFor(null);
                  router.refresh();
                }}
                onCancel={() => setAddingFor(null)}
              />
            </div>
          ) : null}

          {company.channels.length === 0 ? (
            <EmptyState
              compact
              title="Nothing connected yet"
              description="Paste a profile URL or a handle. Data Dumpster resolves it to a platform id on the first ingest."
            />
          ) : (
            <>
              {/*
                * Column headers.
                *
                * Two columns shipped with nothing but a `title` attribute: the
                * relative time and the post count. A tooltip you have to
                * discover by hovering is not a label, and the first question
                * anyone asked of this screen was what those numbers meant.
                * "Posts (all time)" is spelled out because the instinct is to
                * read it as posts in the current window, which it is not.
                *
                * The widths mirror the row below exactly. aria-hidden because
                * each cell already carries its own accessible text.
                */}
              <div
                aria-hidden
                className="flex items-center gap-3 border-b border-zinc-200 px-4 py-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-400 dark:border-zinc-800 dark:text-zinc-500"
              >
                <span className="w-4 shrink-0" />
                <span className="w-2 shrink-0" />
                <span className="w-24 shrink-0">Platform</span>
                <span className="min-w-0 flex-1">Profile</span>
                <span className="w-[4.5rem] shrink-0 text-center">Status</span>
                <span className="w-24 shrink-0 text-right">Last collected</span>
                <span className="w-14 shrink-0 text-right">Posts, all time</span>
                <span className="w-[3.75rem] shrink-0" />
              </div>
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
              {company.channels.map((channel) => {
                const state = collectionStateOf(channel);
                const tone = state.health === 'complete'
                  ? 'positive'
                  : state.health === 'collecting'
                    ? 'accent'
                    : state.health === 'blocked'
                      ? 'critical'
                      : state.label === 'Paused' ? 'outline' : 'warning';
                return (
                  <li key={channel.id} className="px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      <Tooltip
                        side="top"
                        content={
                          <span className="block">
                            <span className="block font-medium text-zinc-900 dark:text-zinc-100">
                              {state.explanation}
                            </span>
                            {state.error ? (
                              <span className="block text-red-600 dark:text-red-400">{state.error}</span>
                            ) : null}
                          </span>
                        }
                      >
                        <span tabIndex={0} className="inline-flex">
                          <Dot color={state.color} pulse={state.health === 'collecting'} />
                        </span>
                      </Tooltip>

                      <span
                        aria-hidden
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: PLATFORM_COLORS[channel.platform] }}
                      />
                      <span className="w-24 shrink-0 text-xs text-zinc-600 dark:text-zinc-400">
                        {PLATFORM_LABELS[channel.platform]}
                      </span>

                      <span className="min-w-0 flex-1 truncate text-xs text-zinc-900 dark:text-zinc-100">
                        {channel.profileUrl ? (
                          <a
                            href={channel.profileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-accent-600 hover:underline"
                          >
                            {platformHandleLabel(channel.platform, channel.handle)}
                          </a>
                        ) : (
                          platformHandleLabel(channel.platform, channel.handle)
                        )}
                        {channel.isOwned ? <Badge tone="outline" className="ml-2">Owned</Badge> : null}
                      </span>

                      <Badge tone={tone} className="justify-center">{state.label}</Badge>
                      <span
                        className="pb-num w-24 shrink-0 text-right text-[11px] text-zinc-400"
                        title="Last successful ingest"
                      >
                        {formatRelative(channel.lastIngestedAt)}
                      </span>
                      <span
                        className="pb-num w-14 shrink-0 text-right text-[11px] text-zinc-400"
                        title="Collected posts"
                      >
                        {channel.postCount.toLocaleString('en-US')}
                      </span>

                      {/* Pause is the safe verb and sits first. Deleting cascades
                          and takes every post collected under this handle with it,
                          which is almost never what "stop tracking" means. */}
                      {company.manageable ? (
                        <>
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={(channel.active ? 'Pause ' : 'Resume ') + channel.handle}
                            title={channel.active
                              ? 'Pause polling. Keeps everything already collected.'
                              : 'Resume polling.'}
                            disabled={busyId === channel.id}
                            onClick={() => toggleChannel(company.id, channel.id, !channel.active)}
                          >
                            {busyId === channel.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                            ) : channel.active ? (
                              <PauseCircle className="h-3.5 w-3.5" aria-hidden />
                            ) : (
                              <PlayCircle className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
                            )}
                          </Button>

                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={'Remove ' + channel.handle}
                            title="Delete this channel and every post collected under it."
                            disabled={busyId === channel.id}
                            onClick={() => {
                              if (channel.postCount > 0 && !window.confirm(
                                'Delete ' + channel.handle + '? This also deletes '
                                + channel.postCount.toLocaleString('en-US')
                                + ' collected posts and cannot be undone. Pause instead to keep the history.',
                              )) return;
                              void removeChannel(company.id, channel.id);
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden />
                          </Button>
                        </>
                      ) : (
                        <span className="text-[11px] text-zinc-400">Managed globally</span>
                      )}
                    </div>

                    {state.health === 'blocked' || state.health === 'paused' ? (
                      <div className={cn(
                        'ml-5 mt-2 rounded-md border px-3 py-2 text-[11px] leading-relaxed',
                        state.health === 'blocked'
                          ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/25 dark:text-red-300'
                          : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-300',
                      )}>
                        <p className="font-medium">{state.explanation}</p>
                        {state.error ? <p className="mt-0.5 break-words font-mono text-[10px]">{state.error}</p> : null}
                        {state.cause ? <p className="mt-0.5">{state.cause.action}</p> : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
              </ul>
            </>
          )}
          </Card>
        );
      })}
    </div>
  );
}

/** Unwrap the API's { error, code } envelope into a sentence a human can read. */
async function readApiError(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && 'error' in parsed) {
      return String((parsed as { error: unknown }).error);
    }
  } catch { /* not JSON */ }
  return text.slice(0, 300) || 'Request failed with status ' + res.status + '.';
}

interface VerifyWarning {
  code: string;
  message: string;
  severity: 'high' | 'medium' | 'low';
}

interface VerifyResult {
  platform: Platform;
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
  profileUrl: string | null;
  followers: number | null;
  alreadyAttached: boolean;
  warnings: VerifyWarning[];
}

const SEVERITY_STYLE: Record<VerifyWarning['severity'], string> = {
  high: 'border-red-300 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300',
  medium: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300',
  low: 'border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-400',
};

/**
 * Add a channel in two steps: look it up, then confirm what came back.
 *
 * WHY TWO STEPS
 * "Does this handle exist" is the wrong question. During setup, @thebside
 * resolved cleanly to a private individual named Kevin with 14 followers, and
 * @bostonherald to a squatted account with 2. Both would have saved without
 * complaint, ingested without complaint, and sat in a leaderboard for weeks
 * looking like competitors who never post. The only reliable check is a human
 * looking at the account that actually came back, so the form makes that
 * unavoidable rather than optional.
 */
export function AddChannelForm({
  companyId,
  existing,
  onDone,
  onCancel,
}: {
  companyId: string;
  existing: Platform[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [platform, setPlatform] = React.useState<Platform>(
    ADAPTER_SUPPORTED_PLATFORMS.find((p) => !existing.includes(p)) ?? 'facebook',
  );
  const [input, setInput] = React.useState('');
  const [isOwned, setIsOwned] = React.useState(false);
  const [checking, setChecking] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [found, setFound] = React.useState<VerifyResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const audienceLabel = platformAudienceNoun(platform).toLowerCase();
  const foundIsRedditUser = found?.platform === 'reddit' && /^u\//i.test(found.handle);
  const foundRedditEntity = found?.platform === 'reddit'
    ? foundIsRedditUser ? 'User account' : 'Community'
    : null;

  // Any edit invalidates a previous lookup, so the confirm button can never
  // apply to an account other than the one on screen.
  const reset = () => { setFound(null); setError(null); };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    setChecking(true);
    setError(null);
    try {
      const res = await fetch('/api/companies/' + companyId + '/channels/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ platform, input: input.trim() }),
      });
      if (!res.ok) throw new Error(await readApiError(res));
      setFound(await res.json() as VerifyResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not look that up.');
    } finally {
      setChecking(false);
    }
  };

  const confirm = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/companies/' + companyId + '/channels', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          platform,
          input: input.trim(),
          // Reddit's account and community measurements both come from public
          // data; the owned-insights distinction does not apply.
          isOwned: platform === 'reddit' ? false : isOwned,
        }),
      });
      if (!res.ok) throw new Error(await readApiError(res));
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the channel.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={verify} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <Field label="Platform">
          <Select
            value={platform}
            onChange={(e) => {
              const nextPlatform = e.target.value as Platform;
              setPlatform(nextPlatform);
              if (nextPlatform === 'reddit') setIsOwned(false);
              reset();
            }}
            options={ADAPTER_SUPPORTED_PLATFORMS.map((p) => ({
              value: p,
              label: PLATFORM_LABELS[p],
            }))}
          />
        </Field>
        <Field
          label="Handle or profile URL"
          hint={
            platform === 'reddit'
              ? 'Paste a Reddit user URL or enter a username. Subreddits are not publisher accounts and cannot be added.'
              : 'Either works. A full URL is safer when a brand uses different handles on different networks.'
          }
        >
          <Input
            autoFocus
            data-dialog-initial-focus
            value={input}
            onChange={(e) => { setInput(e.target.value); reset(); }}
            placeholder={
              platform === 'reddit'
                ? 'https://www.reddit.com/user/bostonglobe/'
                : 'bostonglobe or https://www.tiktok.com/@bostonglobe'
            }
            required
          />
        </Field>
      </div>

      {platform === 'reddit' ? (
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
          Reddit publisher accounts use public data, so no owned-account connection is required.
        </p>
      ) : (
        <Toggle
          checked={isOwned}
          onChange={setIsOwned}
          label="We own this channel"
          description="Owned channels can use platform insights APIs when credentials are configured, which unlocks reach and view figures that public data does not expose."
        />
      )}

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </p>
      ) : null}

      {found ? (
        <div className="space-y-2 rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
          <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
            {foundRedditEntity
              ? 'Found this ' + foundRedditEntity.toLowerCase() + '. Is it the right one?'
              : 'Found this account. Is it the right one?'}
          </p>
          <div className="flex items-center gap-3">
            {found.avatarUrl ? (
              // Remote avatars from many CDNs; next/image would need every host allow-listed.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={found.avatarUrl}
                alt=""
                className="h-10 w-10 shrink-0 rounded-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <span className="h-10 w-10 shrink-0 rounded-full bg-zinc-100 dark:bg-zinc-800" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {found.displayName ?? found.handle}
                </p>
                {foundRedditEntity ? <Badge tone="outline">{foundRedditEntity}</Badge> : null}
              </div>
              <p className="truncate text-xs text-zinc-500">
                {found.profileUrl ? (
                  <a href={found.profileUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
                    {platformHandleLabel(platform, found.handle)}
                  </a>
                ) : platformHandleLabel(platform, found.handle)}
              </p>
            </div>
            {foundIsRedditUser && found.followers === null ? null : (
              <div className="shrink-0 text-right">
                <p className="pb-num text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {found.followers === null ? '--' : found.followers.toLocaleString('en-US')}
                </p>
                <p className="text-[11px] text-zinc-500">
                  {foundIsRedditUser ? 'followers' : audienceLabel}
                </p>
              </div>
            )}
          </div>

          {found.warnings.map((w) => (
            <p key={w.code} className={cn('rounded-md border px-2.5 py-1.5 text-[11px]', SEVERITY_STYLE[w.severity])}>
              {w.message}
            </p>
          ))}
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        {found ? (
          <Button type="button" variant="primary" size="sm" disabled={saving} onClick={confirm}>
            {saving ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Check className="h-3 w-3" aria-hidden />}
            {found.alreadyAttached ? 'Refresh channel' : 'Yes, add this channel'}
          </Button>
        ) : (
          <Button type="submit" variant="primary" size="sm" disabled={checking || !input.trim()}>
            {checking ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Search className="h-3 w-3" aria-hidden />}
            {checking ? 'Looking up' : 'Look up account'}
          </Button>
        )}
        <Button type="button" size="sm" onClick={onCancel}>Cancel</Button>
        {checking ? (
          <span className="text-[11px] text-zinc-500">
            Resolving against the platform. Purchased sources can take up to a minute.
          </span>
        ) : null}
      </div>
    </form>
  );
}
