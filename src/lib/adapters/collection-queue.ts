import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  channelCollectionState,
  channels,
  landscapeCompanies,
  landscapes,
} from '@/db/schema';
import type { Platform } from '@/lib/types';
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

const DEFAULT_HISTORY_DAYS = 90;
const DEFAULT_FRESH_MS = 3 * 60 * 60 * 1_000;
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
// A Vercel request is capped at five minutes. A lease must outlive that request
// so a second worker cannot buy the same data concurrently, but it must also
// become reclaimable promptly when the request is killed mid-batch.
const LEASE_MS = 6 * 60 * 1_000;

interface QueueTarget {
  channelId: string;
  orgId: string;
}

interface ClaimedItem extends Record<string, unknown> {
  channel_id: string;
  platform: Platform;
  handle: string;
  company_name: string;
  requested_by_org_id: string | null;
  required_since: Date | string;
  required_until: Date | string;
  coverage_since: Date | string | null;
  coverage_until: Date | string | null;
  has_more: boolean;
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
  remaining: number;
  blocked: number;
  complete: boolean;
  byPlatform: Partial<Record<Platform, PlatformSummary>>;
  results: ChannelRunResult[];
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
  hasMore: boolean;
}): Date {
  const canRefreshIncrementally = !input.hasMore
    && input.coverageSince !== null
    && input.coverageUntil !== null
    && input.coverageSince <= input.requiredSince;
  return canRefreshIncrementally && input.coverageUntil
    ? new Date(Math.max(
        input.requiredSince.getTime(),
        input.coverageUntil.getTime() - 2 * 86_400_000,
      ))
    : input.requiredSince;
}

export const collectionQueueTestHelpers = { collectionRunSince };

function uniqueTargets(rows: readonly QueueTarget[]): QueueTarget[] {
  return [...new Map(rows.map((row) => [row.channelId, row])).values()];
}

async function enqueueTargets(
  rows: readonly QueueTarget[],
  window: { since: Date; until: Date },
  options: { force: boolean; staleBefore?: Date },
): Promise<number> {
  const targets = uniqueTargets(rows);
  if (targets.length === 0) return 0;

  const values = sql.join(targets.map((target) => sql`(
    ${target.channelId}::uuid,
    ${target.orgId}::uuid,
    ${window.since},
    ${window.until}
  )`), sql`, `);
  const staleBefore = options.staleBefore ?? new Date(0);

  const result = await db.execute<{ channel_id: string }>(sql`
    INSERT INTO channel_collection_state (
      channel_id,
      requested_by_org_id,
      required_since,
      required_until
    )
    VALUES ${values}
    ON CONFLICT (channel_id) DO UPDATE SET
      requested_by_org_id = excluded.requested_by_org_id,
      required_since = least(
        channel_collection_state.required_since,
        excluded.required_since
      ),
      required_until = greatest(
        channel_collection_state.required_until,
        excluded.required_until
      ),
      status = CASE
        WHEN channel_collection_state.lease_until > now()
          THEN channel_collection_state.status
        WHEN channel_collection_state.status = 'succeeded'
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
        ELSE 'queued'::ingest_status
      END,
      next_attempt_at = CASE
        WHEN channel_collection_state.lease_until > now()
          THEN channel_collection_state.next_attempt_at
        WHEN channel_collection_state.status = 'succeeded'
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
        ELSE now()
      END,
      last_error = CASE
        WHEN channel_collection_state.lease_until > now()
          THEN channel_collection_state.last_error
        ELSE NULL
      END,
      updated_at = now()
    WHERE (
        channel_collection_state.lease_until IS NULL
        OR channel_collection_state.lease_until <= now()
      )
      AND (
        ${options.force}
        OR (
          (channel_collection_state.status <> 'failed'
            OR channel_collection_state.next_attempt_at IS NOT NULL)
          AND (
            channel_collection_state.coverage_until IS NULL
            OR channel_collection_state.coverage_until < ${staleBefore}
            OR channel_collection_state.status IN ('queued', 'partial')
          )
        )
      )
    RETURNING channel_id
  `);

  return result.rows.length;
}

