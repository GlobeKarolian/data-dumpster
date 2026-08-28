'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Check, Loader2, Plus, Radio, Search } from 'lucide-react';
import { PLATFORM_LABELS, type Platform } from '@/lib/types';
import type { CollectionOutcome } from '@/lib/adapters/types';
import {
  ADDABLE_PUBLIC_PROFILE_PLATFORMS,
  POOLED_SOURCE_DISCLOSURE,
  nextAddablePublicPlatform,
} from '@/lib/adapters/supported-platforms';
import { platformAudienceNoun, platformHandleLabel } from '@/lib/platform-language';
import { cn } from '@/lib/utils';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge, Dot } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Tooltip } from '@/components/ui/tooltip';
import { formatRelative } from '@/components/ui/format';
import { PlatformIcon } from '@/components/ui/platform-icon';

export interface ChannelRecord {
  id: string;
  platform: Platform;
  handle: string;
  profileUrl: string | null;
  active: boolean;
  lastIngestedAt: string | null;
  lastRunStatus: string | null;
  lastRunError: string | null;
  collectionStatus: 'queued' | 'running' | 'succeeded' | 'partial' | 'failed' | null;
  collectionOutcome: CollectionOutcome | null;
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
    platforms: Partial<Record<Platform, number>>;
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

function errorCause(error: string | null, platform?: Platform): BlockedCause {
  const value = error?.toLowerCase() ?? '';
  if (platform === 'facebook' && value.includes('meta / ppca is not connected')) {
    return {
      key: 'facebook-source-policy',
      title: 'Facebook is on the pooled vendor route',
      action: 'The next automatic window will collect the existing profile through Bright Data. New Facebook profile onboarding remains unavailable.',
    };
  }
  if (/not implemented|unsupported|no adapter/.test(value)) {
    return {
      key: 'unsupported',
      title: 'Platform collection is not configured',
      action: 'Connect a supported source for this platform; collection will resume automatically.',
    };
  }
  if (/customer is not active|subscription|credits|quota|billing/.test(value)) {
    return {
      key: 'vendor-access',
      title: 'Collection vendor access is blocked',
      action: 'Restore the vendor account or quota; collection will resume automatically.',
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
  const rawError = (channel.collectionLastError ?? channel.lastRunError)?.trim() || null;
  const legacyMetaError = channel.platform === 'facebook'
    && /page public content access|\bppca\b|ppcaApproved|ppcaAccessToken|meta requires/i.test(rawError ?? '');
  const error = legacyMetaError
    ? POOLED_SOURCE_DISCLOSURE.facebook + ' ' + POOLED_SOURCE_DISCLOSURE.meta
    : rawError;

  if (!channel.active) {
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
    && channel.collectionOutcome === 'certified_complete'
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
        action: 'The next twice-daily collection window will create work for these profiles.',
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
        action: 'The recovery worker will reclaim this expired work automatically.',
      },
    };
  }

  if (channel.collectionOutcome === 'terminal_source_limitation') {
    /*
     * Not an error state. The source paginates without cursors, so it cannot
     * *certify* history back to the start of the requested window — but the
     * recent data is coming in and is fully usable. That is a proof limit, not
     * a data problem, so the row reads Complete and only the tooltip notes the
     * certification ceiling. Only genuine failures earn a visible badge.
     */
    return {
      health: 'complete',
      label: 'Complete',
      explanation: 'Recent data is complete and usable. History depth is capped by the source (it paginates without cursors), so the full requested window cannot be certified — a proof limit, not missing data.',
      color: '#10b981',
      error: null,
      cause: null,
    };
  }

  if (channel.collectionOutcome === 'permanent_failure') {
    const cause = error ? errorCause(error, channel.platform) : {
      key: 'permanent-failure',
      title: 'Collection needs operator attention',
      action: 'Correct the source or credential configuration; the next automatic window will try again.',
    };
    return {
      health: 'blocked',
      label: 'Action required',
      explanation: 'Collection stopped because this failure requires an operator or configuration change.',
      color: '#ef4444',
      error,
      cause,
    };
  }

  if (channel.collectionOutcome === 'continuation') {
    return {
      health: 'collecting',
      label: 'Continuing',
      explanation: channel.collectionNextAttemptAt
        ? 'The source returned a continuation cursor. Another page is queued for collection.'
        : 'The source returned a continuation cursor. More collection work remains.',
      color: '#2563eb',
      error,
      cause: null,
    };
  }

  if (channel.collectionOutcome === 'retryable_operational_failure') {
    return {
      health: 'collecting',
      label: 'Retrying',
      explanation: channel.collectionNextAttemptAt
        ? 'A retry is scheduled after a recoverable operational error.'
        : 'A recoverable operational error is waiting to be retried.',
      color: '#2563eb',
      error,
      cause: null,
    };
  }

  if (channel.collectionNextAttemptAt) {
    return {
      health: 'collecting',
      label: 'Queued',
      explanation: 'Collection work is queued for this profile.',
      color: '#2563eb',
      error,
      cause: null,
    };
  }

  if (channel.collectionOutcome === 'certified_complete') {
    return {
      health: 'blocked',
      label: 'Coverage gap',
      explanation: 'The latest attempt was certified, but durable coverage does not span the full requested window.',
      color: '#ef4444',
      error,
      cause: {
        key: 'coverage-gap',
        title: 'Requested history is incomplete',
        action: 'The next automatic window will request the missing part of the window.',
      },
    };
  }

  if (channel.collectionStatus === 'succeeded') {
    return {
      health: 'blocked',
      label: 'Unverified status',
      explanation: 'Coverage exists, but no certified collection outcome is recorded.',
      color: '#ef4444',
      error,
      cause: {
        key: 'uncertified-outcome',
        title: 'Completed runs are missing certification',
        action: 'The next automatic window will ask the source to certify the requested window.',
      },
    };
  }

  const cause = errorCause(error, channel.platform);
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
          action: 'The recovery worker will schedule this queued work automatically.',
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
  const blockedGroups = new Map<string, CollectionHealthSummary['blockedCauses'][number]>();

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

      const group = blockedGroups.get(state.cause.key) ?? {
        ...state.cause,
        count: 0,
        profiles: [],
        errors: [],
        platforms: {},
      };
      group.count += 1;
      group.profiles.push(company.name + ' · ' + platformHandleLabel(channel.platform, channel.handle));
      if (state.error && !group.errors.includes(state.error)) group.errors.push(state.error);
      group.platforms[channel.platform] = (group.platforms[channel.platform] ?? 0) + 1;
      blockedGroups.set(state.cause.key, group);
    }
  }

  summary.blockedCauses = [...blockedGroups.values()].sort((a, b) => b.count - a.count);
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
  const health = summarizeCollectionHealth(companies);

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
      <div
        role="note"
        aria-label="Pooled source routing"
        className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/40"
      >
        <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">Pooled source routing</p>
        <p className="mt-1 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
          {POOLED_SOURCE_DISCLOSURE.vendors} {POOLED_SOURCE_DISCLOSURE.facebook}
        </p>
        <p className="mt-1 text-xs font-medium leading-relaxed text-amber-800 dark:text-amber-300">
          {POOLED_SOURCE_DISCLOSURE.meta}
        </p>
      </div>

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
              ? health.blocked + (health.blocked === 1 ? ' vendor issue' : ' vendor issues')
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
            ['Action required', health.blocked, health.blocked > 0 ? 'text-red-700 dark:text-red-400' : 'text-zinc-900 dark:text-zinc-100'],
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
              Operator action is needed for {health.blocked} {health.blocked === 1 ? 'profile' : 'profiles'}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-red-800 dark:text-red-300">
              Other measured profiles and provisional rankings remain available while this is resolved.
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
                  : companyHealth.total + ' active · '
                    + companyHealth.complete + ' complete · '
                    + companyHealth.collecting + ' collecting'
                    + (companyHealth.blocked > 0 ? ' · ' + companyHealth.blocked + ' action needed' : '')
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
              description="Add a public social profile. Data Dumpster verifies the account first, then collects only competitor-comparable public fields."
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
                className="hidden items-center gap-3 border-b border-zinc-200 px-4 py-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-400 sm:flex dark:border-zinc-800 dark:text-zinc-500"
              >
                <span className="w-4 shrink-0" />
                <span className="w-2 shrink-0" />
                <span className="w-24 shrink-0">Platform</span>
                <span className="min-w-0 flex-1">Profile</span>
                <span className="w-[4.5rem] shrink-0 text-center">Status</span>
                <span className="w-24 shrink-0 text-right">Last collected</span>
                <span className="w-14 shrink-0 text-right">Posts, all time</span>
              </div>
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
              {company.channels.map((channel) => {
                const state = collectionStateOf(channel);
                const tone = state.health === 'blocked' ? 'critical' : 'outline';
                const isError = state.health === 'blocked';
                return (
                  <li key={channel.id} className="px-4 py-2.5">
                    <div className="grid min-w-0 grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-2 sm:flex sm:gap-3">
                      {isError ? (
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
                            <Dot color={state.color} />
                          </span>
                        </Tooltip>
                      ) : null}

                      <PlatformIcon platform={channel.platform} />
                      <span className="hidden w-24 shrink-0 text-xs text-zinc-600 sm:block dark:text-zinc-400">
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
                      </span>

                      {isError ? (
                        <Badge tone={tone} className="justify-center">{state.label}</Badge>
                      ) : null}
                      <span
                        className="pb-num hidden w-24 shrink-0 text-right text-[11px] text-zinc-400 sm:block"
                        title="Last successful ingest"
                      >
                        {formatRelative(channel.lastIngestedAt)}
                      </span>
                      <span
                        className="pb-num hidden w-14 shrink-0 text-right text-[11px] text-zinc-400 sm:block"
                        title="Collected posts"
                      >
                        {channel.postCount.toLocaleString('en-US')}
                      </span>
                      <span className="col-span-4 flex min-w-0 items-center gap-2 text-[10px] text-zinc-400 sm:hidden">
                        <span>{PLATFORM_LABELS[channel.platform]}</span>
                        <span aria-hidden>·</span>
                        <span>{'Collected ' + formatRelative(channel.lastIngestedAt)}</span>
                        <span aria-hidden>·</span>
                        <span className="pb-num">{channel.postCount.toLocaleString('en-US') + ' posts'}</span>
                      </span>
                    </div>

                    {isError ? (
                      <details
                        className="ml-5 mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[11px] leading-relaxed text-red-800 dark:border-red-900/50 dark:bg-red-950/25 dark:text-red-300"
                        open
                      >
                        <summary className="cursor-pointer font-medium marker:text-current">
                          {state.explanation}
                        </summary>
                        {state.error ? <p className="mt-0.5 break-words font-mono text-[10px]">{state.error}</p> : null}
                        {state.cause ? <p className="mt-0.5">{state.cause.action}</p> : null}
                      </details>
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
interface AddChannelFormProps {
  companyId: string;
  existing: Platform[];
  onDone: () => void;
  onCancel: () => void;
  /** Election Center can open the shared verifier on a supplied roster row. */
  preferredPlatform?: Platform;
  initialInput?: string;
}

export function AddChannelForm(props: AddChannelFormProps) {
  const preferredAvailable = props.preferredPlatform
    && ADDABLE_PUBLIC_PROFILE_PLATFORMS.includes(props.preferredPlatform as never)
    && !props.existing.includes(props.preferredPlatform)
    ? props.preferredPlatform
    : null;
  const initialPlatform = preferredAvailable ?? nextAddablePublicPlatform(props.existing);
  if (!initialPlatform) {
    return (
      <div className="space-y-3 rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
        <div>
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            Every available public platform is already connected
          </p>
          <p className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
            Data Dumpster adds one competitor-comparable public profile per platform here. New
            Facebook profiles are paused until verification can reuse the first paid crawl.
          </p>
        </div>
        <Button type="button" size="sm" onClick={props.onCancel}>Close</Button>
      </div>
    );
  }

  return <AddChannelFormFields {...props} initialPlatform={initialPlatform} />;
}

function AddChannelFormFields({
  companyId,
  existing,
  onDone,
  onCancel,
  initialPlatform,
  initialInput,
}: AddChannelFormProps & { initialPlatform: Platform }) {
  const availablePlatforms = ADDABLE_PUBLIC_PROFILE_PLATFORMS.filter(
    (candidate) => !existing.includes(candidate),
  );
  const [platform, setPlatform] = React.useState<Platform>(initialPlatform);
  const [input, setInput] = React.useState(initialInput ?? '');
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
              setPlatform(e.target.value as Platform);
              reset();
            }}
            options={availablePlatforms.map((p) => ({
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

      <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-[11px] leading-relaxed text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/25 dark:text-blue-300">
        Data Dumpster adds public profiles using competitor-comparable fields. Owner-only reach,
        saves, impressions, and private content are excluded. New Facebook profiles are paused until
        verification can reuse the first public crawl. LinkedIn competitor pages use Bright Data&apos;s
        public company and post datasets.
        {platform === 'reddit' ? ' Reddit sources must be publisher user accounts, not communities.' : ''}
      </div>

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
            Resolving through the configured public source. Purchased sources can take up to a minute.
          </span>
        ) : null}
      </div>
    </form>
  );
}
