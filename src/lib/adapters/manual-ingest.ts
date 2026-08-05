import type { Platform } from '@/lib/types';
import type { CollectionQueueSummary } from './collection-queue';

const DEFAULT_HISTORY_DAYS = 90;
const REGISTRATION_CONCURRENCY = 8;

export interface ManualIngestTargetRow {
  channelId: string;
  platform: Platform;
  handle: string;
  companyName: string;
  companySlug: string;
  lastIngestedAt: Date | string | null;
  landscapeId: string | null;
  orgId: string | null;
}

export interface ManualIngestTarget {
  channelId: string;
  platform: Platform;
  handle: string;
  companyName: string;
  companySlug: string;
  lastIngestedAt: Date | null;
  landscapeIds: string[];
  orgIds: string[];
}

export interface ManualIngestSelection {
  channel?: string;
  platforms?: readonly Platform[];
  companySlug?: string;
  maxChannels?: number;
}

export interface ManualIngestExecutionInput {
  selection: ManualIngestSelection;
  dryRun: boolean;
  since?: Date;
  until?: Date;
  postLimit?: number;
  concurrency?: number;
  now?: Date;
}

export interface ManualIngestExecution {
  targets: ManualIngestTarget[];
  eligibleTargets: ManualIngestTarget[];
  untrackedTargets: ManualIngestTarget[];
  since: Date;
  until: Date;
  registrationCalls: number;
  queueSignals: number;
  summary?: CollectionQueueSummary;
}

export interface ManualIngestDependencies {
  resolveTargets: (selection: ManualIngestSelection) => Promise<ManualIngestTarget[]>;
  enqueueChannelCollection: (input: {
    channelId: string;
    orgId: string;
    since: Date;
    until: Date;
    force: boolean;
  }) => Promise<number>;
  runCollectionQueue: (input: {
    channelIds: readonly string[];
    platforms?: readonly Platform[];
    maxChannels: number;
    postLimit?: number;
    concurrency?: number;
    /** An explicit CLI --since must be honored even after a limited-source watermark. */
    useRequiredSince?: boolean;
    /** Exact operator-selected attempt window; durable pooled demand remains monotonic. */
    runWindow?: { since: Date; until: Date };
  }) => Promise<CollectionQueueSummary>;
}

function parsedDate(value: Date | string | null): Date | null {
  if (value === null) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

/**
 * Collapse the landscape join into one globally pooled channel target.
 *
 * The input is already ordered stale-first. Applying the channel limit after
 * this collapse is important: limiting joined rows could drop an organization
 * from a shared account and fail to register that landscape's demand.
 */
export function groupManualIngestTargets(
  rows: readonly ManualIngestTargetRow[],
  maxChannels = 1_000,
): ManualIngestTarget[] {
  const grouped = new Map<string, ManualIngestTarget>();
  for (const row of rows) {
    let target = grouped.get(row.channelId);
    if (!target) {
      target = {
        channelId: row.channelId,
        platform: row.platform,
        handle: row.handle,
        companyName: row.companyName,
        companySlug: row.companySlug,
        lastIngestedAt: parsedDate(row.lastIngestedAt),
        landscapeIds: [],
        orgIds: [],
      };
      grouped.set(row.channelId, target);
    }
    if (row.landscapeId && !target.landscapeIds.includes(row.landscapeId)) {
      target.landscapeIds.push(row.landscapeId);
    }
    if (row.orgId && !target.orgIds.includes(row.orgId)) {
      target.orgIds.push(row.orgId);
    }
  }

  return [...grouped.values()].slice(0, maxChannels).map((target) => ({
    ...target,
    landscapeIds: target.landscapeIds.sort(),
    orgIds: target.orgIds.sort(),
  }));
}

export function manualIngestWindow(
  input: { since?: Date; until?: Date },
  now = new Date(),
): { since: Date; until: Date } {
  const until = input.until ?? now;
  const since = input.since
    ?? new Date(until.getTime() - DEFAULT_HISTORY_DAYS * 86_400_000);
  if (
    !Number.isFinite(since.getTime())
    || !Number.isFinite(until.getTime())
    || since >= until
  ) {
    throw new RangeError('Manual collection requires valid dates with since earlier than until.');
  }
  return { since, until };
}

async function forEachConcurrent<T>(
  values: readonly T[],
  concurrency: number,
  fn: (value: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor++;
      if (index >= values.length) return;
      await fn(values[index]);
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(concurrency, Math.max(1, values.length)) },
    () => worker(),
  ));
}

/**
 * Register every selected landscape demand before this process asks the shared
 * queue for claims. A concurrent dispatcher may claim earlier registration,
 * but it uses the same durable lease and therefore cannot duplicate the crawl.
 * This is the only execution path used by the manual CLI.
 *
 * Dry-run returns immediately after the read-only target resolution. Its
 * enqueue and queue dependencies are deliberately never touched, which makes
 * "preview" a testable no-write/no-vendor guarantee rather than a convention.
 */
export async function executeManualIngest(
  input: ManualIngestExecutionInput,
  dependencies: ManualIngestDependencies,
): Promise<ManualIngestExecution> {
  const targets = await dependencies.resolveTargets(input.selection);
  const eligibleTargets = targets.filter((target) => target.orgIds.length > 0);
  const untrackedTargets = targets.filter((target) => target.orgIds.length === 0);
  const { since, until } = manualIngestWindow(input, input.now);

  const base = {
    targets,
    eligibleTargets,
    untrackedTargets,
    since,
    until,
    registrationCalls: 0,
    queueSignals: 0,
  };
  if (input.dryRun || eligibleTargets.length === 0) return base;

  let registrationCalls = 0;
  let queueSignals = 0;
  await forEachConcurrent(eligibleTargets, REGISTRATION_CONCURRENCY, async (target) => {
    // One channel may be shared by landscapes in several organizations. The
    // queue helper registers every landscape in the given org, so call it once
    // per distinct org. Only the first registration forces the manual refresh:
    // a later org registration must not requeue a crawl that another leased
    // worker already completed while this loop was still registering demand.
    for (const [index, orgId] of target.orgIds.entries()) {
      queueSignals += await dependencies.enqueueChannelCollection({
        channelId: target.channelId,
        orgId,
        since,
        until,
        force: index === 0,
      });
      registrationCalls += 1;
    }
  });

  const summary = await dependencies.runCollectionQueue({
    channelIds: eligibleTargets.map((target) => target.channelId),
    platforms: input.selection.platforms,
    maxChannels: eligibleTargets.length,
    postLimit: input.postLimit,
    concurrency: input.concurrency,
    useRequiredSince: input.since !== undefined,
    ...(input.since !== undefined || input.until !== undefined
      ? { runWindow: { since, until } }
      : {}),
  });

  return { ...base, registrationCalls, queueSignals, summary };
}
