/**
 * The ingestion orchestrator.
 *
 * One job: take a channel row, ask its adapter for a window of data, and land
 * that data in Postgres in a way that is safe to run again five minutes later.
 * Everything else in this file exists to serve one of four constraints.
 *
 * 1. **Idempotence is not optional.** Cron overlaps, humans click Refresh, and
 *    a run that dies halfway will be retried. Every write here is an upsert
 *    keyed on something the platform owns, so running twice produces the same
 *    database as running once. The only append-only table is
 *    post_metric_snapshots, and it is keyed on the run's capture timestamp so a
 *    retry within the same run overwrites rather than duplicates.
 *
 * 2. **The Neon HTTP driver has no multi-statement transactions.** Each
 *    statement is its own HTTP round trip, so db.transaction is unavailable.
 *    That rules out "delete then insert" as an atomic pattern and rules out
 *    wrapping a channel's writes in a rollback boundary. The design response is
 *    ordering: posts land first, then everything that references them, and
 *    every dependent write is itself an upsert. A partial failure leaves a
 *    consistent-if-incomplete picture that the next run repairs.
 *
 * 3. **Postgres binds at most 65,535 parameters per statement.** A 300-post
 *    channel would blow that in a single multi-row insert, so every batch is
 *    chunked by column count rather than by a guessed row count.
 *
 * 4. **One bad channel must never take down the batch.** A newsroom watching
 *    fourteen competitors cannot lose the night because one Instagram token
 *    expired. Failures are caught per channel, written to ingestion_runs, and
 *    reported in the summary.
 */
import { SNAPSHOT_COLUMNS, snapshotValuesFor } from './snapshot-values';
import { and, asc, eq, gte, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  audienceSnapshots,
  channels,
  companies,
  ingestionRuns,
  postMetricSnapshots,
  postTagAssignments,
  postTags,
  postedUrls,
  posts,
  publicChannelSourceState,
} from '@/db/schema';
import type { Platform } from '@/lib/types';
import { channelExternalIdentity, channelIdentityKey } from '@/lib/channel-identity';
import { getAdapter } from './registry';
import { matchesRule, type TagRule } from './tagging';
import { computeEngagementTotal, toDayString } from './util/normalize';
import { publicSourceCredentials } from './public-sources';
import { sanitizePooledPostRaw } from '@/lib/post-preview-source';
import { installSpendMeter } from '@/lib/vendors/meter';

// Every Bright Data delivery any adapter receives gets written to the spend
// ledger from here on. Installed at runner load because the runner is the
// one entrypoint all pooled collection flows through.
installSpendMeter();
import { sanitizePooledAudienceExtra } from '@/lib/channel-profile-meta';
import { hasPendingBrightDataReceipt } from './brightdata-receipt';
import {
  publicSourceKeyForFetch,
  unselectedPublicSourceKey,
  type PublicSourceKey,
} from './public-source-provenance';
import {
  AdapterError,
  type ChannelAdapter,
  type CollectionOutcome,
  type FetchResult,
  type NormalizedPost,
} from './types';

/* ----------------------------------------------------------------- knobs */

/**
 * Conservative ceiling on bind parameters per statement. The real Postgres
 * limit is 65,535; staying well under it leaves room for the driver's own
 * parameters and keeps a single HTTP request small enough to be fast.
 */
const MAX_BIND_PARAMS = 8_000;
/** Never send more rows than this in one statement, regardless of width. */
const MAX_CHUNK_ROWS = 500;

/** How far back a channel with no ingest history reaches on its first run. */
const FIRST_RUN_LOOKBACK_DAYS = 90;
/**
 * Overlap re-read on every incremental run.
 *
 * Engagement on social is not immutable: a post keeps collecting likes for days.
 * Starting each run strictly at last_ingested_at would freeze every post's
 * metrics at the moment we first saw it, which would make the velocity curves
 * this product sells actively wrong. Two days of overlap is cheap on the open
 * platforms and is bounded on the metered ones by the adapter's own cursor.
 */
const REFRESH_OVERLAP_DAYS = 2;

const DEFAULT_POST_LIMIT = 500;

/* ----------------------------------------------------------------- types */

export interface RunChannelOptions {
  /** Overrides the computed window start. */
  since?: Date;
  until?: Date;
  limit?: number;
  /** Fetch and report, write nothing. */
  dryRun?: boolean;
  signal?: AbortSignal;
  /**
   * Org used only as a tag-rule fallback when a company is not in a landscape.
   *
   * This legacy name is retained for queue-call compatibility. It must never
   * influence credentials: pooled collection uses deployment public sources.
   */
  credentialOrgId?: string;
}

export type ChannelRunStatus = 'succeeded' | 'partial' | 'failed' | 'skipped';

export interface ChannelRunResult {
  channelId: string;
  platform: Platform;
  handle: string;
  companyName: string;
  status: ChannelRunStatus;
  postsUpserted: number;
  snapshotsUpserted: number;
  tagsAssigned: number;
  urlsRecorded: number;
  apiCalls: number;
  durationMs: number;
  hasMore: boolean;
  /** Exact source window used, null when no source request completed. */
  attemptedSince: Date | null;
  attemptedUntil: Date | null;
  /** Scheduler meaning. This, rather than `status`, decides what runs again. */
  outcome: CollectionOutcome;
  /** Whether the source certified that it exhausted the attempted window. */
  exhaustive: boolean | null;
  /** Source-provided reason why an attempted window could not be certified. */
  incompleteReason?: string;
  warnings: string[];
  error?: string;
  /** Legacy convenience derived from outcome; queue decisions never infer from it. */
  retryable?: boolean;
}

export interface PlatformSummary {
  attempted: number;
  succeeded: number;
  partial: number;
  failed: number;
  skipped: number;
  postsUpserted: number;
}

/* ------------------------------------------------------------- utilities */

/**
 * Split rows so no statement exceeds the parameter budget.
 *
 * Chunking by row count alone is the bug this avoids: 500 audience snapshots is
 * 2,500 parameters and perfectly safe, while 500 posts is over 12,000 and gets
 * slower with every column anyone adds to the schema.
 */
function chunkRows<T>(rows: T[], columnsPerRow: number): T[][] {
  const perChunk = Math.max(1, Math.min(MAX_CHUNK_ROWS, Math.floor(MAX_BIND_PARAMS / Math.max(1, columnsPerRow))));
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += perChunk) out.push(rows.slice(i, i + perChunk));
  return out;
}

function daysAgo(days: number, from: Date = new Date()): Date {
  return new Date(from.getTime() - days * 86_400_000);
}