/** Queue the exact org-private landscape/window selected by a user. */
export async function enqueueLandscapeCollection(input: {
  orgId: string;
  landscapeId: string;
  since: Date;
  until: Date;
  platforms?: readonly Platform[];
}): Promise<{ queued: number; channelIds: string[] }> {
  const filters = [
    eq(landscapes.id, input.landscapeId),
    eq(landscapes.orgId, input.orgId),
    eq(channels.active, true),
  ];
  if (input.platforms?.length) filters.push(inArray(channels.platform, input.platforms));

  const rows = await db
    .select({ channelId: channels.id, orgId: landscapes.orgId })
    .from(landscapes)
    .innerJoin(landscapeCompanies, eq(landscapeCompanies.landscapeId, landscapes.id))
    .innerJoin(channels, eq(channels.companyId, landscapeCompanies.companyId))
    .where(and(...filters));

  const targets = uniqueTargets(rows);
  const queued = await enqueueTargets(targets, input, { force: true });
  return { queued, channelIds: targets.map((row) => row.channelId) };
}

/** Queue one newly added or resumed profile. The caller owns its org check. */
export async function enqueueChannelCollection(input: {
  channelId: string;
  orgId: string;
  since?: Date;
  until?: Date;
}): Promise<number> {
  const until = input.until ?? new Date();
  return enqueueTargets([input], {
    since: input.since ?? daysAgo(DEFAULT_HISTORY_DAYS, until),
    until,
  }, { force: true });
}

/**
 * Reconcile every tracked profile into the durable queue.
 * Fresh completed rows are untouched, so a ten-minute dispatcher still buys
 * data only at the three-hour product cadence.
 */
export async function enqueueTrackedProfiles(input: {
  now?: Date;
  historyDays?: number;
  freshForMs?: number;
} = {}): Promise<number> {
  const now = input.now ?? new Date();
  const rows = await db
    .select({ channelId: channels.id, orgId: landscapes.orgId })
    .from(landscapes)
    .innerJoin(landscapeCompanies, eq(landscapeCompanies.landscapeId, landscapes.id))
    .innerJoin(channels, eq(channels.companyId, landscapeCompanies.companyId))
    .where(eq(channels.active, true));

  return enqueueTargets(uniqueTargets(rows), {
    since: daysAgo(input.historyDays ?? DEFAULT_HISTORY_DAYS, now),
    until: now,
  }, {
    force: false,
    staleBefore: new Date(now.getTime() - (input.freshForMs ?? DEFAULT_FRESH_MS)),
  });
}

async function claim(input: {
  limit: number;
  leaseToken: string;
  orgId?: string;
  landscapeId?: string;
  channelIds?: readonly string[];
  platforms?: readonly Platform[];
}): Promise<ClaimedItem[]> {
  const scopedLandscape = input.landscapeId && input.orgId
    ? sql`AND EXISTS (
        SELECT 1
          FROM landscape_companies claim_lc
          JOIN landscapes claim_l ON claim_l.id = claim_lc.landscape_id
         WHERE claim_lc.company_id = ch.company_id
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
             lease_token = ${input.leaseToken}::uuid,
             lease_until = now() + (${LEASE_MS} * interval '1 millisecond'),
             attempts = state.attempts + 1,
             updated_at = now()
        FROM candidates
       WHERE state.channel_id = candidates.channel_id
      RETURNING state.*
    )
    SELECT claimed.channel_id,
           ch.platform,
           ch.handle,
           co.name AS company_name,
           claimed.requested_by_org_id,
           claimed.required_since,
           claimed.required_until,
           claimed.coverage_since,
           claimed.coverage_until,
           claimed.has_more,
           claimed.attempts
      FROM claimed
      JOIN channels ch ON ch.id = claimed.channel_id
      JOIN companies co ON co.id = ch.company_id
  `);
  return [...result.rows];
}

function retryAt(attempts: number): Date {
  const minutes = Math.min(60, 5 * Math.pow(2, Math.max(0, attempts - 1)));
  return new Date(Date.now() + minutes * 60_000);
}

