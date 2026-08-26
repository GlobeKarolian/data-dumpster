import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  channelCollectionState,
  channels,
  landscapeChannelDemands,
  landscapeCompanies,
  landscapes,
} from '@/db/schema';
import type { Platform } from '@/lib/types';
import type { CollectionOutcome } from './types';
import {
  runChannelIngest,
  type ChannelRunResult,
  type PlatformSummary,
} from './runner';
import { getAdapter, hasAdapter } from './registry';
import {
  ESTIMATED_CALLS_PER_RUN,
  MAX_RATE_WAIT_MS,
  RateGate,
} from './rate-gate';
import { TokenFencedLeaseHeartbeat } from './lease-heartbeat';
import {
  AUTOMATIC_REFRESH_INTERVAL_MS,
  automaticRefreshWindowStart,
} from './automatic-refresh';

const DEFAULT_HISTORY_DAYS = 90;
const DEFAULT_FRESH_MS = AUTOMATIC_REFRESH_INTERVAL_MS;
/*
 * Ten, because this work is waiting rather than computing.
 *
 * Every item here is an outbound HTTP call that spends almost all of its time
 * idle. Four workers left a 300-second request mostly blocked on sockets while
 * channels queued behind it lost the day.
 *
 * The measured shape of a full pass over 138 channels: 965 seconds of serial
 * wall time, which is 241s at four workers and 96s at ten. That number hides
 * the real problem, though. Facebook's median run is 3.1s and its p90 is 126.8s
 * because the median is dominated by calls that failed instantly; a Facebook
 * page that actually collects costs about two minutes, roughly forty times
 * every other platform. Twenty-three of them at four workers is 730 seconds,
 * more than two whole runs for one platform, which is why competitor Facebook
 * pages sat at the same follower count for five days.
 *
 * Raising this is safe in a way it would not have been a week ago: per-platform
 * rate gates still throttle each vendor independently, and an unfinished Bright
 * Data snapshot is now resumable, so a worker that runs out of time hands the
 * job to the next run instead of forfeiting it.
 */
const DEFAULT_CONCURRENCY = 10;
// A Vercel request is capped at five minutes. The heartbeat renews this duration
// every two minutes while a request or CLI process is alive; after a crash, the
// final renewal still becomes reclaimable promptly.
const LEASE_MS = 6 * 60 * 1_000;

interface QueueTarget {
  channelId: string;
  orgId: string;
}

interface DemandRow extends QueueTarget {
  landscapeId: string;
  companyId: string;
  requiredSince: Date;
  requiredUntil: Date;
}

interface PooledDemandWindow extends QueueTarget {
  landscapeIds: string[];
  requiredSince: Date;
  requiredUntil: Date;
}

interface ClaimedItem extends Record<string, unknown> {
  channel_id: string;
  lease_token: string;
  platform: Platform;
  handle: string;
  company_name: string;
  requested_by_org_id: string | null;
  required_since: Date | string;
  required_until: Date | string;
  coverage_since: Date | string | null;
  coverage_until: Date | string | null;
  attempted_until: Date | string | null;
  outcome: CollectionOutcome | null;
  has_more: boolean;
  last_error: string | null;
  attempts: number | string;
}

export interface CollectionQueueSummary {
  attempted: number;
  succeeded: number;
  failed: number;
  skipped: number;
  partial: number;
  postsUpserted: number;
  durationMs: number;
  /** Work that can still be claimed now or after its retry backoff. */
  remaining: number;
  /** Terminal operational failures that require an operator or vendor change. */
  blocked: number;
  /** Settled reads whose public source cannot certify the full requested window. */
  sourceLimited: number;
  complete: boolean;
  byPlatform: Partial<Record<Platform, PlatformSummary>>;
  results: ChannelRunResult[];
}

export interface CollectionQueueStatus {
  /** Active demanded profiles inside this exact scope. */
  total: number;
  /** Profiles that still have runnable, leased, or delayed work. */
  remaining: number;
  /** Profiles a worker can claim at this moment. */
  runnableNow: number;
  /** Profiles currently held by a live worker lease. */
  running: number;
  /** Remaining profiles whose retry/backoff is not ready yet. */
  waitingForRetry: number;
  /** Earliest delayed retry or expired-lease recovery time. */
  nextReadyAt: Date | null;
  /** Terminal operational failures that need an operator or vendor change. */
  blocked: number;
  /** Settled reads whose source cannot certify the full requested window. */
  sourceLimited: number;
}

