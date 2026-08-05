import 'server-only';

import { randomUUID } from 'node:crypto';
import {
  and,
  desc,
  eq,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import { db } from '@/db';
import {
  channelCollectionState,
  channels,
  companies,
  landscapes,
  refreshJobs,
} from '@/db/schema';
import type { Platform } from '@/lib/types';
import { ADAPTER_SUPPORTED_PLATFORMS } from './supported-platforms';
import {
  getCollectionQueueStatus,
  enqueueLandscapeCollection,
  runCollectionQueue,
  type CollectionQueueStatus,
} from './collection-queue';
import {
  canonicalRefreshPlatforms,
  refreshActivityPhaseForState,
  isActiveRefreshStatus,
  parseRefreshPlatforms,
  refreshCoordinatorScopeKey,
  refreshPlatformSelectionCovers,
  refreshRequestScopesCover,
  refreshScopeCoversPlatform,
  refreshScopeKey,
  refreshStatusFromProgress,
  settledProfiles,
  shouldDispatchNextWave,
  type RefreshActivity,
  type RefreshActivityItem,
  type RefreshJobSnapshot,
  type RefreshJobStatus,
  type RefreshRequestScope,
} from './refresh-job-contract';
import { AUTOMATIC_REFRESH_HISTORY_DAYS } from './automatic-refresh';

const REFRESH_WAVE_SIZE = 10;
const REFRESH_JOB_LEASE_MS = 6 * 60_000;
const ACTIVE_STATUSES: RefreshJobStatus[] = ['queued', 'running'];

type RefreshJobRow = typeof refreshJobs.$inferSelect;

export interface StartRefreshJobInput {
  orgId: string;
  userId: string | null;
  landscapeId: string;
  platforms?: readonly Platform[];
  since: Date;
  until: Date;
  idempotencyKey: string;
}

export class RefreshIdempotencyConflictError extends Error {
  constructor() {
    super('This idempotency key was already used for a different refresh request.');
    this.name = 'RefreshIdempotencyConflictError';
  }
}

export interface ProcessRefreshWaveResult {
  claimed: boolean;
  dispatchNext: boolean;
  snapshot: RefreshJobSnapshot | null;
}

function rowStatus(row: RefreshJobRow): RefreshJobStatus {
  switch (row.status) {
    case 'queued':
    case 'running':
    case 'completed':
    case 'completed_with_issues':
    case 'failed':
      return row.status;
    default:
      return 'failed';
  }
}

function rowChannelIds(row: RefreshJobRow): string[] {
  return Array.isArray(row.channelIds)
    ? row.channelIds.filter((id): id is string => typeof id === 'string')
    : [];
}

function emptyProgress(): CollectionQueueStatus {
  return {
    total: 0,
    remaining: 0,
    runnableNow: 0,
    running: 0,
    waitingForRetry: 0,
    nextReadyAt: null,
    blocked: 0,
    sourceLimited: 0,
  };
}

function emptyActivity(): RefreshActivity {
  return { collecting: [], queuedNext: [], recent: [] };
}

interface StoredFinalSnapshot {
  blocked: number;
  sourceLimited: number;
  activity: RefreshActivity;
}

function storedFinalSnapshot(row: RefreshJobRow): StoredFinalSnapshot | null {
  const value = row.finalSnapshot;
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<StoredFinalSnapshot>;
  if (
    typeof candidate.blocked !== 'number'
    || typeof candidate.sourceLimited !== 'number'
    || !candidate.activity
    || !Array.isArray(candidate.activity.collecting)
    || !Array.isArray(candidate.activity.queuedNext)
    || !Array.isArray(candidate.activity.recent)
  ) return null;
  return candidate as StoredFinalSnapshot;
}

function isTerminalStatus(status: RefreshJobStatus): boolean {
  return status === 'completed' || status === 'completed_with_issues' || status === 'failed';
}

function requestFingerprint(input: {
  landscapeId: string;
  platforms?: readonly Platform[];
  since: Date;
  until: Date;
}): string {
  return refreshScopeKey(input.landscapeId, input.platforms, input.since, input.until);
}

function storedRequestScope(input: {
  platforms: readonly Platform[];
  since: Date;
  until: Date;
}): RefreshRequestScope {
  return {
    platforms: canonicalRefreshPlatforms(input.platforms),
    since: input.since.toISOString(),
    until: input.until.toISOString(),
  };
}

function requestScopesForRow(row: RefreshJobRow): RefreshRequestScope[] {
  if (!Array.isArray(row.requestScopes)) return [];
  return row.requestScopes.flatMap((value): RefreshRequestScope[] => {
    if (!value || typeof value !== 'object') return [];
    const candidate = value as Partial<RefreshRequestScope>;
    const platforms = parseRefreshPlatforms(candidate.platforms);
    const since = typeof candidate.since === 'string' ? new Date(candidate.since) : null;
    const until = typeof candidate.until === 'string' ? new Date(candidate.until) : null;
    if (!since || !until || !Number.isFinite(+since) || !Number.isFinite(+until)) return [];
    return [{ platforms, since: since.toISOString(), until: until.toISOString() }];
  });
}

function rowCoversRequest(row: RefreshJobRow, input: {
  platforms: readonly Platform[];
  since: Date;
  until: Date;
}): boolean {
  const scopes = requestScopesForRow(row);
  if (scopes.length === 0) {
    return refreshPlatformSelectionCovers(parseRefreshPlatforms(row.platforms), input.platforms)
      && row.requiredSince <= input.since
      && row.requiredUntil >= input.until;
  }
  return refreshRequestScopesCover(scopes, input.platforms, input.since, input.until);
}

function terminalProgress(row: RefreshJobRow): CollectionQueueStatus {
  const final = storedFinalSnapshot(row);
  return {
    total: row.totalProfiles,
    remaining: 0,
    runnableNow: 0,
    running: 0,
    waitingForRetry: 0,
    nextReadyAt: null,
    blocked: final?.blocked ?? 0,
    sourceLimited: final?.sourceLimited ?? 0,
  };
}

async function activityForRow(row: RefreshJobRow): Promise<RefreshActivity> {
  const channelIds = rowChannelIds(row);
  if (channelIds.length === 0) return emptyActivity();
  const rows = await db
    .select({
      channelId: channelCollectionState.channelId,
      companyName: companies.name,
      handle: channels.handle,
      platform: channels.platform,
      status: channelCollectionState.status,
      outcome: channelCollectionState.outcome,
      nextAttemptAt: channelCollectionState.nextAttemptAt,
      leaseUntil: channelCollectionState.leaseUntil,
      updatedAt: channelCollectionState.updatedAt,
    })
    .from(channelCollectionState)
    .innerJoin(channels, eq(channels.id, channelCollectionState.channelId))
    .innerJoin(companies, eq(companies.id, channels.companyId))
    .where(inArray(channelCollectionState.channelId, channelIds));

  const now = new Date();
  const items = rows.map((state): RefreshActivityItem => {
    const phase = refreshActivityPhaseForState({
      status: state.status,
      outcome: state.outcome,
      nextAttemptAt: state.nextAttemptAt,
      leaseUntil: state.leaseUntil,
      now,
    });
    return {
      channelId: state.channelId,
      companyName: state.companyName,
      handle: state.handle,
      platform: state.platform,
      phase,
      updatedAt: state.updatedAt.toISOString(),
      nextAttemptAt: state.nextAttemptAt?.toISOString() ?? null,
    };
  });

  const byUpdatedDesc = (a: RefreshActivityItem, b: RefreshActivityItem) => (
    b.updatedAt.localeCompare(a.updatedAt) || a.companyName.localeCompare(b.companyName)
  );
  const collecting = items
    .filter((item) => item.phase === 'collecting')
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  const queuedNext = items
    .filter((item) => item.phase === 'queued' || item.phase === 'waiting')
    .sort((a, b) => {
      if (a.phase !== b.phase) return a.phase === 'queued' ? -1 : 1;
      return (a.nextAttemptAt ?? '').localeCompare(b.nextAttemptAt ?? '')
        || a.companyName.localeCompare(b.companyName);
    });
  const recent = items
    .filter((item) => (
      item.phase === 'completed'
      || item.phase === 'source_limited'
      || item.phase === 'needs_attention'
    ) && new Date(item.updatedAt) >= row.createdAt)
    .sort(byUpdatedDesc);
  return {
    collecting: collecting.slice(0, REFRESH_WAVE_SIZE),
    queuedNext: queuedNext.slice(0, 6),
    recent: recent.slice(0, 8),
  };
}

async function progressForRow(row: RefreshJobRow): Promise<CollectionQueueStatus> {
  const channelIds = rowChannelIds(row);
  if (channelIds.length === 0) return emptyProgress();
  const platforms = parseRefreshPlatforms(row.platforms);
  return getCollectionQueueStatus({
    orgId: row.orgId,
    landscapeId: row.landscapeId,
    channelIds,
    platforms: platforms.length > 0 ? platforms : undefined,
  });
}

function snapshotFrom(
  row: RefreshJobRow,
  progress: CollectionQueueStatus,
  activity: RefreshActivity,
): RefreshJobSnapshot {
  const status = rowStatus(row);
  const final = isTerminalStatus(status) ? storedFinalSnapshot(row) : null;
  const visibleProgress = isTerminalStatus(status) ? terminalProgress(row) : progress;
  const visibleActivity = final?.activity ?? (isTerminalStatus(status) ? emptyActivity() : activity);
  return {
    id: row.id,
    landscapeId: row.landscapeId,
    scopeKey: row.scopeKey,
    platforms: parseRefreshPlatforms(row.platforms),
    status,
    total: row.totalProfiles,
    settled: settledProfiles(row.totalProfiles, visibleProgress.remaining),
    remaining: visibleProgress.remaining,
    runnableNow: visibleProgress.runnableNow,
    running: visibleProgress.running,
    waitingForRetry: visibleProgress.waitingForRetry,
    blocked: visibleProgress.blocked,
    sourceLimited: visibleProgress.sourceLimited,
    nextReadyAt: visibleProgress.nextReadyAt?.toISOString() ?? null,
    requiredSince: row.requiredSince.toISOString(),
    requiredUntil: row.requiredUntil.toISOString(),
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    lastError: row.lastError,
    activity: visibleActivity,
  };
}

async function findJobByIdempotency(
  orgId: string,
  idempotencyKey: string,
): Promise<RefreshJobRow | null> {
  const [row] = await db
    .select()
    .from(refreshJobs)
    .where(and(
      eq(refreshJobs.orgId, orgId),
      eq(refreshJobs.idempotencyKey, idempotencyKey),
    ))
    .limit(1);
  return row ?? null;
}

async function findActiveJob(
  orgId: string,
  scopeKey: string,
): Promise<RefreshJobRow | null> {
  const [row] = await db
    .select()
    .from(refreshJobs)
    .where(and(
      eq(refreshJobs.orgId, orgId),
      eq(refreshJobs.scopeKey, scopeKey),
      inArray(refreshJobs.status, ACTIVE_STATUSES),
    ))
    .orderBy(desc(refreshJobs.createdAt))
    .limit(1);
  return row ?? null;
}

async function reconcileRow(
  row: RefreshJobRow,
  options: { includeActivity?: boolean } = {},
): Promise<{ row: RefreshJobRow; progress: CollectionQueueStatus; activity: RefreshActivity }> {
  const current = rowStatus(row);
  if (isTerminalStatus(current)) {
    return {
      row,
      progress: terminalProgress(row),
      activity: storedFinalSnapshot(row)?.activity ?? emptyActivity(),
    };
  }
  const includeActivity = options.includeActivity ?? true;
  const [progress, initialActivity] = await Promise.all([
    progressForRow(row),
    includeActivity ? activityForRow(row) : Promise.resolve(emptyActivity()),
  ]);
  const status = refreshStatusFromProgress(current, progress);
  if (status === current) return { row, progress, activity: initialActivity };

  const terminal = status === 'completed' || status === 'completed_with_issues';
  const activity = terminal && !includeActivity ? await activityForRow(row) : initialActivity;
  const [updated] = await db
    .update(refreshJobs)
    .set({
      status,
      finishedAt: terminal ? new Date() : row.finishedAt,
      workerLeaseToken: terminal ? null : row.workerLeaseToken,
      workerLeaseUntil: terminal ? null : row.workerLeaseUntil,
      nextWakeAt: terminal ? null : row.nextWakeAt,
      finalSnapshot: terminal ? {
        blocked: progress.blocked,
        sourceLimited: progress.sourceLimited,
        activity,
      } satisfies StoredFinalSnapshot : row.finalSnapshot,
      updatedAt: new Date(),
    })
    .where(eq(refreshJobs.id, row.id))
    .returning();
  return { row: updated ?? row, progress, activity };
}

export async function getRefreshJobForOrg(
  jobId: string,
  orgId: string,
): Promise<RefreshJobSnapshot | null> {
  const [row] = await db
    .select()
    .from(refreshJobs)
    .where(and(eq(refreshJobs.id, jobId), eq(refreshJobs.orgId, orgId)))
    .limit(1);
  if (!row) return null;
  const reconciled = await reconcileRow(row);
  return snapshotFrom(reconciled.row, reconciled.progress, reconciled.activity);
}

export async function getActiveRefreshJobForScope(input: {
  orgId: string;
  landscapeId: string;
  platforms?: readonly Platform[];
  since: Date;
  until: Date;
}): Promise<RefreshJobSnapshot | null> {
  const platforms = canonicalRefreshPlatforms(input.platforms);
  const row = await findActiveJob(
    input.orgId,
    refreshCoordinatorScopeKey(input.landscapeId),
  );
  if (!row) return null;
  const reconciled = await reconcileRow(row);
  return isActiveRefreshStatus(rowStatus(reconciled.row))
    && rowCoversRequest(reconciled.row, {
      platforms,
      since: input.since,
      until: input.until,
    })
    ? snapshotFrom(reconciled.row, reconciled.progress, reconciled.activity)
    : null;
}

/** Status-only shell lookup: show any active coordinator for this landscape. */
export async function getActiveRefreshJobForLandscape(input: {
  orgId: string;
  landscapeId: string;
}): Promise<RefreshJobSnapshot | null> {
  const row = await findActiveJob(
    input.orgId,
    refreshCoordinatorScopeKey(input.landscapeId),
  );
  if (!row) return null;
  const reconciled = await reconcileRow(row);
  return isActiveRefreshStatus(rowStatus(reconciled.row))
    ? snapshotFrom(reconciled.row, reconciled.progress, reconciled.activity)
    : null;
}

async function expandActiveRefreshJob(
  row: RefreshJobRow,
  input: StartRefreshJobInput,
  requestedPlatforms: Platform[],
): Promise<RefreshJobRow | null> {
  const priorScopes = requestScopesForRow(row);
  const candidates: readonly Platform[] = requestedPlatforms.length > 0
    ? requestedPlatforms
    : ADAPTER_SUPPORTED_PLATFORMS;
  const queuePlatforms = candidates.filter((platform) => !priorScopes.some((scope) => (
    refreshScopeCoversPlatform(scope, platform, input.since, input.until)
  )));
  const enqueued = queuePlatforms.length > 0
    ? await enqueueLandscapeCollection({
        orgId: input.orgId,
        landscapeId: input.landscapeId,
        platforms: queuePlatforms,
        since: input.since,
        until: input.until,
        force: false,
      })
    : { queued: 0, channelIds: [] };

  const incomingChannelIds = JSON.stringify(enqueued.channelIds);
  const incomingPlatforms = JSON.stringify(requestedPlatforms);
  const incomingRequestScope = JSON.stringify([storedRequestScope({
    platforms: requestedPlatforms,
    since: input.since,
    until: input.until,
  })]);
  const mergedChannelIds = sql`(
    SELECT coalesce(jsonb_agg(value ORDER BY value), '[]'::jsonb)
      FROM (
        SELECT DISTINCT jsonb_array_elements_text(
          ${refreshJobs.channelIds} || ${incomingChannelIds}::jsonb
        ) AS value
      ) merged_channel_values
  )`;
  const mergedPlatformsSql = requestedPlatforms.length === 0
    ? sql`'[]'::jsonb`
    : sql`CASE
        WHEN jsonb_array_length(${refreshJobs.platforms}) = 0 THEN '[]'::jsonb
        ELSE (
          SELECT coalesce(jsonb_agg(value ORDER BY value), '[]'::jsonb)
            FROM (
              SELECT DISTINCT jsonb_array_elements_text(
                ${refreshJobs.platforms} || ${incomingPlatforms}::jsonb
              ) AS value
            ) merged_platform_values
        )
      END`;
  const mergedRequestScopes = sql`(
    SELECT coalesce(jsonb_agg(value), '[]'::jsonb)
      FROM (
        SELECT DISTINCT value
          FROM jsonb_array_elements(
            ${refreshJobs.requestScopes} || ${incomingRequestScope}::jsonb
          ) AS value
      ) merged_request_scopes
  )`;
  const now = new Date();
  const [updated] = await db
    .update(refreshJobs)
    .set({
      platforms: mergedPlatformsSql,
      requestScopes: mergedRequestScopes,
      channelIds: mergedChannelIds,
      requiredSince: sql`least(${refreshJobs.requiredSince}, ${input.since})`,
      requiredUntil: sql`greatest(${refreshJobs.requiredUntil}, ${input.until})`,
      totalProfiles: sql`jsonb_array_length(${mergedChannelIds})`,
      nextWakeAt: now,
      finishedAt: null,
      updatedAt: now,
    })
    .where(and(
      eq(refreshJobs.id, row.id),
      inArray(refreshJobs.status, ACTIVE_STATUSES),
    ))
    .returning();
  return updated ?? null;
}

/**
 * Queue every profile before creating the user-visible coordinator. Overlapping
 * platform/window requests coalesce into one active landscape job so switching
 * pages cannot repurchase a profile that the same refresh just settled.
 */
export async function startLandscapeRefresh(
  input: StartRefreshJobInput,
): Promise<{ snapshot: RefreshJobSnapshot; reused: boolean }> {
  const platforms = canonicalRefreshPlatforms(input.platforms);
  const fingerprint = requestFingerprint({ ...input, platforms });
  const scopeKey = refreshCoordinatorScopeKey(input.landscapeId);
  const priorByKey = await findJobByIdempotency(input.orgId, input.idempotencyKey);
  if (priorByKey) {
    if (priorByKey.requestFingerprint !== fingerprint) {
      throw new RefreshIdempotencyConflictError();
    }
    const reconciled = await reconcileRow(priorByKey);
    return {
      snapshot: snapshotFrom(reconciled.row, reconciled.progress, reconciled.activity),
      reused: true,
    };
  }

  const active = await findActiveJob(input.orgId, scopeKey);
  if (active) {
    const reconciled = await reconcileRow(active);
    if (isActiveRefreshStatus(rowStatus(reconciled.row))) {
      if (!rowCoversRequest(reconciled.row, {
        platforms,
        since: input.since,
        until: input.until,
      })) {
        const expanded = await expandActiveRefreshJob(reconciled.row, input, platforms);
        if (expanded) {
          const expandedState = await reconcileRow(expanded);
          return {
            snapshot: snapshotFrom(
              expandedState.row,
              expandedState.progress,
              expandedState.activity,
            ),
            reused: true,
          };
        }
      } else {
        return {
          snapshot: snapshotFrom(reconciled.row, reconciled.progress, reconciled.activity),
          reused: true,
        };
      }
    }
  }

  const effectivePlatforms = platforms.length > 0
    ? platforms
    : [...ADAPTER_SUPPORTED_PLATFORMS];
  const enqueued = await enqueueLandscapeCollection({
    orgId: input.orgId,
    landscapeId: input.landscapeId,
    platforms: effectivePlatforms,
    since: input.since,
    until: input.until,
    force: false,
  });
  const initialStatus: RefreshJobStatus = enqueued.channelIds.length > 0 ? 'queued' : 'completed';
  const now = new Date();
  const emptyFinal: StoredFinalSnapshot = {
    blocked: 0,
    sourceLimited: 0,
    activity: emptyActivity(),
  };
  const [created] = await db
    .insert(refreshJobs)
    .values({
      orgId: input.orgId,
      landscapeId: input.landscapeId,
      requestedByUserId: input.userId,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint: fingerprint,
      scopeKey,
      requestScopes: [storedRequestScope({
        platforms,
        since: input.since,
        until: input.until,
      })],
      platforms,
      channelIds: enqueued.channelIds,
      requiredSince: input.since,
      requiredUntil: input.until,
      status: initialStatus,
      totalProfiles: enqueued.channelIds.length,
      nextWakeAt: initialStatus === 'queued' ? now : null,
      finalSnapshot: initialStatus === 'completed' ? emptyFinal : null,
      finishedAt: initialStatus === 'completed' ? now : null,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning();

  if (created) {
    const reconciled = await reconcileRow(created);
    return {
      snapshot: snapshotFrom(reconciled.row, reconciled.progress, reconciled.activity),
      reused: false,
    };
  }

  const priorAfterRace = await findJobByIdempotency(input.orgId, input.idempotencyKey);
  if (priorAfterRace) {
    if (priorAfterRace.requestFingerprint !== fingerprint) {
      throw new RefreshIdempotencyConflictError();
    }
    const reconciled = await reconcileRow(priorAfterRace);
    return {
      snapshot: snapshotFrom(reconciled.row, reconciled.progress, reconciled.activity),
      reused: true,
    };
  }

  const activeAfterRace = await findActiveJob(input.orgId, scopeKey);
  if (activeAfterRace) {
    const expanded = rowCoversRequest(activeAfterRace, {
      platforms,
      since: input.since,
      until: input.until,
    })
      ? activeAfterRace
      : await expandActiveRefreshJob(activeAfterRace, input, platforms);
    if (expanded) {
      const reconciled = await reconcileRow(expanded);
      return {
        snapshot: snapshotFrom(reconciled.row, reconciled.progress, reconciled.activity),
        reused: true,
      };
    }
  }
  throw new Error('Refresh work was queued but its coordinator row could not be recovered.');
}

export interface AutomaticRefreshCoordinatorSummary {
  landscapes: number;
  active: number;
  reused: number;
}

/**
 * Give each landscape a durable, tenant-scoped monitor for the global scheduled
 * pass. Queue reconciliation remains pooled, so shared profiles are still
 * purchased only once even though each landscape can observe its own progress.
 */
export async function startAutomaticRefreshCoordinators(
  now = new Date(),
): Promise<AutomaticRefreshCoordinatorSummary> {
  const landscapeRows = await db
    .select({ id: landscapes.id, orgId: landscapes.orgId })
    .from(landscapes)
    .orderBy(landscapes.id);
  const since = new Date(
    now.getTime() - AUTOMATIC_REFRESH_HISTORY_DAYS * 86_400_000,
  );
  const bucket = now.toISOString().slice(0, 13);
  let active = 0;
  let reused = 0;

  for (const landscape of landscapeRows) {
    const started = await startLandscapeRefresh({
      orgId: landscape.orgId,
      userId: null,
      landscapeId: landscape.id,
      since,
      until: now,
      idempotencyKey: 'automatic:' + bucket + ':' + landscape.id,
    });
    if (isActiveRefreshStatus(started.snapshot.status)) active += 1;
    if (started.reused) reused += 1;
  }

  return { landscapes: landscapeRows.length, active, reused };
}

async function claimRefreshJob(jobId: string): Promise<{
  row: RefreshJobRow;
  leaseToken: string;
} | null> {
  const now = new Date();
  const leaseToken = randomUUID();
  const [row] = await db
    .update(refreshJobs)
    .set({
      status: 'running',
      workerLeaseToken: leaseToken,
      workerLeaseUntil: new Date(now.getTime() + REFRESH_JOB_LEASE_MS),
      startedAt: sql`coalesce(${refreshJobs.startedAt}, ${now})`,
      lastError: null,
      updatedAt: now,
    })
    .where(and(
      eq(refreshJobs.id, jobId),
      inArray(refreshJobs.status, ACTIVE_STATUSES),
      or(isNull(refreshJobs.workerLeaseUntil), lte(refreshJobs.workerLeaseUntil, now)),
    ))
    .returning();
  return row ? { row, leaseToken } : null;
}

async function finishRefreshJobLease(input: {
  row: RefreshJobRow;
  leaseToken: string;
  progress: CollectionQueueStatus;
  activity: RefreshActivity;
}): Promise<RefreshJobRow | null> {
  const status = refreshStatusFromProgress('running', input.progress);
  const terminal = status === 'completed' || status === 'completed_with_issues';
  const nextWakeAt = terminal
    ? null
    : input.progress.runnableNow > 0
      ? new Date()
      : input.progress.nextReadyAt;
  const [updated] = await db
    .update(refreshJobs)
    .set({
      status,
      workerLeaseToken: null,
      workerLeaseUntil: null,
      nextWakeAt,
      finalSnapshot: terminal ? {
        blocked: input.progress.blocked,
        sourceLimited: input.progress.sourceLimited,
        activity: input.activity,
      } satisfies StoredFinalSnapshot : null,
      finishedAt: terminal ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(and(
      eq(refreshJobs.id, input.row.id),
      eq(refreshJobs.workerLeaseToken, input.leaseToken),
    ))
    .returning();
  return updated ?? null;
}

async function releaseRefreshJobLeaseAfterError(
  jobId: string,
  leaseToken: string,
): Promise<void> {
  await db
    .update(refreshJobs)
    .set({
      // The coordinator stopped, not the durable profile queue. Keep this job
      // discoverable and pollable so the recurring worker can resume it
      // without a second click force-enqueueing profiles that already settled.
      status: 'queued',
      workerLeaseToken: null,
      workerLeaseUntil: null,
      lastError: 'A background worker paused unexpectedly. Queued profile work is safe and scheduled to resume.',
      nextWakeAt: new Date(Date.now() + 5 * 60_000),
      finishedAt: null,
      updatedAt: new Date(),
    })
    .where(and(
      eq(refreshJobs.id, jobId),
      eq(refreshJobs.workerLeaseToken, leaseToken),
    ));
}

/** One coordinator invocation owns one bounded vendor wave. */
export async function processRefreshJobWave(
  jobId: string,
): Promise<ProcessRefreshWaveResult> {
  const claim = await claimRefreshJob(jobId);
  if (!claim) return { claimed: false, dispatchNext: false, snapshot: null };

  const channelIds = rowChannelIds(claim.row);
  const platforms = parseRefreshPlatforms(claim.row.platforms);
  try {
    await runCollectionQueue({
      orgId: claim.row.orgId,
      landscapeId: claim.row.landscapeId,
      channelIds,
      platforms: platforms.length > 0 ? platforms : undefined,
      maxChannels: REFRESH_WAVE_SIZE,
      postLimit: 500,
    });
    const progress = await progressForRow(claim.row);
    const activity = await activityForRow(claim.row);
    const updated = await finishRefreshJobLease({
      row: claim.row,
      leaseToken: claim.leaseToken,
      progress,
      activity,
    });
    if (!updated) return { claimed: true, dispatchNext: false, snapshot: null };
    return {
      claimed: true,
      dispatchNext: shouldDispatchNextWave(progress),
      snapshot: snapshotFrom(updated, progress, activity),
    };
  } catch (error) {
    await releaseRefreshJobLeaseAfterError(claim.row.id, claim.leaseToken);
    console.error('[data-dumpster:refresh-job] background wave failed', {
      jobId: claim.row.id,
      error,
    });
    return {
      claimed: true,
      dispatchNext: false,
      snapshot: await getRefreshJobForOrg(claim.row.id, claim.row.orgId),
    };
  }
}

/** Reconcile active rows after the recurring queue worker acts as a safety net. */
export async function reconcileActiveRefreshJobs(limit = 100): Promise<number> {
  const rows = await db
    .select()
    .from(refreshJobs)
    .where(inArray(refreshJobs.status, ACTIVE_STATUSES))
    .orderBy(refreshJobs.createdAt)
    .limit(limit);
  let completed = 0;
  for (const row of rows) {
    const reconciled = await reconcileRow(row, { includeActivity: false });
    if (!isActiveRefreshStatus(rowStatus(reconciled.row))) completed += 1;
  }
  return completed;
}

/**
 * Reserve one due recovery wake atomically. Moving its wake time forward before
 * dispatch prevents one broken job from starving newer work and keeps separate
 * Vercel invocations from multiplying the in-memory vendor concurrency gates.
 */
export async function claimRefreshRecoveryWake(): Promise<string | null> {
  const result = await db.execute<{ id: string } & Record<string, unknown>>(sql`
    WITH candidate AS (
      SELECT id
        FROM refresh_jobs
       WHERE status IN ('queued', 'running')
         AND (worker_lease_until IS NULL OR worker_lease_until <= now())
         AND (next_wake_at IS NULL OR next_wake_at <= now())
       ORDER BY coalesce(next_wake_at, created_at), created_at
       FOR UPDATE SKIP LOCKED
       LIMIT 1
    )
    UPDATE refresh_jobs job
       SET next_wake_at = now() + interval '5 minutes',
           updated_at = now()
      FROM candidate
     WHERE job.id = candidate.id
    RETURNING job.id
  `);
  return result.rows[0]?.id ?? null;
}