function errorMessage(err: unknown): string {
  if (err instanceof AdapterError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

interface StableIdentityOwner {
  channelId: string;
  handle: string;
  companyName: string;
}

export type StableIdentityDecision =
  | {
      ok: true;
      externalId: string | null;
      shouldPersist: boolean;
    }
  | {
      ok: false;
      externalId: string | null;
      reason: 'invalid_source_identity' | 'identity_claimed_elsewhere' | 'stored_identity_changed';
      message: string;
    };

/**
 * Decide whether a source-resolved stable id may be attached to a pooled row.
 *
 * Handles are mutable display addresses. Once an account has a platform id,
 * changing that id in place would splice two accounts' observation histories
 * together. A second pooled row claiming the same id is equally unsafe. Both
 * cases require an explicit operator reconciliation; the runner never guesses
 * which history should survive.
 */
export function stableIdentityDecision(input: {
  channelId: string;
  platform: Platform;
  handle: string;
  storedExternalId: string | null | undefined;
  /** Undefined means this fetch did not include a profile identity. */
  fetchedExternalId: string | null | undefined;
  conflictingOwner?: StableIdentityOwner;
}): StableIdentityDecision {
  const storedExternalId = channelExternalIdentity(input.storedExternalId);
  if (input.fetchedExternalId === undefined) {
    if (!storedExternalId) {
      return {
        ok: false,
        externalId: null,
        reason: 'invalid_source_identity',
        message: 'Identity conflict for ' + input.platform + ' @' + input.handle
          + ': neither the pooled profile nor the source response provides a stable platform id. '
          + 'Resolve the account identity before retrying; no observations were written.',
      };
    }
    if (input.conflictingOwner && input.conflictingOwner.channelId !== input.channelId) {
      return {
        ok: false,
        externalId: storedExternalId,
        reason: 'identity_claimed_elsewhere',
        message: 'Identity conflict for ' + input.platform + ' @' + input.handle
          + ': platform id "' + storedExternalId + '" is already bound to @'
          + input.conflictingOwner.handle + ' (' + input.conflictingOwner.companyName
          + ', channel ' + input.conflictingOwner.channelId + '). Reconcile the duplicate pooled '
          + 'profiles explicitly; histories were not merged and no observations were written.',
      };
    }
    return {
      ok: true,
      externalId: storedExternalId,
      shouldPersist: false,
    };
  }

  const fetchedExternalId = channelExternalIdentity(input.fetchedExternalId);
  if (!fetchedExternalId) {
    return {
      ok: false,
      externalId: null,
      reason: 'invalid_source_identity',
      message: 'Identity conflict for ' + input.platform + ' @' + input.handle
        + ': the source returned a blank platform id. Correct the adapter or source response '
        + 'before retrying; no observations were written.',
    };
  }

  if (
    input.conflictingOwner
    && input.conflictingOwner.channelId !== input.channelId
  ) {
    return {
      ok: false,
      externalId: fetchedExternalId,
      reason: 'identity_claimed_elsewhere',
      message: 'Identity conflict for ' + input.platform + ' @' + input.handle
        + ': platform id "' + fetchedExternalId + '" is already bound to @'
        + input.conflictingOwner.handle + ' (' + input.conflictingOwner.companyName
        + ', channel ' + input.conflictingOwner.channelId + '). Reconcile the duplicate pooled '
        + 'profiles explicitly; histories were not merged and no observations were written.',
    };
  }

  if (storedExternalId && storedExternalId !== fetchedExternalId) {
    return {
      ok: false,
      externalId: fetchedExternalId,
      reason: 'stored_identity_changed',
      message: 'Identity conflict for ' + input.platform + ' @' + input.handle
        + ': this pooled profile is bound to platform id "' + storedExternalId
        + '", but the source resolved "' + fetchedExternalId + '". Review a possible handle '
        + 'reassignment and move or recreate the profile explicitly; no observations were written.',
    };
  }

  return {
    ok: true,
    externalId: fetchedExternalId,
    shouldPersist: input.storedExternalId !== fetchedExternalId,
  };
}

/**
 * Instagram's public vendors expose two different, legitimate account ids.
 *
 * EnsembleData returns Instagram's private numeric user id, while Bright Data's
 * observed profile schema returns the Meta graph id. Neither response contains
 * the other namespace. Treating that namespace change as a handle reassignment
 * blocks a valid fallback; accepting it from the handle alone could splice a
 * genuinely reassigned account into old history.
 *
 * A cross-source transition is therefore accepted only when the resolved
 * handle is the same AND at least one fetched post id or canonical permalink is
 * already attached to this pooled channel. The existing stored id remains the
 * canonical id. Every other mismatch still goes through the fail-closed gate.
 */
export function canRetainStoredInstagramIdentity(input: {
  platform: Platform;
  storedSource: unknown;
  fetchedSource: unknown;
  storedHandle: string;
  fetchedHandle: string;
  hasKnownPost: boolean;
}): boolean {
  if (input.platform !== 'instagram' || !input.hasKnownPost) return false;

  const sources = new Set([input.storedSource, input.fetchedSource]);
  if (!sources.has('ensembledata') || !sources.has('brightdata') || sources.size !== 2) {
    return false;
  }

  return channelIdentityKey('instagram', input.storedHandle)
    === channelIdentityKey('instagram', input.fetchedHandle);
}

/** Postgres unique violation, however many driver wrappers contain it. */
function isUniqueViolation(err: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = err;
  while (current !== null && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    if ((current as { code?: unknown }).code === '23505') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** Classify a source response before any database-write failures are considered. */
export function collectionOutcomeForFetch(
  fetched: Partial<Pick<FetchResult, 'hasMore' | 'exhaustive'>>,
): Extract<CollectionOutcome, 'certified_complete' | 'continuation' | 'terminal_source_limitation'> {
  // hasMore is the adapter contract for a persisted, resumable continuation.
  // It wins over exhaustive=false for a paid snapshot that is still running.
  if (fetched.hasMore === true) return 'continuation';
  // Runtime input can still come from an old deployment, a bad test double, or
  // untyped JavaScript. Certification requires both fields to be explicit.
  if (fetched.hasMore === false && fetched.exhaustive === true) return 'certified_complete';
  return 'terminal_source_limitation';
}

/**
 * Losing a paid continuation receipt makes the trigger outcome ambiguous.
 * Retrying automatically could purchase the same snapshot again, so this one
 * persistence failure is deliberately stricter than an ordinary cursor error.
 */
export function cursorPersistenceFailureOutcome(
  fetched: Partial<Pick<FetchResult, 'hasMore' | 'cursor'>>,
): Extract<CollectionOutcome, 'permanent_failure' | 'retryable_operational_failure'> {
  const cursor = fetched.cursor;
  const paidReceipt = fetched.hasMore === true
    && cursor?.source === 'brightdata'
    && typeof cursor.pendingSnapshotId === 'string'
    && cursor.pendingSnapshotId.trim().length > 0;
  return paidReceipt ? 'permanent_failure' : 'retryable_operational_failure';
}

/**
 * A paid source may return only a receipt while its snapshot is still running.
 *
 * Saving that receipt is not an observation write, so it is safe to defer the
 * stable-account check until the resumed snapshot returns a profile, audience,
 * or posts. The exception is deliberately narrow: an adapter must advertise a
 * real continuation, return no observations at all, and provide the generic
 * non-empty `nextCursor` that binds the follow-up to this same vendor job.
 */
export function canDeferIdentityForEmptyContinuation(
  fetched: Pick<FetchResult, 'posts' | 'audience' | 'profile' | 'cursor' | 'hasMore' | 'exhaustive'>,
): boolean {
  if (
    fetched.hasMore !== true
    || fetched.exhaustive !== false
    || fetched.posts.length !== 0
    || fetched.audience.length !== 0
    || fetched.profile !== undefined
  ) return false;

  const cursor = fetched.cursor;
  if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) return false;
  const nextCursor = (cursor as Record<string, unknown>).nextCursor;
  return typeof nextCursor === 'string' && nextCursor.trim().length > 0;
}

/**
 * A later Instagram post stage may still be collecting after Bright Data has
 * already returned its graph-id profile. Preserve that paid receipt without
 * writing the unverified profile or audience. The adapter binds these exact
 * identity fields into the receipt and restores them when the post rows arrive,
 * at which point known-post overlap can prove the cross-vendor namespace.
 */
export function canDeferBoundInstagramIdentity(
  fetched: Pick<FetchResult, 'posts' | 'profile' | 'cursor' | 'hasMore' | 'exhaustive'>,
): boolean {
  if (
    fetched.hasMore !== true
    || fetched.exhaustive !== false
    || fetched.posts.length !== 0
    || !fetched.profile
    || fetched.profile.meta?.source !== 'brightdata'
  ) return false;

  const cursor = fetched.cursor;
  if (!cursor || cursor.source !== 'brightdata') return false;
  const nextCursor = typeof cursor.nextCursor === 'string' ? cursor.nextCursor.trim() : '';
  return nextCursor.length > 0
    && cursor.pendingSnapshotId === nextCursor
    && cursor.pendingProfileExternalId === fetched.profile.externalId
    && cursor.pendingProfileHandle === fetched.profile.handle
    && cursor.pendingProfileSource === fetched.profile.meta.source;
}

/**
 * A quiet short-window fallback may return only Bright Data's alternate graph
 * id and no known post with which to bridge namespaces. That is not permission
 * to merge identities, but it is also not an operational failure: discard all
 * observations and settle the attempt as source-limited. A later deep pull can
 * still reconcile via the post rows' `user_posted_id`.
 */
export function canWithholdUnverifiedInstagramObservations(input: {
  platform: Platform;
  storedHandle: string;
  fetched: Pick<FetchResult, 'profile' | 'hasMore' | 'exhaustive'>;
}): boolean {
  const profile = input.fetched.profile;
  return input.platform === 'instagram'
    && input.fetched.hasMore === false
    && input.fetched.exhaustive === false
    && profile?.meta?.source === 'brightdata'
    && channelIdentityKey('instagram', input.storedHandle)
      === channelIdentityKey('instagram', profile.handle);
}

/**
 * Keys injected into adapter cursors must never persist. Double underscore
 * marks them.
 */
function stripEphemeralCursorKeys(cursor: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cursor)) {
    if (k.startsWith('__')) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Every channel/post row handled by this runner is globally pooled. Until
 * owned insights have org-private storage, force adapters onto their public,
 * competitor-comparable path even for legacy rows whose shared is_owned flag
 * is true. Sanitising first also neutralises any old ephemeral cursor flag.
 */
export function pooledFetchCursor(cursor: Record<string, unknown>): Record<string, unknown> {
  return { ...stripEphemeralCursorKeys(cursor), __isOwned: false };
}

/**
 * Resolve the source the deployment policy will call before network access.
 *
 * Multi-vendor adapters choose Bright Data whenever its deployment key is
 * present and use EnsembleData only when it is absent — except X, where the
 * official API leads whenever the deployment Bearer exists. Keeping the same
 * decision here lets the runner load only that source's durable cursor; if
 * this ever disagrees with the adapter's own order, the continuity guard will
 * discard every response from the mismatched source.
 */
export function selectedPublicSourceKey(
  platform: Platform,
  credentials: Record<string, string>,
): PublicSourceKey | undefined {
  const hasBrightData = Boolean(credentials.brightDataApiKey?.trim());
  const hasEnsemble = Boolean(credentials.ensembleDataToken?.trim());

  switch (platform) {
    case 'bluesky':
      return 'bluesky-public-appview';
    case 'youtube':
      return credentials.apiKey?.trim() ? 'youtube-data-api-v3' : undefined;
    case 'facebook':
      return hasBrightData ? 'brightdata' : undefined;
    case 'linkedin':
      return hasBrightData ? 'brightdata' : undefined;
    case 'reddit':
      return hasEnsemble ? 'ensembledata' : undefined;
    case 'truth_social':
      return credentials.apifyApiToken?.trim() ? 'apify-truth-social' : undefined;
    case 'instagram':
    case 'threads':
    case 'tiktok':
      return hasBrightData ? 'brightdata' : hasEnsemble ? 'ensembledata' : undefined;
    case 'twitter':
      // Must mirror twitterSourceOrder: the official API leads whenever the
      // deployment app-only Bearer is present (pay-per-use adoption, 17 Aug
      // 2026). This planner and the adapter's own order are two halves of one
      // decision — when they disagreed (planner said brightdata, adapter
      // answered x-api-v2), the source-continuity guard correctly refused to
      // write the mismatched response, which meant every successful paid API
      // read was fetched and then discarded. Change both together, always.
      return credentials.bearerToken?.trim()
        ? 'x-api-v2'
        : hasBrightData ? 'brightdata' : hasEnsemble ? 'ensembledata' : undefined;
    // RSS is retired and has no public source.
    case 'rss':
      return undefined;
  }
}

export interface PublicSourceCursorState {
  sourceKey: PublicSourceKey;
  cursor: Record<string, unknown>;
  lastIngestedAt: Date | null;
}

function explicitLegacySourceKey(
  platform: Platform,
  cursor: Record<string, unknown>,
): PublicSourceKey | undefined {
  const claimed = typeof cursor.source === 'string'
    ? cursor.source.trim().toLowerCase()
    : '';
  if (claimed === 'brightdata' || claimed === 'ensembledata') return claimed;
  if (platform === 'bluesky' && (claimed === 'bluesky' || claimed === 'bluesky-public-appview')) {
    return 'bluesky-public-appview';
  }
  if (platform === 'youtube' && (claimed === 'youtube' || claimed === 'youtube-data-api-v3')) {
    return 'youtube-data-api-v3';
  }
  if (platform === 'truth_social' && claimed === 'apify-truth-social') {
    return 'apify-truth-social';
  }
  return undefined;
}

/**
 * Compatibility bridge for channels written before source-scoped state.
 *
 * An explicitly attributed legacy cursor is reused only by the same source.
 * Source-less cursors are accepted only for platforms with one deployment-wide
 * public source, preventing an old Ensemble/owned cursor or watermark from
 * seeding a Bright Data cutover.
 */
export function legacyPublicSourceCursorState(input: {
  platform: Platform;
  sourceKey: PublicSourceKey;
  cursor: Record<string, unknown>;
  lastIngestedAt: Date | null;
}): PublicSourceCursorState {
  const hasExplicitSource = typeof input.cursor.source === 'string'
    && input.cursor.source.trim().length > 0;
  const explicit = explicitLegacySourceKey(input.platform, input.cursor);
  const sourceLessSingleSource = !hasExplicitSource && (
    (input.platform === 'bluesky' && input.sourceKey === 'bluesky-public-appview')
    || (input.platform === 'youtube' && input.sourceKey === 'youtube-data-api-v3')
    || (input.platform === 'reddit' && input.sourceKey === 'ensembledata')
    || (input.platform === 'truth_social' && input.sourceKey === 'apify-truth-social')
  );
  const compatible = explicit === input.sourceKey || sourceLessSingleSource;

  return {
    sourceKey: input.sourceKey,
    cursor: compatible ? stripEphemeralCursorKeys(input.cursor) : {},
    lastIngestedAt: compatible ? input.lastIngestedAt : null,
  };
}

/**
 * Prefer the source row except for one rolling-deploy safety case: a legacy
 * worker may have saved a newly purchased Bright Data receipt after migration
 * backfill but before the new runner deployed. Preserve that receipt when the
 * backfilled source row still has no pending paid work.
 */
export function reconcilePublicSourceCursorState(
  stored: PublicSourceCursorState,
  legacy: PublicSourceCursorState,
): PublicSourceCursorState {
  if (
    stored.sourceKey === 'brightdata'
    && legacy.sourceKey === stored.sourceKey
    && !hasPendingBrightDataReceipt(stored.cursor)
    && hasPendingBrightDataReceipt(legacy.cursor)
  ) {
    return {
      ...legacy,
      // A vendor switch can leave the global legacy watermark ambiguous. Keep
      // only the source row's timestamp while recovering the paid receipt.
      lastIngestedAt: stored.lastIngestedAt,
    };
  }
  return stored;
}

/** A saved paid receipt owns the next attempt even if its key disappeared. */
export function publicSourceCursorStateForAttempt(
  planned: PublicSourceCursorState,
  brightData: PublicSourceCursorState | undefined,
): PublicSourceCursorState {
  return planned.sourceKey !== 'brightdata'
    && brightData
    && hasPendingBrightDataReceipt(brightData.cursor)
    ? brightData
    : planned;
}

/** Responses may be persisted only against the source cursor used to fetch them. */
export function publicSourceResponseMatchesAttempt(
  attemptedSourceKey: PublicSourceKey,
  actualSourceKey: PublicSourceKey,
): boolean {
  return attemptedSourceKey === actualSourceKey;
}

export function mergedPublicSourceCursor(
  stored: Record<string, unknown>,
  fetched: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return stripEphemeralCursorKeys({ ...stored, ...(fetched ?? {}) });
}

/** True when the adapter has what it needs to run at all. */
function hasRequiredCredentials(adapter: ChannelAdapter, credentials: Record<string, string>): boolean {
  if (adapter.worksUnauthenticated) return true;
  const required = adapter.credentialFields.filter((f) => f.required);
  if (required.length === 0) return Object.keys(credentials).length > 0;
  return required.every((f) => Boolean(credentials[f.key]));
}

/* ---------------------------------------------------------- persistence */

/** Upsert one day of audience per channel. Re-running the same day overwrites. */
async function upsertAudience(
  channelId: string,
  audience: FetchResult['audience'],
  sourceRunId: string,
): Promise<number> {
  if (audience.length === 0) return 0;

  // A single run can legitimately produce two rows for the same day if an
  // adapter reports both a cached and a live figure. Last one wins, and
  // de-duplicating here avoids "ON CONFLICT DO UPDATE cannot affect row a
  // second time", which Postgres raises for duplicate keys inside one statement.
  const byDay = new Map<string, FetchResult['audience'][number]>();
  for (const row of audience) byDay.set(row.day, row);

  const values = Array.from(byDay.values()).map((a) => ({
    channelId,
    day: a.day,
    followers: Math.max(0, Math.round(a.followers)),
    following: typeof a.following === 'number' ? Math.max(0, Math.round(a.following)) : null,
    extra: sanitizePooledAudienceExtra(a.extra),
    sourceRunId,
    visibility: 'public_comparable',
    capturedAt: new Date(),
  }));

  let written = 0;
  for (const batch of chunkRows(values, 6)) {
    await db.insert(audienceSnapshots).values(batch).onConflictDoUpdate({
      target: [audienceSnapshots.channelId, audienceSnapshots.day],
      set: {
        followers: sql`excluded.followers`,
        following: sql`excluded.following`,
        extra: sql`excluded.extra`,
        sourceRunId: sql`excluded.source_run_id`,
        visibility: sql`excluded.visibility`,
        capturedAt: sql`excluded.captured_at`,
      },
    });
    written += batch.length;
  }
  return written;
}

interface FollowerPoint { day: string; followers: number }

/**
 * The follower timeline this channel has on record, oldest first.
 *
 * Loaded once per run and scanned in memory rather than issued as a correlated
 * subquery per post: a 300-post run would otherwise be 300 extra HTTP round
 * trips on the Neon driver.
 */
async function loadFollowerTimeline(channelId: string, fromDay: string, toDay: string): Promise<FollowerPoint[]> {
  const rows = await db
    .select({ day: audienceSnapshots.day, followers: audienceSnapshots.followers })
    .from(audienceSnapshots)
    .where(and(
      eq(audienceSnapshots.channelId, channelId),
      gte(audienceSnapshots.day, fromDay),
      lte(audienceSnapshots.day, toDay),
    ))
    .orderBy(asc(audienceSnapshots.day));
  return rows.map((r) => ({ day: r.day, followers: r.followers }));
}

/**
 * Followers at the moment a post went out.
 *
 * Primary rule: the nearest snapshot at or before the post. That is the honest
 * denominator, and it is what makes engagement rate comparable across accounts
 * of wildly different size.
 *
 * Bootstrap exception: on a channel's very first ingest there is no snapshot
 * older than the posts we just pulled, and a strict reading would zero the
 * headline metric for every historical post forever, since we can never
 * retroactively learn a follower count we did not record. In that case only, the
 * earliest snapshot we do have is used as an approximation. Follower counts move
 * slowly enough that this is a small error, and it is recorded in
 * posts.followers_at_post so the number is never invented at read time.
 */
function followersAt(postedAt: Date, timeline: FollowerPoint[]): number {
  if (timeline.length === 0) return 0;
  const day = toDayString(postedAt);
  let best = 0;
  for (const point of timeline) {
    if (point.day <= day) best = point.followers;
    else break;
  }
  return best > 0 ? best : timeline[0].followers;
}

interface PostRow {
  channelId: string;
  companyId: string;
  platform: Platform;
  externalId: string;
  postedAt: Date;
  type: NormalizedPost['type'];
  text: string | null;
  permalink: string | null;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  durationSec: number | null;
  language: string | null;
  hashtags: string[];
  mentions: string[];
  applause: number;
  conversation: number;
  amplification: number;
  saves: number;
  views: number;
  engagementTotal: number;
  engagementRateByFollower: number;
  engagementRateByView: number | null;
  followersAtPost: number | null;
  raw: Record<string, unknown> | null;
  sourceRunId: string;
  visibility: 'public_comparable';
  lastRefreshedAt: Date;
}

/** Columns per post row, used to size the insert batches. */
const POST_COLUMNS = 25;

function toPostRow(
  post: NormalizedPost,
  channelId: string,
  companyId: string,
  platform: Platform,
  timeline: FollowerPoint[],
  now: Date,
  sourceRunId: string,
): PostRow {
  const engagementTotal = computeEngagementTotal(post);
  const followers = followersAt(post.postedAt, timeline);

  return {
    channelId,
    companyId,
    platform,
    externalId: post.externalId,
    postedAt: post.postedAt,
    type: post.type,
    text: post.text ?? null,
    permalink: post.permalink ?? null,
    mediaUrl: post.mediaUrl ?? null,
    thumbnailUrl: post.thumbnailUrl ?? null,
    durationSec: post.durationSec ?? null,
    language: post.language ?? null,
    hashtags: post.hashtags,
    mentions: post.mentions,
    applause: post.applause,
    conversation: post.conversation,
    amplification: post.amplification,
    saves: post.saves,
    views: post.views,
    engagementTotal,
    // Guarded twice on purpose: a zero follower count is common (hidden
    // subscriber counts on YouTube, a brand-new account) and dividing by it
    // would put Infinity in a leaderboard.
    engagementRateByFollower: followers > 0 ? engagementTotal / followers : 0,
    engagementRateByView: post.views > 0 ? engagementTotal / post.views : null,
    followersAtPost: followers > 0 ? followers : null,
    raw: sanitizePooledPostRaw(platform, post.raw),
    sourceRunId,
    visibility: 'public_comparable',
    lastRefreshedAt: now,
  };
}

/**
 * Upsert posts and hand back their database ids.
 *
 * ON CONFLICT DO UPDATE, not DO NOTHING: the whole point of re-reading a window
 * is that engagement counts moved. RETURNING gives back conflicting rows too,
 * which is what makes the id map complete without a second SELECT.
 */
async function upsertPosts(rows: PostRow[]): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  if (rows.length === 0) return ids;

  // De-duplicate within the run: two pages of an adapter's feed occasionally
  // overlap, and Postgres refuses to update the same row twice in one statement.
  const byExternalId = new Map<string, PostRow>();
  for (const row of rows) byExternalId.set(row.externalId, row);

  for (const batch of chunkRows(Array.from(byExternalId.values()), POST_COLUMNS)) {
    const returned = await db.insert(posts).values(batch).onConflictDoUpdate({
      target: [posts.channelId, posts.externalId],
      set: {
        postedAt: sql`excluded.posted_at`,
        type: sql`excluded.type`,
        text: sql`excluded.text`,
        permalink: sql`excluded.permalink`,
        mediaUrl: sql`excluded.media_url`,
        thumbnailUrl: sql`excluded.thumbnail_url`,
        durationSec: sql`excluded.duration_sec`,
        language: sql`excluded.language`,
        hashtags: sql`excluded.hashtags`,
        mentions: sql`excluded.mentions`,
        applause: sql`excluded.applause`,
        conversation: sql`excluded.conversation`,
        amplification: sql`excluded.amplification`,
        saves: sql`excluded.saves`,
        views: sql`excluded.views`,
        engagementTotal: sql`excluded.engagement_total`,
        sourceRunId: sql`excluded.source_run_id`,
        visibility: sql`excluded.visibility`,
        engagementRateByFollower: sql`excluded.engagement_rate_by_follower`,
        engagementRateByView: sql`excluded.engagement_rate_by_view`,
        followersAtPost: sql`excluded.followers_at_post`,
        raw: sql`excluded.raw`,
        lastRefreshedAt: sql`excluded.last_refreshed_at`,
      },
    }).returning({ id: posts.id, externalId: posts.externalId });

    for (const row of returned) ids.set(row.externalId, row.id);
  }

  return ids;
}

/**
 * Append one metrics observation per post.
 *
 * This table is what makes engagement velocity recoverable: posts holds only
 * the latest numbers, so without a snapshot per run there is no way to answer
 * "how fast did this take off" after the fact. The primary key is
 * (post_id, captured_at) and captured_at is the run's start instant, so a
 * retried run overwrites its own row instead of laying down a duplicate.
 */
async function insertMetricSnapshots(
  postRows: PostRow[],
  ids: Map<string, string>,
  capturedAt: Date,
  sourceRunId: string,
): Promise<number> {
  // Mapping and in-run de-duplication live in snapshot-values.ts. The key
  // property: one row per (post_id, captured_at) within the statement, or the
  // ON CONFLICT DO UPDATE below rejects the whole batch.
  const values = snapshotValuesFor(postRows, ids, capturedAt, sourceRunId);

  if (values.length === 0) return 0;

  let written = 0;
  for (const batch of chunkRows(values, SNAPSHOT_COLUMNS)) {
    await db.insert(postMetricSnapshots).values(batch).onConflictDoUpdate({
      target: [postMetricSnapshots.postId, postMetricSnapshots.capturedAt],
      set: {
        applause: sql`excluded.applause`,
        conversation: sql`excluded.conversation`,
        amplification: sql`excluded.amplification`,
        saves: sql`excluded.saves`,
        views: sql`excluded.views`,
        engagementTotal: sql`excluded.engagement_total`,
        sourceRunId: sql`excluded.source_run_id`,
        visibility: sql`excluded.visibility`,
      },
    });
    written += batch.length;
  }
  return written;
}

/** Tracking parameters that change nothing about where a link points. */
const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|igshid$|mc_cid$|mc_eid$|s_campaign$|ref$|ref_src$|s$|t$)/i;

interface UrlRow {
  postId: string;
  companyId: string;
  url: string;
  canonicalUrl: string | null;
  domain: string;
  pathSegments: string[];
}

/**
 * Canonicalise for grouping, keep the original for linking.
 *
 * Two posts pointing at the same article with different campaign tags are the
 * same story, and a posted-URL leaderboard that treats them as two rows is
 * useless. The raw URL is still stored so the UI can link to exactly what was
 * posted.
 */
function canonicalise(raw: string): { url: URL; canonical: string } | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;

  const canonical = new URL(url.toString());
  canonical.hash = '';
  for (const key of Array.from(canonical.searchParams.keys())) {
    if (TRACKING_PARAMS.test(key)) canonical.searchParams.delete(key);
  }
  canonical.hostname = canonical.hostname.toLowerCase().replace(/^www\./, '');
  if (canonical.pathname.length > 1) canonical.pathname = canonical.pathname.replace(/\/+$/, '');

  return { url, canonical: canonical.toString() };
}

