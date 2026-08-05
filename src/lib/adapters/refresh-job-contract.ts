import { PLATFORMS, type Platform } from '@/lib/types';

export const REFRESH_JOB_STATUSES = [
  'queued',
  'running',
  'completed',
  'completed_with_issues',
  'failed',
] as const;

export type RefreshJobStatus = (typeof REFRESH_JOB_STATUSES)[number];

export type RefreshActivityPhase =
  | 'collecting'
  | 'queued'
  | 'waiting'
  | 'completed'
  | 'source_limited'
  | 'needs_attention';

export interface RefreshActivityItem {
  channelId: string;
  companyName: string;
  handle: string;
  platform: Platform;
  phase: RefreshActivityPhase;
  updatedAt: string;
  nextAttemptAt: string | null;
}

export interface RefreshActivity {
  collecting: RefreshActivityItem[];
  queuedNext: RefreshActivityItem[];
  recent: RefreshActivityItem[];
}

export interface RefreshRequestScope {
  platforms: Platform[];
  since: string;
  until: string;
}

export function refreshScopeCoversPlatform(
  scope: RefreshRequestScope,
  platform: Platform,
  since: Date,
  until: Date,
): boolean {
  return (scope.platforms.length === 0 || scope.platforms.includes(platform))
    && new Date(scope.since) <= since
    && new Date(scope.until) >= until;
}

export function refreshRequestScopesCover(
  scopes: readonly RefreshRequestScope[],
  platforms: readonly Platform[],
  since: Date,
  until: Date,
): boolean {
  if (platforms.length === 0) {
    return scopes.some((scope) => (
      scope.platforms.length === 0
      && new Date(scope.since) <= since
      && new Date(scope.until) >= until
    ));
  }
  return platforms.every((platform) => scopes.some((scope) => (
    refreshScopeCoversPlatform(scope, platform, since, until)
  )));
}

export function refreshActivityPhaseForState(input: {
  status: string;
  outcome: string | null;
  nextAttemptAt: Date | null;
  leaseUntil: Date | null;
  now: Date;
}): RefreshActivityPhase {
  const now = input.now.getTime();
  const leaseUntil = input.leaseUntil?.getTime() ?? 0;
  const nextAttemptAt = input.nextAttemptAt?.getTime() ?? 0;
  const workerActive = input.status === 'running' && leaseUntil > now;
  const runnable = (
    ['queued', 'partial', 'failed'].includes(input.status)
    && nextAttemptAt > 0
    && nextAttemptAt <= now
    && leaseUntil <= now
  ) || (input.status === 'running' && leaseUntil <= now);
  const remaining = input.status === 'queued'
    || input.status === 'running'
    || (
      input.outcome !== 'terminal_source_limitation'
      && (input.nextAttemptAt !== null || input.outcome === 'continuation')
    );
  if (workerActive) return 'collecting';
  if (runnable) return 'queued';
  if (remaining) return 'waiting';
  if (input.status === 'failed' && input.nextAttemptAt === null) return 'needs_attention';
  if (input.outcome === 'terminal_source_limitation') return 'source_limited';
  return 'completed';
}

export interface RefreshQueueProgress {
  total: number;
  remaining: number;
  runnableNow: number;
  running: number;
  waitingForRetry: number;
  blocked: number;
  sourceLimited: number;
  nextReadyAt: Date | null;
}

export interface RefreshJobSnapshot {
  id: string;
  landscapeId: string;
  scopeKey: string;
  platforms: Platform[];
  status: RefreshJobStatus;
  total: number;
  settled: number;
  remaining: number;
  runnableNow: number;
  running: number;
  waitingForRetry: number;
  blocked: number;
  sourceLimited: number;
  nextReadyAt: string | null;
  requiredSince: string;
  requiredUntil: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  lastError: string | null;
  activity: RefreshActivity;
}

const PLATFORM_SET = new Set<string>(PLATFORMS);

export function canonicalRefreshPlatforms(
  platforms?: readonly Platform[],
): Platform[] {
  return [...new Set(platforms ?? [])].sort() as Platform[];
}

export function parseRefreshPlatforms(value: unknown): Platform[] {
  if (!Array.isArray(value)) return [];
  return canonicalRefreshPlatforms(value.filter(
    (platform): platform is Platform => typeof platform === 'string' && PLATFORM_SET.has(platform),
  ));
}

export function refreshScopeKey(
  landscapeId: string,
  platforms: readonly Platform[] | undefined,
  since: Date | string,
  until: Date | string,
): string {
  const selected = canonicalRefreshPlatforms(platforms);
  return landscapeId
    + ':' + (selected.length > 0 ? selected.join(',') : '*')
    + ':' + new Date(since).toISOString()
    + ':' + new Date(until).toISOString();
}

/** One active coordinator per landscape coalesces overlapping platform scopes. */
export function refreshCoordinatorScopeKey(landscapeId: string): string {
  return landscapeId;
}

/** Empty means every supported platform, matching the URL/API convention. */
export function refreshPlatformSelectionCovers(
  covering: readonly Platform[],
  requested: readonly Platform[],
): boolean {
  if (covering.length === 0) return true;
  if (requested.length === 0) return false;
  const covered = new Set(covering);
  return requested.every((platform) => covered.has(platform));
}

export function mergeRefreshPlatformSelections(
  current: readonly Platform[],
  requested: readonly Platform[],
): Platform[] {
  if (current.length === 0 || requested.length === 0) return [];
  return canonicalRefreshPlatforms([...current, ...requested]);
}

export function refreshStatusFromProgress(
  current: RefreshJobStatus,
  progress: Pick<RefreshQueueProgress, 'remaining' | 'blocked' | 'sourceLimited'>,
): RefreshJobStatus {
  // Collection state is pooled and mutable: a later scheduled refresh can
  // requeue the same channel rows. A finished coordinator is a historical fact
  // and must never reopen just because shared work changed underneath it.
  if (
    current === 'completed'
    || current === 'completed_with_issues'
    || current === 'failed'
  ) return current;
  if (progress.remaining > 0) return current === 'queued' ? 'queued' : 'running';
  return progress.blocked > 0 || progress.sourceLimited > 0
    ? 'completed_with_issues'
    : 'completed';
}

export function settledProfiles(total: number, remaining: number): number {
  return Math.max(0, Math.min(total, total - remaining));
}

export function isActiveRefreshStatus(status: RefreshJobStatus): boolean {
  return status === 'queued' || status === 'running';
}

export function shouldDispatchNextWave(progress: RefreshQueueProgress): boolean {
  // A delayed retry is durable, but immediately waking another function would
  // only spin until its backoff expires. The recurring dispatcher recovers it.
  return progress.runnableNow > 0;
}