async function finishClaim(
  item: ClaimedItem,
  leaseToken: string,
  result: ChannelRunResult,
): Promise<void> {
  const complete = result.status === 'succeeded' && !result.hasMore;
  const continuing = result.status === 'partial' && result.hasMore;
  const retryable = continuing || result.retryable === true;
  const nextAttemptAt = continuing
    ? new Date()
    : retryable ? retryAt(Number(item.attempts) || 1) : null;

  await db.update(channelCollectionState).set({
    status: complete ? 'succeeded' : continuing ? 'partial' : 'failed',
    coverageSince: complete ? asDate(item.required_since) : undefined,
    coverageUntil: complete ? asDate(item.required_until) : undefined,
    hasMore: result.hasMore,
    nextAttemptAt,
    leaseToken: null,
    leaseUntil: null,
    lastError: complete ? null : result.error ?? (continuing ? null : 'Collection did not complete.'),
    updatedAt: new Date(),
  }).where(and(
    eq(channelCollectionState.channelId, item.channel_id),
    eq(channelCollectionState.leaseToken, leaseToken),
  ));
}

function platformSummary(): PlatformSummary {
  return { attempted: 0, succeeded: 0, failed: 0, skipped: 0, postsUpserted: 0 };
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
    warnings: [],
    error: 'Deferred: ' + item.platform + ' rate budget will be available in roughly '
      + String(Math.ceil(retryAfterMs / 1_000)) + 's.',
    // finishClaim persists this as a scheduled retry, not a terminal block.
    retryable: true,
  };
}

async function outstanding(input: {
  orgId?: string;
  landscapeId?: string;
  channelIds?: readonly string[];
  platforms?: readonly Platform[];
}): Promise<{ remaining: number; blocked: number }> {
  const landscapeFilter = input.landscapeId && input.orgId
    ? sql`AND EXISTS (
        SELECT 1
          FROM landscape_companies count_lc
          JOIN landscapes count_l ON count_l.id = count_lc.landscape_id
         WHERE count_lc.company_id = ch.company_id
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
    remaining: string | number;
    blocked: string | number;
  } & Record<string, unknown>>(sql`
    SELECT count(*) FILTER (WHERE state.status <> 'succeeded')::int AS remaining,
           count(*) FILTER (
             WHERE state.status = 'failed' AND state.next_attempt_at IS NULL
           )::int AS blocked
      FROM channel_collection_state state
      JOIN channels ch ON ch.id = state.channel_id
     WHERE ch.active
       ${landscapeFilter}
       ${channelFilter}
       ${platformFilter}
  `);
  return {
    remaining: Number(result.rows[0]?.remaining ?? 0),
    blocked: Number(result.rows[0]?.blocked ?? 0),
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
} = {}): Promise<CollectionQueueSummary> {
  const startedAt = Date.now();
  const leaseToken = randomUUID();
  const items = await claim({
    limit: input.maxChannels ?? 24,
    leaseToken,
    orgId: input.orgId,
    landscapeId: input.landscapeId,
    channelIds: input.channelIds,
    platforms: input.platforms,
  });
  const results: ChannelRunResult[] = [];
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

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      const item = items[index];
      let result: ChannelRunResult;
      const gate = gates.get(item.platform);
      let reservation = 0;
      if (gate) {
        const acquired = await gate.acquire(ESTIMATED_CALLS_PER_RUN, MAX_RATE_WAIT_MS);
        if (!acquired.acquired) {
          result = deferredResult(item, acquired.retryAfterMs);
          results.push(result);
          await finishClaim(item, leaseToken, result);
          continue;
        }
        reservation = acquired.reserved;
      }

      let measured = false;
      try {
        const requiredSince = asDate(item.required_since);
        const coverageSince = item.coverage_since ? asDate(item.coverage_since) : null;
        const coverageUntil = item.coverage_until ? asDate(item.coverage_until) : null;
        const runSince = collectionRunSince({
          requiredSince,
          coverageSince,
          coverageUntil,
          hasMore: item.has_more,
        });
        result = await runChannelIngest(item.channel_id, {
          since: runSince,
          until: asDate(item.required_until),
          limit: input.postLimit ?? 500,
          credentialOrgId: item.requested_by_org_id ?? undefined,
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
          warnings: [],
          error: err instanceof Error ? err.message : 'Unexpected collection failure.',
          retryable: true,
        };
      }
      if (measured) gate?.reconcile(reservation, result.apiCalls);
      results.push(result);
      await finishClaim(item, leaseToken, result);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

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
    else if (result.status === 'partial') { partial += 1; bucket.failed += 1; }
    else { failed += 1; bucket.failed += 1; }
    byPlatform[result.platform] = bucket;
  }

  const counts = await outstanding(input);
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
    complete: counts.remaining === 0,
    byPlatform,
    results,
  };
}