/**
 * Replace the URL rows for the posts we just touched.
 *
 * posted_urls has no unique constraint to upsert against, so idempotence comes
 * from delete-then-insert scoped to the affected post ids. Without a
 * transaction there is a window where a post has no URLs; it is measured in
 * milliseconds, it only affects posts being refreshed, and the alternative
 * (accumulating a duplicate row set on every run) would corrupt every
 * posted-URL count in the product.
 */
async function replacePostedUrls(
  normalized: NormalizedPost[],
  ids: Map<string, string>,
  companyId: string,
): Promise<number> {
  const touched = normalized
    .map((p) => ids.get(p.externalId))
    .filter((id): id is string => id !== undefined);
  if (touched.length === 0) return 0;

  for (const batch of chunkRows(touched, 1)) {
    await db.delete(postedUrls).where(inArray(postedUrls.postId, batch));
  }

  const values: UrlRow[] = [];
  for (const post of normalized) {
    const postId = ids.get(post.externalId);
    if (!postId) continue;
    const seen = new Set<string>();
    for (const rawUrl of post.urls) {
      const parsed = canonicalise(rawUrl);
      if (!parsed) continue;
      if (seen.has(parsed.canonical)) continue;
      seen.add(parsed.canonical);
      values.push({
        postId,
        companyId,
        url: rawUrl,
        canonicalUrl: parsed.canonical,
        domain: parsed.url.hostname.toLowerCase().replace(/^www\./, ''),
        pathSegments: parsed.url.pathname.split('/').filter(Boolean).slice(0, 10),
      });
    }
  }

  if (values.length === 0) return 0;

  let written = 0;
  for (const batch of chunkRows(values, 6)) {
    await db.insert(postedUrls).values(batch);
    written += batch.length;
  }
  return written;
}