function daysAgo(days: number, from = new Date()): Date {
  return new Date(from.getTime() - days * 86_400_000);
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function collectionRunSince(input: {
  requiredSince: Date;
  coverageSince: Date | null;
  coverageUntil: Date | null;
  attemptedUntil?: Date | null;
  outcome?: CollectionOutcome | null;
  hasMore: boolean;
}): Date {
  if (input.hasMore) return input.requiredSince;

  // Certified coverage can move forward incrementally only when it already
  // reaches the requested lower bound. If the requested history expands, the
  // new boundary must be backfilled before the window can be certified.
  if (input.coverageSince !== null) {
    const canRefreshCertifiedWindow = input.coverageUntil !== null
      && input.coverageSince <= input.requiredSince;
    if (canRefreshCertifiedWindow && input.coverageUntil) {
      return new Date(Math.max(
        input.requiredSince.getTime(),
        input.coverageUntil.getTime() - 2 * 86_400_000,
      ));
    }
    // A recent exhaustive suffix may coexist with older history the source
    // already proved it cannot expose. Keep refreshing from the attempt
    // watermark; falling back to requiredSince would buy that same capped
    // historical snapshot on every scheduled run.
    if (input.outcome !== 'terminal_source_limitation') return input.requiredSince;
  }

  // A terminally limited source still needs fresh audience/posts later. Its
  // attempt watermark permits a cheap two-day overlap without pretending that
  // the older, uncertified history became coverage.
  // Operational/permanent failures never advance attemptedUntil. If a retry
  // still has one, it came from an earlier settled source response and remains
  // the correct freshness watermark through a transient failure.
  const limitedAttempt = input.attemptedUntil ?? null;
  return limitedAttempt
    ? new Date(Math.max(
        input.requiredSince.getTime(),
        limitedAttempt.getTime() - 2 * 86_400_000,
      ))
    : input.requiredSince;
}

/**
 * The suffix a terminally limited settle may keep fresh. The attempt must
 * reach back into the certified window (no gap to vouch for) and push past
 * its right edge (otherwise there is nothing to extend). The left edge is
 * never touched: only a certified crawl may add older history.
 */
function extendedTerminalSuffix(input: {
  attemptedSince: Date | null;
  attemptedUntil: Date | null;
  coverageSince: Date | null;
  coverageUntil: Date | null;
}): { since: Date; until: Date } | null {
  if (!input.attemptedSince || !input.attemptedUntil) return null;
  if (!input.coverageSince || !input.coverageUntil) return null;
  if (input.attemptedSince > input.coverageUntil) return null;
  if (input.attemptedUntil <= input.coverageUntil) return null;
  return { since: input.coverageSince, until: input.attemptedUntil };
}

interface QueueDisposition {
  status: 'succeeded' | 'partial' | 'failed';
  schedule: 'none' | 'immediate' | 'backoff';
  advancesAttemptWatermark: boolean;
  mayAdvanceCoverage: boolean;
}

function queueDisposition(outcome: CollectionOutcome): QueueDisposition {
  switch (outcome) {
    case 'certified_complete':
      return {
        status: 'succeeded', schedule: 'none',
        advancesAttemptWatermark: true, mayAdvanceCoverage: true,
      };
    case 'continuation':
      return {
        status: 'partial', schedule: 'immediate',
        advancesAttemptWatermark: true, mayAdvanceCoverage: false,
      };
    case 'terminal_source_limitation':
      return {
        status: 'partial', schedule: 'none',
        advancesAttemptWatermark: true, mayAdvanceCoverage: false,
      };
    case 'retryable_operational_failure':
      return {
        status: 'failed', schedule: 'backoff',
        advancesAttemptWatermark: false, mayAdvanceCoverage: false,
      };
    case 'permanent_failure':
      return {
        status: 'failed', schedule: 'none',
        advancesAttemptWatermark: false, mayAdvanceCoverage: false,
      };
  }
}

/**
 * Consecutive failed attempts before a retryable failure stops itself.
 *
 * Backoff alone caps at sixty minutes and never ends, so a channel whose
 * vendor answer is wrong every time would become an hourly paid crawl forever,
 * which is exactly the infinite purchase loop the outcome model exists to
 * prevent. Twelve consecutive failures is at least nine hours of continuous
 * refusal in backoff terms and, under the twice-daily windows, spread over
 * several days in practice. After that this stops asking the vendor and asks a
 * person instead.
 *
 * The ceiling counts CONSECUTIVE failures because attempts now reset when a
 * claim settles usefully. A vendor outage therefore self-heals: the first
 * success after the outage returns the counter to zero.
 */
const MAX_CONSECUTIVE_RETRYABLE_ATTEMPTS = 12;

function escalateRetryableOutcome(
  outcome: CollectionOutcome,
  consecutiveAttempts: number,
): CollectionOutcome {
  if (outcome !== 'retryable_operational_failure') return outcome;
  return consecutiveAttempts >= MAX_CONSECUTIVE_RETRYABLE_ATTEMPTS
    ? 'permanent_failure'
    : outcome;
}

export const collectionQueueTestHelpers = {
  collectionRunSince,
  extendedTerminalSuffix,
  queueDisposition,
  escalateRetryableOutcome,
  MAX_CONSECUTIVE_RETRYABLE_ATTEMPTS,
  mergeCertifiedCoverage,
  poolDemandWindows,
  demandWindowIsCovered,
  demandRegistrationNeedsQueue,
  demandExpandedDuringClaim,
  assertValidDemandWindow,
};

function assertValidDemandWindow(window: { since: Date; until: Date }): void {
  if (
    !Number.isFinite(window.since.getTime())
    || !Number.isFinite(window.until.getTime())
    || window.since > window.until
  ) {
    throw new RangeError('Collection demand requires valid dates with since <= until.');
  }
}

function poolDemandWindows(rows: readonly DemandRow[]): PooledDemandWindow[] {
  const byChannel = new Map<string, PooledDemandWindow>();
  for (const row of rows) {
    const existing = byChannel.get(row.channelId);
    if (!existing) {
      byChannel.set(row.channelId, {
        channelId: row.channelId,
        orgId: row.orgId,
        landscapeIds: [row.landscapeId],
        requiredSince: row.requiredSince,
        requiredUntil: row.requiredUntil,
      });
      continue;
    }
    if (!existing.landscapeIds.includes(row.landscapeId)) {
      existing.landscapeIds.push(row.landscapeId);
    }
    if (row.requiredSince < existing.requiredSince) existing.requiredSince = row.requiredSince;
    if (row.requiredUntil > existing.requiredUntil) existing.requiredUntil = row.requiredUntil;
    if (row.orgId < existing.orgId) existing.orgId = row.orgId;
  }
  return [...byChannel.values()];
}

function demandWindowIsCovered(input: {
  requiredSince: Date;
  requiredUntil: Date;
  coverageSince: Date | null;
  coverageUntil: Date | null;
}): boolean {
  return input.coverageSince !== null
    && input.coverageUntil !== null
    && input.coverageSince <= input.requiredSince
    && input.coverageUntil >= input.requiredUntil;
}

function demandRegistrationNeedsQueue(input: {
  force: boolean;
  now: Date;
  staleBefore: Date;
  status: 'queued' | 'running' | 'succeeded' | 'partial' | 'failed';
  outcome: CollectionOutcome | null;
  hasMore: boolean;
  nextAttemptAt: Date | null;
  leaseUntil: Date | null;
  existingRequiredSince: Date;
  existingRequiredUntil: Date;
  demandedSince: Date;
  demandedUntil: Date;
  coverageSince: Date | null;
  coverageUntil: Date | null;
  attemptedUntil: Date | null;
}): boolean {
  if (input.leaseUntil && input.leaseUntil > input.now) return false;
  if (input.force) return true;
  if (input.nextAttemptAt && input.nextAttemptAt > input.now) return false;
  if (
    input.status === 'failed'
    && input.nextAttemptAt === null
    && (input.outcome === null || input.outcome === 'permanent_failure')
  ) return false;
  const watermark = input.attemptedUntil ?? input.coverageUntil;
  if (
    input.outcome === 'terminal_source_limitation'
    && watermark !== null
    && watermark >= input.staleBefore
  ) return false;

  const mergedWindow = {
    requiredSince: new Date(Math.min(
      input.existingRequiredSince.getTime(),
      input.demandedSince.getTime(),
    )),
    requiredUntil: new Date(Math.max(
      input.existingRequiredUntil.getTime(),
      input.demandedUntil.getTime(),
    )),
    coverageSince: input.coverageSince,
    coverageUntil: input.coverageUntil,
  };
  if (
    input.status === 'succeeded'
    && !input.hasMore
    && demandWindowIsCovered(mergedWindow)
  ) return false;

  // A newly requested earlier boundary is real uncovered work even when the
  // latest source attempt is fresh. A moving right edge is refreshed by the
  // normal freshness cadence instead of re-buying a crawl for every landscape.
  if (input.demandedSince < input.existingRequiredSince) return true;
  return input.nextAttemptAt !== null
    || watermark === null
    || watermark < input.staleBefore;
}

function demandExpandedDuringClaim(input: {
  claimedSince: Date;
  claimedUntil: Date;
  pooledDemandSince: Date;
  pooledDemandUntil: Date;
}): boolean {
  // A moving right edge is normal wall-clock freshness and waits for cadence.
  // Only newly requested historical depth warrants an immediate follow-up.
  return input.pooledDemandSince < input.claimedSince;
}

async function writeDemands(
  rows: readonly Omit<DemandRow, 'requiredSince' | 'requiredUntil'>[],
  window: { since: Date; until: Date },
): Promise<DemandRow[]> {
  assertValidDemandWindow(window);
  const uniqueRows = [...new Map(
    rows.map((row) => [row.landscapeId + ':' + row.channelId, row]),
  ).values()];
  if (uniqueRows.length === 0) return [];

  await db.insert(landscapeChannelDemands).values(uniqueRows.map((row) => ({
    landscapeId: row.landscapeId,
    companyId: row.companyId,
    channelId: row.channelId,
    requiredSince: window.since,
    requiredUntil: window.until,
  }))).onConflictDoUpdate({
    target: [landscapeChannelDemands.landscapeId, landscapeChannelDemands.channelId],
    set: {
      // A routine 90-day sweep must not erase a landscape's earlier explicit
      // 365-day request. Demand shrinks only when its membership row is removed.
      requiredSince: sql`least(${landscapeChannelDemands.requiredSince}, ${window.since})`,
      requiredUntil: sql`greatest(${landscapeChannelDemands.requiredUntil}, ${window.until})`,
      updatedAt: new Date(),
    },
  });

  return uniqueRows.map((row) => ({
    ...row,
    requiredSince: window.since,
    requiredUntil: window.until,
  }));
}

async function enqueueDemandedChannels(
  channelIds: readonly string[],
  options: { force: boolean; staleBefore?: Date },
): Promise<number> {
  const uniqueChannelIds = [...new Set(channelIds)];
  if (uniqueChannelIds.length === 0) return 0;
  const channelFilter = sql`AND demand.channel_id IN (${sql.join(
    uniqueChannelIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  )})`;
  const staleBefore = options.staleBefore ?? new Date(0);
  const preserveCurrentJobWindow = sql`(
    channel_collection_state.lease_until > now()
    OR channel_collection_state.outcome = 'continuation'
    OR (
      NOT ${options.force}
      AND (
        (
          channel_collection_state.status = 'failed'
          AND channel_collection_state.next_attempt_at IS NULL
          AND (
            channel_collection_state.outcome IS NULL
            OR channel_collection_state.outcome = 'permanent_failure'
          )
        )
        OR (
          channel_collection_state.outcome = 'terminal_source_limitation'
          AND coalesce(
            channel_collection_state.attempted_until,
            channel_collection_state.coverage_until
          ) >= ${staleBefore}
        )
        OR (
          channel_collection_state.status = 'succeeded'
          AND NOT channel_collection_state.has_more
          AND channel_collection_state.coverage_since <= least(
            channel_collection_state.required_since,
            excluded.required_since
          )
          AND channel_collection_state.coverage_until >= greatest(
            channel_collection_state.required_until,
            excluded.required_until
          )
        )
        OR (
          excluded.required_since >= channel_collection_state.required_since
          AND coalesce(
            channel_collection_state.attempted_until,
            channel_collection_state.coverage_until
          ) >= ${staleBefore}
        )
      )
    )
  )`;

  const result = await db.execute<{
    channel_id: string;
    status: 'queued' | 'running' | 'succeeded' | 'partial' | 'failed';
    next_attempt_at: Date | string | null;
  }>(sql`
    WITH demanded AS MATERIALIZED (
      SELECT demand.channel_id,
             min(demand.required_since) AS required_since,
             max(demand.required_until) AS required_until,
             (array_agg(landscape.org_id ORDER BY landscape.org_id))[1]
               AS requested_by_org_id
        FROM landscape_channel_demands demand
        JOIN landscapes landscape ON landscape.id = demand.landscape_id
        JOIN channels channel ON channel.id = demand.channel_id
       WHERE channel.active
         ${channelFilter}
       GROUP BY demand.channel_id
    )
    INSERT INTO channel_collection_state (
      channel_id,
      requested_by_org_id,
      required_since,
      required_until
    )
    SELECT channel_id, requested_by_org_id, required_since, required_until
      FROM demanded
    ON CONFLICT (channel_id) DO UPDATE SET
      requested_by_org_id = excluded.requested_by_org_id,
      -- Widen monotonically here so two concurrent enqueue statements cannot
      -- overwrite each other's demand with an older snapshot. Per-landscape
      -- rows remain exact; a live lease and a continuation keep their claimed
      -- bounds so adapter cursors cannot be invalidated mid-pagination. The
      -- settling worker reconciles the pooled demand before releasing its lease.
      required_since = CASE
        WHEN ${preserveCurrentJobWindow}
          THEN channel_collection_state.required_since
        ELSE least(channel_collection_state.required_since, excluded.required_since)
      END,
      required_until = CASE
        WHEN ${preserveCurrentJobWindow}
          THEN channel_collection_state.required_until
        ELSE greatest(channel_collection_state.required_until, excluded.required_until)
      END,
      status = CASE
        WHEN channel_collection_state.lease_until > now()
          THEN channel_collection_state.status
        WHEN NOT ${options.force}
          AND channel_collection_state.status = 'failed'
          AND channel_collection_state.next_attempt_at IS NULL
          AND (
            channel_collection_state.outcome IS NULL
            OR channel_collection_state.outcome = 'permanent_failure'
          )
          THEN channel_collection_state.status
        WHEN NOT ${options.force} AND channel_collection_state.next_attempt_at > now()
          THEN channel_collection_state.status
        WHEN NOT ${options.force}
          AND channel_collection_state.outcome = 'terminal_source_limitation'
          AND coalesce(
            channel_collection_state.attempted_until,
            channel_collection_state.coverage_until
          ) >= ${staleBefore}
          THEN channel_collection_state.status
        WHEN NOT ${options.force}
          AND channel_collection_state.status = 'succeeded'
          AND NOT channel_collection_state.has_more
          AND channel_collection_state.coverage_since <= least(
            channel_collection_state.required_since,
            excluded.required_since
          )
          AND channel_collection_state.coverage_until >= greatest(
            channel_collection_state.required_until,
            excluded.required_until
          )
          THEN 'succeeded'::ingest_status
        WHEN NOT ${options.force}
          AND excluded.required_since >= channel_collection_state.required_since
          AND coalesce(
            channel_collection_state.attempted_until,
            channel_collection_state.coverage_until
          ) >= ${staleBefore}
          THEN channel_collection_state.status
        ELSE 'queued'::ingest_status
      END,
      next_attempt_at = CASE
        WHEN channel_collection_state.lease_until > now()
          THEN channel_collection_state.next_attempt_at
        WHEN NOT ${options.force}
          AND channel_collection_state.status = 'failed'
          AND channel_collection_state.next_attempt_at IS NULL
          AND (
            channel_collection_state.outcome IS NULL
            OR channel_collection_state.outcome = 'permanent_failure'
          )
          THEN channel_collection_state.next_attempt_at
        WHEN NOT ${options.force} AND channel_collection_state.next_attempt_at > now()
          THEN channel_collection_state.next_attempt_at
        WHEN NOT ${options.force}
          AND channel_collection_state.outcome = 'terminal_source_limitation'
          AND coalesce(
            channel_collection_state.attempted_until,
            channel_collection_state.coverage_until
          ) >= ${staleBefore}
          THEN channel_collection_state.next_attempt_at
        WHEN NOT ${options.force}
          AND channel_collection_state.status = 'succeeded'
          AND NOT channel_collection_state.has_more
          AND channel_collection_state.coverage_since <= least(
            channel_collection_state.required_since,
            excluded.required_since
          )
          AND channel_collection_state.coverage_until >= greatest(
            channel_collection_state.required_until,
            excluded.required_until
          )
          THEN NULL
        WHEN NOT ${options.force}
          AND excluded.required_since >= channel_collection_state.required_since
          AND coalesce(
            channel_collection_state.attempted_until,
            channel_collection_state.coverage_until
          ) >= ${staleBefore}
          THEN channel_collection_state.next_attempt_at
        ELSE now()
      END,
      last_error = CASE
        WHEN channel_collection_state.lease_until > now()
          THEN channel_collection_state.last_error
        WHEN NOT ${options.force}
          AND channel_collection_state.status = 'failed'
          AND channel_collection_state.next_attempt_at IS NULL
          AND (
            channel_collection_state.outcome IS NULL
            OR channel_collection_state.outcome = 'permanent_failure'
          )
          THEN channel_collection_state.last_error
        WHEN NOT ${options.force} AND channel_collection_state.next_attempt_at > now()
          THEN channel_collection_state.last_error
        WHEN NOT ${options.force}
          AND channel_collection_state.outcome = 'terminal_source_limitation'
          AND coalesce(
            channel_collection_state.attempted_until,
            channel_collection_state.coverage_until
          ) >= ${staleBefore}
          THEN channel_collection_state.last_error
        WHEN NOT ${options.force}
          AND channel_collection_state.status = 'succeeded'
          AND NOT channel_collection_state.has_more
          AND channel_collection_state.coverage_since <= least(
            channel_collection_state.required_since,
            excluded.required_since
          )
          AND channel_collection_state.coverage_until >= greatest(
            channel_collection_state.required_until,
            excluded.required_until
          )
          THEN NULL
        WHEN NOT ${options.force}
          AND excluded.required_since >= channel_collection_state.required_since
          AND coalesce(
            channel_collection_state.attempted_until,
            channel_collection_state.coverage_until
          ) >= ${staleBefore}
          THEN channel_collection_state.last_error
        ELSE NULL
      END,
      updated_at = now()
    RETURNING channel_id, status, next_attempt_at
  `);

  return result.rows.filter((row) =>
    row.status !== 'succeeded' && row.next_attempt_at !== null).length;
}

/** Queue the exact org-private landscape/window selected by a user. */
export async function enqueueLandscapeCollection(input: {
  orgId: string;
  landscapeId: string;
  since: Date;
  until: Date;
  platforms?: readonly Platform[];
  /** Explicit user refreshes bypass freshness reuse; membership registration does not. */
  force?: boolean;
}): Promise<{ queued: number; channelIds: string[] }> {
  assertValidDemandWindow(input);
  const filters = [
    eq(landscapes.id, input.landscapeId),
    eq(landscapes.orgId, input.orgId),
    eq(channels.active, true),
  ];
  if (input.platforms?.length) filters.push(inArray(channels.platform, input.platforms));

  const rows = await db
    .select({
      landscapeId: landscapes.id,
      companyId: landscapeCompanies.companyId,
      channelId: channels.id,
      orgId: landscapes.orgId,
    })
    .from(landscapes)
    .innerJoin(landscapeCompanies, eq(landscapeCompanies.landscapeId, landscapes.id))
    .innerJoin(channels, eq(channels.companyId, landscapeCompanies.companyId))
    .where(and(...filters));

  const demands = await writeDemands(rows, input);
  const targets = poolDemandWindows(demands);
  const queued = await enqueueDemandedChannels(
    targets.map((target) => target.channelId),
    {
      force: input.force ?? false,
      staleBefore: new Date(Date.now() - DEFAULT_FRESH_MS),
    },
  );
  return { queued, channelIds: targets.map((target) => target.channelId) };
}

/** Queue one newly added or resumed profile. The caller owns its org check. */
export async function enqueueChannelCollection(input: {
  channelId: string;
  orgId: string;
  since?: Date;
  until?: Date;
  /** Resuming a paused channel is explicit; adding an already-pooled account is not. */
  force?: boolean;
}): Promise<number> {
  const until = input.until ?? new Date();
  const window = { since: input.since ?? daysAgo(DEFAULT_HISTORY_DAYS, until), until };
  assertValidDemandWindow(window);
  const rows = await db
    .select({
      landscapeId: landscapes.id,
      companyId: channels.companyId,
      channelId: channels.id,
      orgId: landscapes.orgId,
    })
    .from(channels)
    .innerJoin(landscapeCompanies, eq(landscapeCompanies.companyId, channels.companyId))
    .innerJoin(landscapes, eq(landscapes.id, landscapeCompanies.landscapeId))
    .where(and(
      eq(channels.id, input.channelId),
      eq(channels.active, true),
      eq(landscapes.orgId, input.orgId),
    ));
  const demands = await writeDemands(rows, window);
  return enqueueDemandedChannels(
    poolDemandWindows(demands).map((target) => target.channelId),
    {
      force: input.force ?? false,
      staleBefore: new Date(Date.now() - DEFAULT_FRESH_MS),
    },
  );
}

/**
 * Reconcile every tracked profile into the durable queue.
 * Fresh completed rows are untouched, so frequent recovery dispatchers only
 * resume pending work; they cannot buy a third normal refresh inside 12 hours.
 */
export async function enqueueTrackedProfiles(input: {
  now?: Date;
  historyDays?: number;
  freshForMs?: number;
} = {}): Promise<number> {
  const now = input.now ?? new Date();
  const window = {
    since: daysAgo(input.historyDays ?? DEFAULT_HISTORY_DAYS, now),
    until: now,
  };
  assertValidDemandWindow(window);
  const rows = await db
    .select({
      landscapeId: landscapes.id,
      companyId: landscapeCompanies.companyId,
      channelId: channels.id,
      orgId: landscapes.orgId,
    })
    .from(landscapes)
    .innerJoin(landscapeCompanies, eq(landscapeCompanies.landscapeId, landscapes.id))
    .innerJoin(channels, eq(channels.companyId, landscapeCompanies.companyId))
    .where(eq(channels.active, true));

  const demands = await writeDemands(rows, window);
  const staleBefore = input.freshForMs === undefined
    ? automaticRefreshWindowStart(now)
    : new Date(now.getTime() - input.freshForMs);
  return enqueueDemandedChannels(poolDemandWindows(demands).map((target) => target.channelId), {
    force: false,
    staleBefore,
  });
}

async function claim(input: {
  limit: number;
  orgId?: string;
  landscapeId?: string;
  channelIds?: readonly string[];
  platforms?: readonly Platform[];
}): Promise<ClaimedItem[]> {
  const scopedLandscape = input.landscapeId && input.orgId
    ? sql`AND EXISTS (
        SELECT 1
          FROM landscape_channel_demands claim_demand
          JOIN landscapes claim_l ON claim_l.id = claim_demand.landscape_id
         WHERE claim_demand.channel_id = state.channel_id
           AND claim_l.id = ${input.landscapeId}::uuid
           AND claim_l.org_id = ${input.orgId}::uuid
      )`
    : sql``;
  const channelFilter = input.channelIds?.length
    ? sql`AND state.channel_id IN (${sql.join(
        input.channelIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`
    : sql``;
  const platformFilter = input.platforms?.length
    ? sql`AND ch.platform IN (${sql.join(
        input.platforms.map((platform) => sql`${platform}::platform`),
        sql`, `,
      )})`
    : sql``;

  const result = await db.execute<ClaimedItem>(sql`
    WITH candidates AS MATERIALIZED (
      SELECT state.channel_id
        FROM channel_collection_state state
        JOIN channels ch ON ch.id = state.channel_id
       WHERE ch.active
         AND EXISTS (
           SELECT 1
             FROM landscape_channel_demands live_demand
            WHERE live_demand.channel_id = state.channel_id
         )
         AND (
           (
             state.status IN ('queued', 'partial', 'failed')
             AND state.next_attempt_at IS NOT NULL
             AND state.next_attempt_at <= now()
           )
           OR (
             state.status = 'running'
             AND state.lease_until <= now()
           )
         )
         AND (state.lease_until IS NULL OR state.lease_until <= now())
         ${scopedLandscape}
         ${channelFilter}
         ${platformFilter}
       ORDER BY
         CASE state.status
           WHEN 'running' THEN 0
           WHEN 'partial' THEN 1
           WHEN 'queued' THEN 2
           ELSE 3
         END,
         state.next_attempt_at,
         state.updated_at,
         state.channel_id
       FOR UPDATE OF state SKIP LOCKED
       LIMIT ${input.limit}
    ), claimed AS (
      UPDATE channel_collection_state state
         SET status = 'running',
             -- One token per row keeps ownership independent even though the
             -- batch is claimed and heartbeated efficiently in one statement.
             lease_token = gen_random_uuid(),
             lease_until = now() + (${LEASE_MS} * interval '1 millisecond'),
             attempts = state.attempts + 1,
             updated_at = now()
        FROM candidates
       WHERE state.channel_id = candidates.channel_id
      RETURNING state.*
    )
    SELECT claimed.channel_id,
           claimed.lease_token,
           ch.platform,
           ch.handle,
           co.name AS company_name,
           claimed.requested_by_org_id,
           claimed.required_since,
           claimed.required_until,
           claimed.coverage_since,
           claimed.coverage_until,
           claimed.attempted_until,
           claimed.outcome,
           claimed.has_more,
           claimed.last_error,
           claimed.attempts
      FROM claimed
      JOIN channels ch ON ch.id = claimed.channel_id
      JOIN companies co ON co.id = ch.company_id
  `);
  return [...result.rows];
}

/**
 * Extend only live rows still owned by their exact per-channel token. The expiry
 * predicate prevents a delayed heartbeat from resurrecting an already-expired
 * lease before another dispatcher has had a chance to claim it.
 */
async function renewClaimLeases(
  channelIds: readonly string[],
  leaseTokens: ReadonlyMap<string, string>,
): Promise<string[]> {
  if (channelIds.length === 0) return [];
  const pairs = channelIds.map((channelId) => {
    const leaseToken = leaseTokens.get(channelId);
    if (!leaseToken) throw new Error('Missing lease token for channel ' + channelId + '.');
    return sql`(${channelId}::uuid, ${leaseToken}::uuid)`;
  });
  const renewed = await db.execute<{ channel_id: string } & Record<string, unknown>>(sql`
    UPDATE channel_collection_state state
       SET lease_until = now() + (${LEASE_MS} * interval '1 millisecond')
      FROM (VALUES ${sql.join(pairs, sql`, `)}) AS owned(channel_id, lease_token)
     WHERE state.channel_id = owned.channel_id
       AND state.lease_token = owned.lease_token
       AND state.lease_until > now()
    RETURNING state.channel_id
  `);
  return renewed.rows.map((row) => row.channel_id);
}

function retryAt(attempts: number): Date {
  const minutes = Math.min(60, 5 * Math.pow(2, Math.max(0, attempts - 1)));
  return new Date(Date.now() + minutes * 60_000);
}

function mergeCertifiedCoverage(input: {
  requiredSince: Date;
  requiredUntil: Date;
  coverageSince: Date | null;
  coverageUntil: Date | null;
  attemptedSince: Date;
  attemptedUntil: Date;
}): { since: Date; until: Date; complete: boolean } {
  const overlapsExisting = input.coverageSince !== null
    && input.coverageUntil !== null
    && input.attemptedSince <= input.coverageUntil
    && input.attemptedUntil >= input.coverageSince;
  const since = overlapsExisting && input.coverageSince
    ? new Date(Math.min(input.coverageSince.getTime(), input.attemptedSince.getTime()))
    : input.attemptedSince;
  const until = overlapsExisting && input.coverageUntil
    ? new Date(Math.max(input.coverageUntil.getTime(), input.attemptedUntil.getTime()))
    : input.attemptedUntil;
  return {
    since,
    until,
    complete: since <= input.requiredSince && until >= input.requiredUntil,
  };
}

async function finishClaim(
  item: ClaimedItem,
  result: ChannelRunResult,
): Promise<boolean> {
  let disposition = queueDisposition(result.outcome);
  let stateOutcome = result.outcome;
  let coverageSince: Date | undefined;
  let coverageUntil: Date | undefined;
  let coverageComplete = false;
  let lastError = result.error ?? result.incompleteReason ?? null;

  if (disposition.mayAdvanceCoverage) {
    if (!result.attemptedSince || !result.attemptedUntil) {
      // A certified result without a concrete window cannot prove anything.
      // Treat it as an operational contract failure and try again safely.
      disposition = queueDisposition('retryable_operational_failure');
      stateOutcome = 'retryable_operational_failure';
      lastError = 'The adapter reported complete without the attempted window bounds.';
    } else {
      const merged = mergeCertifiedCoverage({
        requiredSince: asDate(item.required_since),
        requiredUntil: asDate(item.required_until),
        coverageSince: item.coverage_since ? asDate(item.coverage_since) : null,
        coverageUntil: item.coverage_until ? asDate(item.coverage_until) : null,
        attemptedSince: result.attemptedSince,
        attemptedUntil: result.attemptedUntil,
      });
      coverageSince = merged.since;
      coverageUntil = merged.until;
      coverageComplete = merged.complete;
      if (!coverageComplete) {
        // A later two-day refresh may be exhaustive for those two days, but it
        // cannot repair history a limited source previously left uncertified.
        disposition = queueDisposition('terminal_source_limitation');
        stateOutcome = 'terminal_source_limitation';
        lastError = item.last_error
          ?? 'Recent data was refreshed, but older requested history remains uncertified.';
      } else {
        lastError = null;
      }
    }
  }

  // A source that is terminally limited going backward is still exhaustive
  // going forward: the crawl paged everything the vendor exposes between its
  // attempt bounds. When those bounds overlap an existing certified suffix,
  // the suffix's right edge moves with the attempt; refusing to move it let
  // the suffix go stale two days after certification, which silently withdrew
  // week-over-week from every report on a vendor-capped platform. The left
  // edge never moves here: only a certified crawl may add older history.
  if (!disposition.mayAdvanceCoverage && stateOutcome === 'terminal_source_limitation') {
    const extended = extendedTerminalSuffix({
      attemptedSince: result.attemptedSince ?? null,
      attemptedUntil: result.attemptedUntil ?? null,
      coverageSince: item.coverage_since ? asDate(item.coverage_since) : null,
      coverageUntil: item.coverage_until ? asDate(item.coverage_until) : null,
    });
    if (extended) {
      coverageSince = extended.since;
      coverageUntil = extended.until;
    }
  }

  // Bounded retry: a claim that keeps failing operationally eventually stops
  // itself rather than retrying on the hour forever. item.attempts was
  // incremented at claim time, so it already counts this attempt.
  const consecutiveAttempts = Number(item.attempts) || 0;
  const escalated = escalateRetryableOutcome(stateOutcome, consecutiveAttempts);
  if (escalated !== stateOutcome) {
    stateOutcome = escalated;
    disposition = queueDisposition(escalated);
    lastError = 'Escalated to operator review after ' + consecutiveAttempts
      + ' consecutive failed attempts.' + (lastError ? ' Last error: ' + lastError : '');
  }

  const nextAttemptAt = disposition.schedule === 'immediate'
    ? new Date()
    : disposition.schedule === 'backoff'
      ? retryAt(consecutiveAttempts || 1)
      : null;
  const previousAttemptedUntil = item.attempted_until
    ? asDate(item.attempted_until)
    : null;
  const attemptedUntil = disposition.advancesAttemptWatermark && result.attemptedUntil
    ? new Date(Math.max(
        previousAttemptedUntil?.getTime() ?? 0,
        result.attemptedUntil.getTime(),
      ))
    : undefined;
  const claimedSince = asDate(item.required_since);
  const pooledDemandSince = sql<Date>`coalesce((
    SELECT min(demand.required_since)
      FROM landscape_channel_demands demand
     WHERE demand.channel_id = ${item.channel_id}::uuid
  ), ${channelCollectionState.requiredSince})`;
  const pooledDemandUntil = sql<Date>`coalesce((
    SELECT max(demand.required_until)
      FROM landscape_channel_demands demand
     WHERE demand.channel_id = ${item.channel_id}::uuid
  ), ${channelCollectionState.requiredUntil})`;
  const expandedWhileRunning = sql<boolean>`(${pooledDemandSince} < ${claimedSince})`;
  // If another landscape widens demand while this lease is running, a settled
  // result only certifies the bounds the worker actually claimed. Keep the new
  // aggregate window queued after releasing the lease. Retryable failures keep
  // their normal backoff, and permanent failures remain explicitly blocked.
  const requeueExpandedDemand = stateOutcome === 'certified_complete';
  const settledStatus = coverageComplete ? 'succeeded' : disposition.status;

  // A useful settle ends the consecutive-failure streak. Certified coverage,
  // a continuation making progress and a terminal source limitation all prove
  // the pipeline works; only failures leave the counter running.
  const settlesUsefully = stateOutcome === 'certified_complete'
    || stateOutcome === 'continuation'
    || stateOutcome === 'terminal_source_limitation';

  const finished = await db.update(channelCollectionState).set({
    attempts: settlesUsefully ? 0 : undefined,
    status: requeueExpandedDemand
      ? sql`CASE
          WHEN ${expandedWhileRunning} THEN 'queued'::ingest_status
          ELSE ${settledStatus}::ingest_status
        END`
      : settledStatus,
    outcome: stateOutcome,
    coverageSince,
    coverageUntil,
    attemptedUntil,
    hasMore: stateOutcome === 'continuation',
    nextAttemptAt: requeueExpandedDemand
      ? sql`CASE WHEN ${expandedWhileRunning} THEN now() ELSE ${nextAttemptAt} END`
      : nextAttemptAt,
    leaseToken: null,
    leaseUntil: null,
    lastError,
    // A continuation must keep the exact window encoded in its adapter cursor.
    // The first settled page reconciles the durable per-landscape aggregate.
    requiredSince: requeueExpandedDemand
      ? sql`CASE
          WHEN ${expandedWhileRunning}
            THEN least(${channelCollectionState.requiredSince}, ${pooledDemandSince})
          ELSE ${channelCollectionState.requiredSince}
        END`
      : undefined,
    requiredUntil: requeueExpandedDemand
      ? sql`CASE
          WHEN ${expandedWhileRunning}
            THEN greatest(${channelCollectionState.requiredUntil}, ${pooledDemandUntil})
          ELSE ${channelCollectionState.requiredUntil}
        END`
      : undefined,
    updatedAt: new Date(),
  }).where(and(
    eq(channelCollectionState.channelId, item.channel_id),
    eq(channelCollectionState.leaseToken, item.lease_token),
    // A token alone is not enough after its lease expires. This condition
    // prevents a delayed worker from settling a row before a newer claimant
    // happens to replace the stale token.
    sql`${channelCollectionState.leaseUntil} > now()`,
  )).returning({ channelId: channelCollectionState.channelId });
  return finished.length === 1;
}

function platformSummary(): PlatformSummary {
  return {
    attempted: 0,
    succeeded: 0,
    partial: 0,
    failed: 0,
    skipped: 0,
    postsUpserted: 0,
  };
}

function deferredResult(item: ClaimedItem, retryAfterMs: number): ChannelRunResult {
  return {
    channelId: item.channel_id,
    platform: item.platform,
    handle: item.handle,
    companyName: item.company_name,
    status: 'skipped',
    postsUpserted: 0,
    snapshotsUpserted: 0,
    tagsAssigned: 0,
    urlsRecorded: 0,
    apiCalls: 0,
    durationMs: 0,
    hasMore: false,
    attemptedSince: null,
    attemptedUntil: null,
    outcome: 'retryable_operational_failure',
    exhaustive: null,
    warnings: [],
    error: 'Deferred: ' + item.platform + ' rate budget will be available in roughly '
      + String(Math.ceil(retryAfterMs / 1_000)) + 's.',
    // finishClaim persists this as a scheduled retry, not a terminal block.
    retryable: true,
  };
}

function leaseLostResult(
  item: ClaimedItem,
  completed?: ChannelRunResult,
): ChannelRunResult {
  const warning = 'This worker lost its collection lease and did not update durable queue state. '
    + 'Any idempotent observation writes that finished before ownership was lost remain stored; '
    + 'the current lease owner will safely repair and settle the window.';
  return {
    channelId: item.channel_id,
    platform: item.platform,
    handle: item.handle,
    companyName: item.company_name,
    status: 'failed',
    postsUpserted: completed?.postsUpserted ?? 0,
    snapshotsUpserted: completed?.snapshotsUpserted ?? 0,
    tagsAssigned: completed?.tagsAssigned ?? 0,
    urlsRecorded: completed?.urlsRecorded ?? 0,
    apiCalls: completed?.apiCalls ?? 0,
    durationMs: completed?.durationMs ?? 0,
    hasMore: completed?.hasMore ?? false,
    attemptedSince: completed?.attemptedSince ?? null,
    attemptedUntil: completed?.attemptedUntil ?? null,
    outcome: 'retryable_operational_failure',
    exhaustive: completed?.exhaustive ?? null,
    incompleteReason: completed?.incompleteReason,
    warnings: [...(completed?.warnings ?? []), warning],
    error: warning,
    retryable: true,
  };
}

export async function getCollectionQueueStatus(input: {
  orgId?: string;
  landscapeId?: string;
  channelIds?: readonly string[];
  platforms?: readonly Platform[];
}): Promise<CollectionQueueStatus> {
  const landscapeFilter = input.landscapeId && input.orgId
    ? sql`AND EXISTS (
        SELECT 1
          FROM landscape_channel_demands count_demand
          JOIN landscapes count_l ON count_l.id = count_demand.landscape_id
         WHERE count_demand.channel_id = state.channel_id
           AND count_l.id = ${input.landscapeId}::uuid
           AND count_l.org_id = ${input.orgId}::uuid
      )`
    : sql``;
  const channelFilter = input.channelIds?.length
    ? sql`AND state.channel_id IN (${sql.join(
        input.channelIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`
    : sql``;
  const platformFilter = input.platforms?.length
    ? sql`AND ch.platform IN (${sql.join(
        input.platforms.map((platform) => sql`${platform}::platform`),
        sql`, `,
      )})`
    : sql``;
  const result = await db.execute<{
    total: string | number;
    remaining: string | number;
    runnable_now: string | number;
    running: string | number;
    waiting_for_retry: string | number;
    next_ready_at: Date | string | null;
    blocked: string | number;
    source_limited: string | number;
  } & Record<string, unknown>>(sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (
             WHERE state.status IN ('queued', 'running')
                OR (
                  state.outcome IS DISTINCT FROM 'terminal_source_limitation'
                  AND (
                    state.next_attempt_at IS NOT NULL
                    OR state.outcome = 'continuation'
                  )
                )
           )::int AS remaining,
           count(*) FILTER (
             WHERE (
               state.status IN ('queued', 'partial', 'failed')
               AND state.next_attempt_at IS NOT NULL
               AND state.next_attempt_at <= now()
               AND (state.lease_until IS NULL OR state.lease_until <= now())
             ) OR (
               state.status = 'running'
               AND state.lease_until <= now()
             )
           )::int AS runnable_now,
           count(*) FILTER (
             WHERE state.status = 'running'
               AND state.lease_until > now()
           )::int AS running,
           count(*) FILTER (
             WHERE (
               state.status IN ('queued', 'running')
               OR (
                 state.outcome IS DISTINCT FROM 'terminal_source_limitation'
                 AND (
                   state.next_attempt_at IS NOT NULL
                   OR state.outcome = 'continuation'
                 )
               )
             )
             AND NOT (
               (
                 state.status IN ('queued', 'partial', 'failed')
                 AND state.next_attempt_at IS NOT NULL
                 AND state.next_attempt_at <= now()
                 AND (state.lease_until IS NULL OR state.lease_until <= now())
               ) OR (
                 state.status = 'running'
                 AND state.lease_until <= now()
               )
             )
             AND NOT (
               state.status = 'running'
               AND state.lease_until > now()
             )
           )::int AS waiting_for_retry,
           min(CASE
             WHEN state.status = 'running' AND state.lease_until > now()
               THEN state.lease_until
             WHEN state.next_attempt_at > now()
               THEN state.next_attempt_at
             ELSE NULL
           END) AS next_ready_at,
           count(*) FILTER (
             WHERE state.next_attempt_at IS NULL
               AND state.status = 'failed'
           )::int AS blocked,
           count(*) FILTER (
             WHERE state.next_attempt_at IS NULL
               AND state.outcome = 'terminal_source_limitation'
           )::int AS source_limited
      FROM channel_collection_state state
      JOIN channels ch ON ch.id = state.channel_id
     WHERE ch.active
       AND EXISTS (
         SELECT 1
           FROM landscape_channel_demands live_demand
          WHERE live_demand.channel_id = state.channel_id
       )
       ${landscapeFilter}
       ${channelFilter}
       ${platformFilter}
  `);
  const nextReady = result.rows[0]?.next_ready_at ?? null;
  return {
    total: Number(result.rows[0]?.total ?? 0),
    remaining: Number(result.rows[0]?.remaining ?? 0),
    runnableNow: Number(result.rows[0]?.runnable_now ?? 0),
    running: Number(result.rows[0]?.running ?? 0),
    waitingForRetry: Number(result.rows[0]?.waiting_for_retry ?? 0),
    nextReadyAt: nextReady instanceof Date
      ? nextReady
      : nextReady
        ? new Date(nextReady)
        : null,
    blocked: Number(result.rows[0]?.blocked ?? 0),
    sourceLimited: Number(result.rows[0]?.source_limited ?? 0),
  };
}

/** Claim a bounded batch, ingest it, and durably release every lease. */
export async function runCollectionQueue(input: {
  maxChannels?: number;
  postLimit?: number;
  concurrency?: number;
  orgId?: string;
  landscapeId?: string;
  channelIds?: readonly string[];
  platforms?: readonly Platform[];
  /** Explicit historical recovery: start at the durable requested boundary. */
  useRequiredSince?: boolean;
  /**
   * Exact one-off recovery window selected by an operator.
   *
   * The durable pooled demand is intentionally monotonic, so it may still ask
   * for 90 days after an operator narrows a capped source to one missing week.
   * This override changes only the leased adapter attempt; the adapter's
   * attempted bounds and any paid continuation receipt remain durable in the
   * normal queue state.
   */
  runWindow?: { since: Date; until: Date };
} = {}): Promise<CollectionQueueSummary> {
  if (input.runWindow) assertValidDemandWindow(input.runWindow);
  const startedAt = Date.now();
  const items = await claim({
    limit: input.maxChannels ?? 24,
    orgId: input.orgId,
    landscapeId: input.landscapeId,
    channelIds: input.channelIds,
    platforms: input.platforms,
  });
  const results: ChannelRunResult[] = [];
  const leaseTokens = new Map(items.map((item) => [item.channel_id, item.lease_token]));
  const heartbeat = new TokenFencedLeaseHeartbeat({
    channelIds: items.map((item) => item.channel_id),
    leaseMs: LEASE_MS,
    renew: (channelIds) => renewClaimLeases(channelIds, leaseTokens),
  });
  const gates = new Map<Platform, RateGate>();
  for (const item of items) {
    if (gates.has(item.platform) || !hasAdapter(item.platform)) continue;
    const adapter = getAdapter(item.platform);
    gates.set(
      item.platform,
      new RateGate(adapter.rateLimit.callsPerWindow, adapter.rateLimit.windowSeconds),
    );
  }
  let cursor = 0;
  const concurrency = Math.max(
    1,
    Math.min(input.concurrency ?? DEFAULT_CONCURRENCY, Math.max(1, items.length)),
  );

  const settle = async (
    item: ClaimedItem,
    result: ChannelRunResult,
  ): Promise<void> => {
    // Serialize the final write behind any heartbeat that already included
    // this channel. The database update then checks both its unique token and
    // DB-time lease expiry, so local timer state is never treated as authority.
    const locallyOwned = await heartbeat.releaseForFinish(item.channel_id);
    if (!locallyOwned) {
      results.push(leaseLostResult(item, result));
      return;
    }
    const finished = await finishClaim(item, result);
    results.push(finished ? result : leaseLostResult(item, result));
  };

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      const item = items[index];
      let result: ChannelRunResult;
      const gate = gates.get(item.platform);
      const signal = heartbeat.signalFor(item.channel_id);
      if (!heartbeat.owns(item.channel_id) || signal.aborted) {
        await heartbeat.releaseForFinish(item.channel_id);
        results.push(leaseLostResult(item));
        continue;
      }
      let reservation = 0;
      if (gate) {
        const acquired = await gate.acquire(
          ESTIMATED_CALLS_PER_RUN,
          MAX_RATE_WAIT_MS,
          signal,
        );
        if (!heartbeat.owns(item.channel_id) || signal.aborted) {
          await heartbeat.releaseForFinish(item.channel_id);
          results.push(leaseLostResult(item));
          continue;
        }
        if (!acquired.acquired) {
          result = deferredResult(item, acquired.retryAfterMs);
          await settle(item, result);
          continue;
        }
        reservation = acquired.reserved;
      }

      let measured = false;
      try {
        const requiredSince = asDate(item.required_since);
        const coverageSince = item.coverage_since ? asDate(item.coverage_since) : null;
        const coverageUntil = item.coverage_until ? asDate(item.coverage_until) : null;
        const attemptedUntil = item.attempted_until ? asDate(item.attempted_until) : null;
        const runSince = input.runWindow?.since ?? (input.useRequiredSince
          ? requiredSince
          : collectionRunSince({
              requiredSince,
              coverageSince,
              coverageUntil,
              attemptedUntil,
              outcome: item.outcome,
              hasMore: item.has_more,
            }));
        const runUntil = input.runWindow?.until ?? asDate(item.required_until);
        result = await runChannelIngest(item.channel_id, {
          since: runSince,
          until: runUntil,
          limit: input.postLimit ?? 500,
          credentialOrgId: item.requested_by_org_id ?? undefined,
          signal,
        });
        measured = true;
      } catch (err) {
        result = {
          channelId: item.channel_id,
          platform: item.platform,
          handle: item.handle,
          companyName: item.company_name,
          status: 'failed',
          postsUpserted: 0,
          snapshotsUpserted: 0,
          tagsAssigned: 0,
          urlsRecorded: 0,
          apiCalls: 0,
          durationMs: 0,
          hasMore: false,
          attemptedSince: null,
          attemptedUntil: null,
          outcome: 'retryable_operational_failure',
          exhaustive: null,
          warnings: [],
          error: err instanceof Error ? err.message : 'Unexpected collection failure.',
          retryable: true,
        };
      }
      if (measured) gate?.reconcile(reservation, result.apiCalls);
      await settle(item, result);
    }
  };

  heartbeat.start();
  try {
    const workers = await Promise.allSettled(
      Array.from({ length: concurrency }, () => worker()),
    );
    const rejected = workers.find(
      (workerResult): workerResult is PromiseRejectedResult => workerResult.status === 'rejected',
    );
    if (rejected) throw rejected.reason;
  } finally {
    // A serverless invocation or CLI command must never return with a live
    // renewal timer or an unobserved renewal promise.
    await heartbeat.stop();
  }

  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  let partial = 0;
  let postsUpserted = 0;
  const byPlatform: Partial<Record<Platform, PlatformSummary>> = {};
  for (const result of results) {
    const bucket = byPlatform[result.platform] ?? platformSummary();
    bucket.attempted += 1;
    bucket.postsUpserted += result.postsUpserted;
    postsUpserted += result.postsUpserted;
    if (result.status === 'succeeded') { succeeded += 1; bucket.succeeded += 1; }
    else if (result.status === 'skipped') { skipped += 1; bucket.skipped += 1; }
    else if (result.status === 'partial') { partial += 1; bucket.partial += 1; }
    else { failed += 1; bucket.failed += 1; }
    byPlatform[result.platform] = bucket;
  }

  const counts = await getCollectionQueueStatus(input);
  return {
    attempted: results.length,
    succeeded,
    failed,
    skipped,
    partial,
    postsUpserted,
    durationMs: Date.now() - startedAt,
    remaining: counts.remaining,
    blocked: counts.blocked,
    sourceLimited: counts.sourceLimited,
    complete: counts.remaining === 0 && counts.blocked === 0,
    byPlatform,
    results,
  };
}