/**
 * Every org whose landscapes include this company.
 *
 * Companies and posts are pooled, so one collection run produces rows that
 * several tenants read. Anything derived per-org from those rows has to be
 * derived for all of them, or it becomes a race decided by who refreshed last.
 */
async function orgsTrackingCompany(
  companyId: string,
  fallbackOrgId: string | null,
): Promise<string[]> {
  const { rows } = await db.execute<{ org_id: string }>(sql`
    SELECT DISTINCT l.org_id
      FROM landscape_companies lc
      JOIN landscapes l ON l.id = lc.landscape_id
     WHERE lc.company_id = ${companyId}::uuid
  `);
  const ids = rows.map((r) => r.org_id).filter(Boolean);
  if (ids.length > 0) return ids;
  // A company in no landscape yet: fall back to whoever asked for the run.
  return fallbackOrgId ? [fallbackOrgId] : [];
}

/**
 * Evaluate every rule-bearing tag in the org against this run's posts.
 *
 * Rules are re-evaluated on every run rather than only for new posts, because a
 * tag created today should attach itself to the posts that arrive in the same
 * window as the edit. ON CONFLICT DO NOTHING is deliberate: if a human already
 * assigned this tag by hand, that assignment carries source 'manual' and must
 * not be silently demoted to 'rule'.
 */
async function applyTagRules(
  orgId: string,
  platform: Platform,
  normalized: NormalizedPost[],
  ids: Map<string, string>,
): Promise<number> {
  if (normalized.length === 0) return 0;

  const tags = await db
    .select({ id: postTags.id, rule: postTags.rule })
    .from(postTags)
    .where(and(eq(postTags.orgId, orgId), sql`${postTags.rule} is not null`));

  const withRules = tags.filter((t): t is { id: string; rule: TagRule } => t.rule !== null);
  if (withRules.length === 0) return 0;

  const values: { postId: string; tagId: string; source: 'rule' }[] = [];
  for (const post of normalized) {
    const postId = ids.get(post.externalId);
    if (!postId) continue;
    for (const tag of withRules) {
      const matched = matchesRule(tag.rule, {
        text: post.text,
        hashtags: post.hashtags,
        mentions: post.mentions,
        urls: post.urls,
        platform,
        type: post.type,
      });
      if (matched) values.push({ postId, tagId: tag.id, source: 'rule' });
    }
  }

  if (values.length === 0) return 0;

  let written = 0;
  for (const batch of chunkRows(values, 3)) {
    await db.insert(postTagAssignments).values(batch).onConflictDoNothing({
      target: [postTagAssignments.postId, postTagAssignments.tagId],
    });
    written += batch.length;
  }
  return written;
}

/* ------------------------------------------------------- channel loading */

interface ChannelContext {
  channelId: string;
  platform: Platform;
  handle: string;
  profileUrl: string | null;
  externalId: string | null;
  cursor: Record<string, unknown>;
  lastIngestedAt: Date | null;
  companyId: string;
  companyName: string;
  companySlug: string;
  orgId: string | null;
}

const CHANNEL_SELECTION = {
  channelId: channels.id,
  platform: channels.platform,
  handle: channels.handle,
  profileUrl: channels.profileUrl,
  externalId: channels.externalId,
  cursor: channels.cursor,
  lastIngestedAt: channels.lastIngestedAt,
  companyId: companies.id,
  companyName: companies.name,
  companySlug: companies.slug,
  orgId: companies.orgId,
} as const;

async function loadChannel(channelId: string): Promise<ChannelContext | undefined> {
  const rows = await db
    .select(CHANNEL_SELECTION)
    .from(channels)
    .innerJoin(companies, eq(channels.companyId, companies.id))
    .where(eq(channels.id, channelId))
    .limit(1);
  return rows[0];
}

async function loadPublicSourceCursorState(
  channel: ChannelContext,
  sourceKey: PublicSourceKey,
): Promise<PublicSourceCursorState> {
  const rows = await db
    .select({
      cursor: publicChannelSourceState.cursor,
      lastIngestedAt: publicChannelSourceState.lastIngestedAt,
    })
    .from(publicChannelSourceState)
    .where(and(
      eq(publicChannelSourceState.channelId, channel.channelId),
      eq(publicChannelSourceState.sourceKey, sourceKey),
    ))
    .limit(1);
  const stored = rows[0];
  const legacy = legacyPublicSourceCursorState({
    platform: channel.platform,
    sourceKey,
    cursor: channel.cursor,
    lastIngestedAt: channel.lastIngestedAt,
  });
  return stored
    ? reconcilePublicSourceCursorState({ sourceKey, ...stored }, legacy)
    : legacy;
}

async function markPublicSourceAttempt(
  channelId: string,
  state: PublicSourceCursorState,
  attemptedAt: Date,
): Promise<void> {
  await db.insert(publicChannelSourceState).values({
    channelId,
    sourceKey: state.sourceKey,
    cursor: stripEphemeralCursorKeys(state.cursor),
    lastIngestedAt: state.lastIngestedAt,
    lastAttemptAt: attemptedAt,
    updatedAt: attemptedAt,
  }).onConflictDoUpdate({
    target: [publicChannelSourceState.channelId, publicChannelSourceState.sourceKey],
    set: {
      lastAttemptAt: attemptedAt,
      updatedAt: attemptedAt,
    },
  });
}

async function markPublicSourceError(
  channelId: string,
  state: PublicSourceCursorState,
  attemptedAt: Date,
  message: string,
): Promise<void> {
  try {
    await db.insert(publicChannelSourceState).values({
      channelId,
      sourceKey: state.sourceKey,
      cursor: stripEphemeralCursorKeys(state.cursor),
      lastIngestedAt: state.lastIngestedAt,
      lastAttemptAt: attemptedAt,
      lastError: message,
      updatedAt: attemptedAt,
    }).onConflictDoUpdate({
      target: [publicChannelSourceState.channelId, publicChannelSourceState.sourceKey],
      set: {
        lastAttemptAt: attemptedAt,
        lastError: message,
        updatedAt: attemptedAt,
      },
    });
  } catch {
    // The primary run/audit outcome still carries the error. Source-state
    // diagnostics are useful, but losing them must not replace that outcome.
  }
}

/**
 * Save the source-scoped cursor first, then mirror it to the legacy channel
 * columns for rolling-deploy and rollback compatibility.
 *
 * The source row is authoritative. Treat a mirror failure as a cursor failure
 * while old workers can still exist, so a paid continuation cannot be retried
 * from stale legacy state.
 */
async function persistPublicSourceCursor(input: {
  channel: ChannelContext;
  state: PublicSourceCursorState;
  fetchedCursor?: Record<string, unknown>;
  attemptedAt: Date;
  certifiedSourceWindow: boolean;
  profile?: FetchResult['profile'];
}): Promise<PublicSourceCursorState> {
  const cursor = mergedPublicSourceCursor(input.state.cursor, input.fetchedCursor);
  const lastIngestedAt = input.certifiedSourceWindow
    ? input.attemptedAt
    : input.state.lastIngestedAt;
  const saved = await db.insert(publicChannelSourceState).values({
    channelId: input.channel.channelId,
    sourceKey: input.state.sourceKey,
    cursor,
    lastIngestedAt,
    lastAttemptAt: input.attemptedAt,
    lastSuccessAt: input.attemptedAt,
    lastError: null,
    updatedAt: input.attemptedAt,
  }).onConflictDoUpdate({
    target: [publicChannelSourceState.channelId, publicChannelSourceState.sourceKey],
    set: {
      cursor,
      lastAttemptAt: input.attemptedAt,
      lastSuccessAt: input.attemptedAt,
      lastError: null,
      updatedAt: input.attemptedAt,
      ...(input.certifiedSourceWindow ? { lastIngestedAt: input.attemptedAt } : {}),
    },
  }).returning({ channelId: publicChannelSourceState.channelId });
  if (saved.length !== 1) {
    throw new Error('The public source cursor was not durably saved.');
  }

  const profile = input.profile;
  const mirrored = await db.update(channels).set({
    cursor,
    ...(input.certifiedSourceWindow ? { lastIngestedAt: input.attemptedAt } : {}),
    ...(profile?.profileUrl ? { profileUrl: profile.profileUrl } : {}),
    ...(profile?.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
  }).where(eq(channels.id, input.channel.channelId))
    .returning({ channelId: channels.id });
  if (mirrored.length !== 1) {
    throw new Error('The channel disappeared before its legacy cursor mirror was saved.');
  }

  return { sourceKey: input.state.sourceKey, cursor, lastIngestedAt };
}

async function findConflictingIdentityOwner(
  channel: Pick<ChannelContext, 'channelId' | 'platform'>,
  externalId: string,
): Promise<StableIdentityOwner | undefined> {
  const rows = await db
    .select({
      channelId: channels.id,
      handle: channels.handle,
      companyName: companies.name,
    })
    .from(channels)
    .innerJoin(companies, eq(companies.id, channels.companyId))
    .where(and(
      eq(channels.platform, channel.platform),
      ne(channels.id, channel.channelId),
      // The migration trims old rows, but keep the runtime gate safe while a
      // rolling deploy can still encounter legacy whitespace.
      sql`nullif(btrim(${channels.externalId}), '') = ${externalId}`,
    ))
    .limit(1);
  return rows[0];
}

async function hasKnownPostForFetchedProfile(
  channelId: string,
  fetchedPosts: NormalizedPost[],
): Promise<boolean> {
  const externalIds = [...new Set(fetchedPosts.map((post) => post.externalId.trim()).filter(Boolean))];
  if (externalIds.length > 0) {
    const matches = await db
      .select({ id: posts.id })
      .from(posts)
      .where(and(
        eq(posts.channelId, channelId),
        inArray(posts.externalId, externalIds),
      ))
      .limit(1);
    if (matches.length > 0) return true;
  }

  const permalinks = [...new Set(fetchedPosts
    .map((post) => post.permalink?.trim())
    .filter((permalink): permalink is string => Boolean(permalink)))];
  if (permalinks.length === 0) return false;

  const matches = await db
    .select({ id: posts.id })
    .from(posts)
    .where(and(
      eq(posts.channelId, channelId),
      inArray(posts.permalink, permalinks),
    ))
    .limit(1);
  return matches.length > 0;
}

async function identityForFetchedProfile(
  channel: ChannelContext,
  fetched: FetchResult,
): Promise<{ externalId: string | null | undefined; warning?: string }> {
  const profile = fetched.profile;
  const storedExternalId = channelExternalIdentity(channel.externalId);
  const fetchedExternalId = channelExternalIdentity(profile?.externalId);

  if (
    !profile
    || !storedExternalId
    || !fetchedExternalId
    || storedExternalId === fetchedExternalId
    || channel.platform !== 'instagram'
  ) {
    return { externalId: profile ? fetchedExternalId : undefined };
  }

  const storedSource = channel.cursor.source;
  const fetchedSource = profile.meta?.source;
  const sourcePair = new Set([storedSource, fetchedSource]);
  if (!sourcePair.has('ensembledata') || !sourcePair.has('brightdata') || sourcePair.size !== 2) {
    return { externalId: fetchedExternalId };
  }

  const hasKnownPost = await hasKnownPostForFetchedProfile(channel.channelId, fetched.posts);
  if (!canRetainStoredInstagramIdentity({
    platform: channel.platform,
    storedSource,
    fetchedSource,
    storedHandle: channel.handle,
    fetchedHandle: profile.handle,
    hasKnownPost,
  })) {
    return { externalId: fetchedExternalId };
  }

  return {
    externalId: storedExternalId,
    warning: 'Instagram source identity was verified across vendors by a matching known post. '
      + 'The existing canonical account id was retained.',
  };
}

/**
 * Claim a fetched platform id before any observations land.
 *
 * The conditional update plus the global unique index closes both races: this
 * row being rebound while the network request is in flight, and another row
 * claiming the same platform id after our read. A conflict is inspected and
 * returned to the caller; an unrelated database error still throws so it can
 * be scheduled as an operational retry.
 */
async function enforceStableIdentity(
  channel: ChannelContext,
  fetchedExternalId: string | null | undefined,
  persist: boolean,
): Promise<StableIdentityDecision> {
  const normalizedExternalId = fetchedExternalId === undefined
    ? channelExternalIdentity(channel.externalId)
    : channelExternalIdentity(fetchedExternalId);
  const conflictingOwner = normalizedExternalId
    ? await findConflictingIdentityOwner(channel, normalizedExternalId)
    : undefined;
  const initial = stableIdentityDecision({
    channelId: channel.channelId,
    platform: channel.platform,
    handle: channel.handle,
    storedExternalId: channel.externalId,
    fetchedExternalId,
    conflictingOwner,
  });
  if (!initial.ok || !persist || !initial.shouldPersist || !initial.externalId) return initial;

  try {
    const updated = await db
      .update(channels)
      .set({ externalId: initial.externalId })
      .where(and(
        eq(channels.id, channel.channelId),
        eq(channels.platform, channel.platform),
        or(
          isNull(channels.externalId),
          sql`nullif(btrim(${channels.externalId}), '') = ${initial.externalId}`,
        ),
      ))
      .returning({ channelId: channels.id });
    if (updated.length === 1) {
      return { ...initial, shouldPersist: false };
    }
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    // A concurrent row won the external-id claim. Re-read below so the audit
    // names the exact record an operator needs to reconcile.
  }

  const currentRows = await db
    .select({ externalId: channels.externalId })
    .from(channels)
    .where(eq(channels.id, channel.channelId))
    .limit(1);
  const current = currentRows[0];
  if (!current) {
    throw new Error(
      'Channel ' + channel.channelId + ' disappeared before its stable identity could be saved.',
    );
  }

  const ownerAfterRace = await findConflictingIdentityOwner(channel, initial.externalId);
  const afterRace = stableIdentityDecision({
    channelId: channel.channelId,
    platform: channel.platform,
    handle: channel.handle,
    storedExternalId: current.externalId,
    fetchedExternalId: initial.externalId,
    conflictingOwner: ownerAfterRace,
  });
  if (!afterRace.ok || !afterRace.shouldPersist) return afterRace;

  throw new Error(
    'Stable platform id "' + initial.externalId + '" could not be persisted for channel '
      + channel.channelId + '; no observations were written.',
  );
}

/** Record the outcome of a run. Never throws: a failed audit write must not mask a failed ingest. */
async function recordRun(
  channel: Pick<ChannelContext, 'channelId' | 'platform'>,
  result: Omit<ChannelRunResult, 'channelId' | 'platform' | 'handle' | 'companyName'>,
  startedAt: Date,
  window?: { since: Date; until: Date },
  sourceRunId?: string,
  sourceKey?: string,
): Promise<void> {
  const status = result.status === 'skipped'
    ? 'failed'
    : result.status === 'partial' ? 'partial' : result.status === 'failed' ? 'failed' : 'succeeded';

  try {
    const detail = {
        durationMs: result.durationMs,
        warnings: result.warnings,
        hasMore: result.hasMore,
        retryable: result.retryable ?? null,
        exhaustive: result.exhaustive,
        incompleteReason: result.incompleteReason ?? null,
        requestedSince: window?.since.toISOString() ?? null,
        requestedUntil: window?.until.toISOString() ?? null,
        tagsAssigned: result.tagsAssigned,
        urlsRecorded: result.urlsRecorded,
        outcome: result.outcome,
        presentationStatus: result.status,
      };
    if (!sourceRunId) throw new Error('Missing source run id for pooled run audit.');
    await db.update(ingestionRuns).set({
      status,
      finishedAt: new Date(startedAt.getTime() + result.durationMs),
      postsUpserted: result.postsUpserted,
      snapshotsUpserted: result.snapshotsUpserted,
      apiCalls: result.apiCalls,
      error: result.error ?? null,
      detail,
      sourceKey: sourceKey ?? unselectedPublicSourceKey(channel.platform),
    }).where(eq(ingestionRuns.id, sourceRunId));
  } catch {
    // The run itself already happened; losing its audit row is not worth
    // failing over, and the caller still gets the result.
  }
}

async function startPooledRun(channel: Pick<ChannelContext, 'channelId' | 'platform'>, startedAt: Date): Promise<string> {
  const [row] = await db.insert(ingestionRuns).values({
    channelId: channel.channelId,
    platform: channel.platform,
    status: 'running',
    startedAt,
    sourceKey: unselectedPublicSourceKey(channel.platform),
    visibility: 'public_comparable',
  }).returning({ id: ingestionRuns.id });
  if (!row?.id) throw new Error('Could not create the public source run audit row.');
  return row.id;
}

/* --------------------------------------------------------- the main path */

/**
 * Ingest one channel end to end.
 *
 * Ordering is load-bearing. Audience lands before posts because posts need a
 * follower denominator; posts land before snapshots, URLs and tags because all
 * three reference post ids; source-specific cursor state and its legacy channel
 * mirror are written last so a crash anywhere earlier means the next run
 * re-reads the same window rather than skipping it. With no transaction
 * available, "re-read on failure" is the only safe direction to fail in.
 */
export async function runChannelIngest(
  channelId: string,
  opts: RunChannelOptions = {},
): Promise<ChannelRunResult> {
  const startedAt = new Date();
  const channel = await loadChannel(channelId);

  if (!channel) {
    return {
      channelId,
      platform: 'rss',
      handle: '',
      companyName: '',
      status: 'failed',
      postsUpserted: 0, snapshotsUpserted: 0, tagsAssigned: 0, urlsRecorded: 0,
      apiCalls: 0, durationMs: Date.now() - startedAt.getTime(), hasMore: false,
      attemptedSince: null, attemptedUntil: null,
      outcome: 'permanent_failure', exhaustive: null,
      warnings: [],
      error: 'No channel with id ' + channelId,
      retryable: false,
    };
  }

  const base = {
    channelId: channel.channelId,
    platform: channel.platform,
    handle: channel.handle,
    companyName: channel.companyName,
  };

  let apiCalls = 0;
  let sourceRunId: string | undefined;
  let runSourceKey = unselectedPublicSourceKey(channel.platform);
  const warnings: string[] = [];
  const fail = async (
    message: string,
    status: ChannelRunStatus = 'failed',
    retryable = status !== 'skipped',
  ): Promise<ChannelRunResult> => {
    const partial = {
      status,
      postsUpserted: 0, snapshotsUpserted: 0, tagsAssigned: 0, urlsRecorded: 0,
      apiCalls, durationMs: Date.now() - startedAt.getTime(), hasMore: false,
      attemptedSince: null, attemptedUntil: null,
      outcome: retryable
        ? 'retryable_operational_failure' as const
        : 'permanent_failure' as const,
      exhaustive: null,
      warnings, error: message,
      retryable,
    };
    if (!opts.dryRun) await recordRun(channel, partial, startedAt, undefined, sourceRunId, runSourceKey);
    return { ...base, ...partial };
  };

  if (!opts.dryRun) {
    try {
      sourceRunId = await startPooledRun(channel, startedAt);
    } catch (err) {
      return { ...base, ...(await fail('Could not establish the public source audit row: ' + errorMessage(err), 'failed', false)) };
    }
  }

  let adapter: ChannelAdapter;
  try {
    adapter = getAdapter(channel.platform);
  } catch (err) {
    return fail(
      errorMessage(err),
      'failed',
      err instanceof AdapterError ? err.opts.retryable === true : false,
    );
  }

  // Pooled rows are global, so collection credentials must be global and
  // public-comparable too. requestedByOrgId/company ownership still matters to
  // private tag fan-out below, but never to source selection.
  const credentials = publicSourceCredentials(channel.platform);

  if (!hasRequiredCredentials(adapter, credentials)) {
    const missing = adapter.credentialFields.filter((f) => f.required && !credentials[f.key]).map((f) => f.key);
    return fail(
      'No usable credentials for ' + adapter.displayName + '. Missing: '
      + (missing.length > 0 ? missing.join(', ') : 'all fields') + '.',
      'skipped',
      false,
    );
  }

  const plannedSourceKey = selectedPublicSourceKey(channel.platform, credentials);
  if (!plannedSourceKey) {
    return fail(
      'No approved public-comparable source is configured for ' + adapter.displayName + '.',
      'skipped',
      false,
    );
  }
  runSourceKey = plannedSourceKey;

  let sourceState: PublicSourceCursorState;
  try {
    sourceState = await loadPublicSourceCursorState(channel, plannedSourceKey);
    if (
      plannedSourceKey !== 'brightdata'
      && (
        channel.platform === 'instagram'
        || channel.platform === 'threads'
        || channel.platform === 'tiktok'
        || channel.platform === 'twitter'
      )
    ) {
      const brightDataState = await loadPublicSourceCursorState(channel, 'brightdata');
      const attemptState = publicSourceCursorStateForAttempt(sourceState, brightDataState);
      if (attemptState.sourceKey === 'brightdata') {
        // A missing Bright Data key must not make an already-paid receipt
        // disappear behind another source's cursor. Pass the isolated receipt
        // back to the adapter so it fails closed until the key is restored.
        sourceState = attemptState;
        runSourceKey = 'brightdata';
      }
    }
  } catch (err) {
    return fail(
      'Could not load source-specific public cursor state before collection: ' + errorMessage(err),
      'failed',
      true,
    );
  }

  // Incremental by default, with deliberate overlap so engagement counts on
  // recent posts keep moving. A caller-supplied window always wins.
  const cursorWindowSince = typeof sourceState.cursor.windowSince === 'string'
    ? new Date(sourceState.cursor.windowSince)
    : null;
  const cursorWindowUntil = typeof sourceState.cursor.windowUntil === 'string'
    ? new Date(sourceState.cursor.windowUntil)
    : null;
  const hasPendingCursorWindow = Boolean(
    sourceState.cursor.nextCursor
      && cursorWindowSince && !Number.isNaN(cursorWindowSince.getTime())
      && cursorWindowUntil && !Number.isNaN(cursorWindowUntil.getTime()),
  );
  const until = hasPendingCursorWindow && cursorWindowUntil
    ? cursorWindowUntil
    : opts.until ?? new Date();
  const since = hasPendingCursorWindow && cursorWindowSince
    ? cursorWindowSince
    : opts.since
    ?? (sourceState.lastIngestedAt
      ? daysAgo(REFRESH_OVERLAP_DAYS, sourceState.lastIngestedAt)
      : daysAgo(FIRST_RUN_LOOKBACK_DAYS, until));

  if (!opts.dryRun) {
    try {
      await markPublicSourceAttempt(channel.channelId, sourceState, startedAt);
    } catch (err) {
      return fail(
        'Could not establish source-specific attempt state before collection: ' + errorMessage(err),
        'failed',
        true,
      );
    }
  }

  const attemptedSourceKey = sourceState.sourceKey;
  let fetched: FetchResult;
  try {
    fetched = await adapter.fetch({
      handle: channel.handle,
      profileUrl: channel.profileUrl,
      externalId: channel.externalId,
      // The row is pooled even when a legacy channels.is_owned bit is true.
      // Force the public path until owned insights have org-private storage.
      cursor: pooledFetchCursor(sourceState.cursor),
      since,
      until,
      credentials,
      limit: opts.limit ?? DEFAULT_POST_LIMIT,
      onApiCall: () => { apiCalls++; },
      signal: opts.signal,
    });
  } catch (err) {
    if (!opts.dryRun) {
      await markPublicSourceError(
        channel.channelId,
        sourceState,
        startedAt,
        errorMessage(err),
      );
    }
    return fail(
      errorMessage(err),
      'failed',
      err instanceof AdapterError ? err.opts.retryable !== false : true,
    );
  }

  warnings.push(...(fetched.warnings ?? []));

  const stopAfterFetch = async (
    message: string,
    outcome: Extract<CollectionOutcome, 'permanent_failure' | 'retryable_operational_failure'>,
  ): Promise<ChannelRunResult> => {
    const stopped = {
      status: 'failed' as const,
      postsUpserted: 0,
      snapshotsUpserted: 0,
      tagsAssigned: 0,
      urlsRecorded: 0,
      apiCalls,
      durationMs: Date.now() - startedAt.getTime(),
      hasMore: fetched.hasMore ?? false,
      attemptedSince: since,
      attemptedUntil: until,
      outcome,
      exhaustive: fetched.exhaustive === true,
      incompleteReason: fetched.incompleteReason,
      warnings,
      error: message,
      retryable: outcome === 'retryable_operational_failure',
    };
    if (!opts.dryRun) {
      await markPublicSourceError(channel.channelId, sourceState, startedAt, message);
      await recordRun(channel, stopped, startedAt, { since, until }, sourceRunId, runSourceKey);
    }
    return { ...base, ...stopped };
  };

  let actualSourceKey: PublicSourceKey;
  try {
    actualSourceKey = publicSourceKeyForFetch(channel.platform, fetched);
  } catch (err) {
    return stopAfterFetch(
      'Public source provenance could not be established: ' + errorMessage(err),
      'permanent_failure',
    );
  }
  runSourceKey = actualSourceKey;
  if (!publicSourceResponseMatchesAttempt(attemptedSourceKey, actualSourceKey)) {
    return stopAfterFetch(
      'Public source changed from "' + attemptedSourceKey + '" to "' + actualSourceKey
        + '" after the request began. The response was not written because it cannot be applied '
        + 'to a different source cursor; explicit source-aware failover is required.',
      'permanent_failure',
    );
  }

  let identity: StableIdentityDecision;
  try {
    const fetchedIdentity = await identityForFetchedProfile(channel, fetched);
    if (fetchedIdentity.warning) warnings.push(fetchedIdentity.warning);
    identity = await enforceStableIdentity(
      channel,
      fetchedIdentity.externalId,
      !opts.dryRun,
    );
  } catch (err) {
    return stopAfterFetch(
      'Stable identity could not be checked before observation writes: ' + errorMessage(err),
      'retryable_operational_failure',
    );
  }
  if (!identity.ok) {
    const deferredEmptyIdentity =
      identity.reason === 'invalid_source_identity'
      && canDeferIdentityForEmptyContinuation(fetched);
    const deferredBoundInstagramIdentity =
      identity.reason === 'stored_identity_changed'
      && channel.platform === 'instagram'
      && canDeferBoundInstagramIdentity(fetched);
    if (deferredEmptyIdentity || deferredBoundInstagramIdentity) {
      const deferredWarning = deferredBoundInstagramIdentity
        ? 'Bright Data returned its alternate Instagram graph id while the paid post snapshot '
          + 'is still collecting. Data Dumpster saved the bound receipt but wrote no profile, '
          + 'audience, or post observations. The resumed rows must match known content before '
          + 'the existing pooled identity is retained.'
        : 'The source is still preparing this profile. Data Dumpster saved its continuation '
          + 'receipt and will verify the stable account identity before writing any audience '
          + 'or post observations.';
      const deferred = {
        status: 'partial' as const,
        postsUpserted: 0,
        snapshotsUpserted: 0,
        tagsAssigned: 0,
        urlsRecorded: 0,
        apiCalls,
        durationMs: Date.now() - startedAt.getTime(),
        hasMore: true,
        attemptedSince: since,
        attemptedUntil: until,
        outcome: 'continuation' as const,
        exhaustive: false as const,
        incompleteReason: fetched.incompleteReason,
        warnings: [...warnings, deferredWarning],
        retryable: true,
      };

      if (!opts.dryRun) {
        try {
          sourceState = await persistPublicSourceCursor({
            channel,
            state: sourceState,
            fetchedCursor: fetched.cursor,
            attemptedAt: startedAt,
            certifiedSourceWindow: false,
          });
        } catch (err) {
          const cursorFailureOutcome = cursorPersistenceFailureOutcome(fetched);
          return stopAfterFetch(
            cursorFailureOutcome === 'permanent_failure'
              ? 'The paid source is still running, but its Bright Data continuation state for '
                + 'stage "' + String(fetched.cursor?.brightDataStage ?? 'unknown')
                + '" could not be fully persisted. Automatic retry is stopped to prevent a duplicate '
                + 'purchase; operator review is required. ' + errorMessage(err)
              : 'The source is still running, but its continuation receipt could not be saved: '
                + errorMessage(err),
            cursorFailureOutcome,
          );
        }
        await recordRun(channel, deferred, startedAt, { since, until }, sourceRunId, runSourceKey);
      }
      return { ...base, ...deferred };
    }

    if (
      identity.reason === 'stored_identity_changed'
      && canWithholdUnverifiedInstagramObservations({
        platform: channel.platform,
        storedHandle: channel.handle,
        fetched,
      })
    ) {
      const withheldWarning = 'Bright Data returned its alternate Instagram graph id, but this '
        + 'short window contained no known post that could reconcile it with the stored account. '
        + 'Data Dumpster retained the existing identity and wrote no profile, audience, or post '
        + 'observations from this attempt. A deep pull can verify the account from post-row owner ids.';
      const withheld = {
        status: 'partial' as const,
        postsUpserted: 0,
        snapshotsUpserted: 0,
        tagsAssigned: 0,
        urlsRecorded: 0,
        apiCalls,
        durationMs: Date.now() - startedAt.getTime(),
        hasMore: false,
        attemptedSince: since,
        attemptedUntil: until,
        outcome: 'terminal_source_limitation' as const,
        exhaustive: false as const,
        incompleteReason: fetched.incompleteReason,
        warnings: [...warnings, withheldWarning],
        retryable: false,
      };

      if (!opts.dryRun) {
        try {
          sourceState = await persistPublicSourceCursor({
            channel,
            state: sourceState,
            fetchedCursor: fetched.cursor,
            attemptedAt: startedAt,
            certifiedSourceWindow: false,
          });
        } catch (err) {
          return stopAfterFetch(
            'Unverified Instagram observations were withheld, but the source cursor could not be '
              + 'fully saved: ' + errorMessage(err),
            'retryable_operational_failure',
          );
        }
        await recordRun(channel, withheld, startedAt, { since, until }, sourceRunId, runSourceKey);
      }
      return { ...base, ...withheld };
    }
    return stopAfterFetch(identity.message, 'permanent_failure');
  }

  if (opts.dryRun) {
    const outcome = collectionOutcomeForFetch(fetched);
    return {
      ...base,
      status: outcome === 'certified_complete' ? 'succeeded' : 'partial',
      postsUpserted: fetched.posts.length,
      snapshotsUpserted: fetched.audience.length,
      tagsAssigned: 0,
      urlsRecorded: fetched.posts.reduce((n, p) => n + p.urls.length, 0),
      apiCalls,
      durationMs: Date.now() - startedAt.getTime(),
      hasMore: fetched.hasMore ?? false,
      attemptedSince: since,
      attemptedUntil: until,
      outcome,
      exhaustive: fetched.exhaustive === true,
      incompleteReason: fetched.incompleteReason,
      warnings,
      retryable: outcome === 'continuation',
    };
  }

  let snapshotsUpserted = 0;
  let postsUpserted = 0;
  let tagsAssigned = 0;
  let urlsRecorded = 0;
  let status: ChannelRunStatus = 'succeeded';

  try {
    if (!sourceRunId) throw new Error('Missing source run provenance before audience write.');
    snapshotsUpserted = await upsertAudience(channel.channelId, fetched.audience, sourceRunId);

    if (fetched.posts.length > 0) {
      const days = fetched.posts.map((p) => toDayString(p.postedAt)).sort();
      const timeline = await loadFollowerTimeline(
        channel.channelId,
        // Reach back beyond the oldest post so a channel ingested last month
        // still finds a denominator for a post from the start of this window.
        toDayString(daysAgo(FIRST_RUN_LOOKBACK_DAYS, new Date(days[0] + 'T00:00:00Z'))),
        toDayString(until),
      );

      const rows = fetched.posts.map((p) => toPostRow(
        p, channel.channelId, channel.companyId, channel.platform, timeline, startedAt, sourceRunId,
      ));

      const ids = await upsertPosts(rows);
      postsUpserted = ids.size;

      snapshotsUpserted += await insertMetricSnapshots(rows, ids, startedAt, sourceRunId);
      urlsRecorded = await replacePostedUrls(fetched.posts, ids, channel.companyId);
      /*
       * Tag rules run for EVERY org that tracks this channel, not just the one
       * whose refresh happened to trigger the run.
       *
       * channel_collection_state is keyed on channel_id alone, one row per
       * pooled channel globally, and requested_by_org_id is last-writer-wins.
       * So whichever org pressed Refresh most recently decided whose rules
       * fired, and every other org tracking the same competitor silently
       * stopped being tagged. Nothing errored and nothing was logged; their
       * tagged-post counts just quietly stopped moving.
       *
       * Posts are pooled, so this is a fan-out over org-private rules against
       * shared rows: each org gets its own assignments and sees only its own.
       */
      const tagFallbackOrgId = opts.credentialOrgId ?? channel.orgId;
      const trackingOrgs = await orgsTrackingCompany(channel.companyId, tagFallbackOrgId);
      for (const org of trackingOrgs) {
        tagsAssigned += await applyTagRules(org, channel.platform, fetched.posts, ids);
      }
    }
  } catch (err) {
    // Some writes may have landed. The run is marked partial rather than
    // failed, the cursor is deliberately NOT advanced, and the next run
    // re-reads the same window and completes the missing writes.
    const message = errorMessage(err);
    const partial = {
      status: 'partial' as ChannelRunStatus,
      postsUpserted, snapshotsUpserted, tagsAssigned, urlsRecorded, apiCalls,
      durationMs: Date.now() - startedAt.getTime(),
      hasMore: fetched.hasMore ?? false,
      attemptedSince: since,
      attemptedUntil: until,
      outcome: 'retryable_operational_failure' as const,
      exhaustive: fetched.exhaustive === true,
      incompleteReason: fetched.incompleteReason,
      warnings,
      error: message,
      retryable: true,
    };
    await markPublicSourceError(channel.channelId, sourceState, startedAt, message);
    await recordRun(channel, partial, startedAt, { since, until }, sourceRunId, runSourceKey);
    return { ...base, ...partial };
  }

  // Cursor and watermark last, so any failure above leaves the window unclaimed.
  let cursorError: string | undefined;
  try {
    const certifiedSourceWindow = fetched.hasMore === false && fetched.exhaustive === true;
    sourceState = await persistPublicSourceCursor({
      channel,
      state: sourceState,
      fetchedCursor: fetched.cursor,
      attemptedAt: startedAt,
      certifiedSourceWindow,
      profile: fetched.profile,
    });
  } catch (err) {
    status = 'partial';
    cursorError = 'Data landed but its public source cursor state could not be fully saved: '
      + errorMessage(err);
    await markPublicSourceError(channel.channelId, sourceState, startedAt, cursorError);
  }

  const sourceOutcome = collectionOutcomeForFetch(fetched);

  if (sourceOutcome === 'continuation') {
    status = 'partial';
    warnings.push('More history remains. This profile stays in the collection queue.');
  }

  if (sourceOutcome === 'terminal_source_limitation') {
    status = 'partial';
    warnings.push(
      fetched.incompleteReason
        ?? 'The adapter did not explicitly certify the requested window or provide a durable continuation.',
    );
  }

  const outcome: CollectionOutcome = cursorError
    ? cursorPersistenceFailureOutcome(fetched)
    : sourceOutcome;
  if (cursorError && outcome === 'permanent_failure') {
    cursorError += ' Automatic retry is stopped to prevent a duplicate Bright Data purchase; '
      + 'operator review is required before clearing or replacing any receipt state.';
  }
  if (cursorError) warnings.push(cursorError);
  const result = {
    status,
    postsUpserted, snapshotsUpserted, tagsAssigned, urlsRecorded, apiCalls,
    durationMs: Date.now() - startedAt.getTime(),
    hasMore: fetched.hasMore ?? false,
    attemptedSince: since,
    attemptedUntil: until,
    outcome,
    exhaustive: fetched.exhaustive === true,
    incompleteReason: fetched.incompleteReason,
    warnings,
    error: cursorError,
    retryable: outcome === 'continuation' || outcome === 'retryable_operational_failure',
  };
  await recordRun(channel, result, startedAt, { since, until }, sourceRunId, runSourceKey);
  return { ...base, ...result };
}
