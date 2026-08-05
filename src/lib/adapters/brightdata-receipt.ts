/**
 * Durable receipts for Bright Data's trigger-and-poll snapshots.
 *
 * A pending snapshot is paid work, not an ordinary retryable failure. The
 * receipt is bound to one adapter stage and one exact requested window so a
 * later worker can poll the same snapshot without accidentally starting a
 * second job or applying its rows to a different collection window.
 */
import { PendingSnapshotError } from '@/lib/vendors/brightdata';
import type { Platform } from '@/lib/types';
import { AdapterError } from './types';
import type { AdapterProfile, FetchContext, FetchResult, NormalizedAudience } from './types';

export const BRIGHTDATA_RECEIPT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** One recovery purchase is enough; a second stuck replacement needs a human. */
export const BRIGHTDATA_MAX_AUTOMATIC_REPLACEMENTS = 1;

type ReceiptContext = Pick<FetchContext, 'cursor' | 'since' | 'until'>;

export interface BrightDataStageSpec {
  platform: Platform;
  stage: string;
  datasetId: string;
  /** Used only by deterministic tests; production always uses the current time. */
  now?: Date;
  /** Upgrade the original Facebook-only receipt shape without repurchasing it. */
  legacyStage?: string;
  legacyDatasetId?: string;
}

interface ActiveReceipt {
  snapshotId: string;
  pendingSince: string;
  resumeSnapshotId?: string;
  replacementAttempts: number;
  automaticReplacement: boolean;
  finalRecoveryPoll: boolean;
  /** Old Facebook receipts can be polled once, but never replaced automatically. */
  legacyUnbound: boolean;
  warnings: string[];
}

export type BrightDataStageResult<T> =
  | {
      kind: 'complete';
      value: T;
      warnings: string[];
      resumed: boolean;
    }
  | {
      kind: 'continuation';
      result: FetchResult;
    };

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function receiptError(platform: Platform, detail: string): AdapterError {
  return new AdapterError(
    'Bright Data continuation receipt is invalid: ' + detail
      + ' Refusing to trigger another paid snapshot until the receipt is reconciled.',
    { platform, retryable: false },
  );
}

function replacementLimitError(
  platform: Platform,
  snapshotId: string,
  stage: string,
  detail?: string,
): AdapterError {
  return new AdapterError(
    'Bright Data automatic replacement limit reached for snapshot ' + snapshotId
      + ' at stage "' + stage + '". The one recovery replacement also remained pending, '
      + 'so automatic paid recovery is stopped for operator review.'
      + (detail ? ' ' + detail : '')
      + ' A forced operator retry may poll this same receipt without starting a new paid job; '
      + 'clear the receipt only after approving another purchase.',
    { platform, retryable: false },
  );
}

function replacementAttempts(value: unknown, platform: Platform): number {
  if (value === undefined || value === null) return 0;
  if (
    typeof value !== 'number'
    || !Number.isInteger(value)
    || value < 0
    || value > BRIGHTDATA_MAX_AUTOMATIC_REPLACEMENTS
  ) {
    throw receiptError(platform, 'the automatic replacement counter is malformed.');
  }
  return value;
}

/** True even for a malformed receipt, so source routing cannot silently skip it. */
export function hasPendingBrightDataReceipt(cursor: Record<string, unknown>): boolean {
  return cursor.pendingSnapshotId !== undefined && cursor.pendingSnapshotId !== null;
}

/**
 * Return the stage that owns a saved receipt. A missing or corrupt stage fails
 * closed before source failover can start unrelated paid work.
 */
export function pendingBrightDataStage(
  cursor: Record<string, unknown>,
  platform: Platform,
  legacyStage?: string,
): string | undefined {
  if (!hasPendingBrightDataReceipt(cursor)) return undefined;
  if (!nonEmpty(cursor.pendingSnapshotId)) {
    throw receiptError(platform, 'the paid snapshot id is empty or malformed.');
  }
  if (cursor.source !== 'brightdata') {
    throw receiptError(platform, 'a snapshot id exists but source is not "brightdata".');
  }
  const stage = nonEmpty(cursor.brightDataStage) ?? legacyStage;
  if (!stage) throw receiptError(platform, 'the paid snapshot has no stage.');
  return stage;
}

function readReceipt(ctx: ReceiptContext, spec: BrightDataStageSpec): ActiveReceipt | undefined {
  if (!hasPendingBrightDataReceipt(ctx.cursor)) return undefined;
  const snapshotId = nonEmpty(ctx.cursor.pendingSnapshotId);
  if (!snapshotId) throw receiptError(spec.platform, 'the paid snapshot id is empty or malformed.');

  if (ctx.cursor.source !== 'brightdata') {
    throw receiptError(spec.platform, 'snapshot ' + snapshotId + ' has the wrong source.');
  }

  const stage = nonEmpty(ctx.cursor.brightDataStage) ?? spec.legacyStage;
  const datasetId = nonEmpty(ctx.cursor.brightDataDatasetId) ?? spec.legacyDatasetId;
  const windowSince = nonEmpty(ctx.cursor.windowSince);
  const windowUntil = nonEmpty(ctx.cursor.windowUntil);
  const nextCursor = nonEmpty(ctx.cursor.nextCursor);
  const pendingSince = nonEmpty(ctx.cursor.pendingSince);
  const replacements = replacementAttempts(
    ctx.cursor.brightDataReplacementAttempts,
    spec.platform,
  );
  const hasAnyModernBinding = [
    ctx.cursor.brightDataStage,
    ctx.cursor.brightDataDatasetId,
    ctx.cursor.windowSince,
    ctx.cursor.windowUntil,
    ctx.cursor.nextCursor,
  ].some((value) => value !== undefined && value !== null);
  const legacyUnbound = !hasAnyModernBinding
    && spec.legacyStage === spec.stage
    && spec.legacyDatasetId === spec.datasetId;

  if (stage !== spec.stage) {
    throw receiptError(
      spec.platform,
      'snapshot ' + snapshotId + ' belongs to stage "' + String(stage)
        + '", not "' + spec.stage + '".',
    );
  }
  if (datasetId !== spec.datasetId) {
    throw receiptError(
      spec.platform,
      'snapshot ' + snapshotId + ' belongs to dataset "' + String(datasetId)
        + '", not "' + spec.datasetId + '".',
    );
  }
  if (!legacyUnbound && (
    windowSince !== ctx.since.toISOString() || windowUntil !== ctx.until.toISOString()
  )) {
    throw receiptError(
      spec.platform,
      'snapshot ' + snapshotId + ' is bound to '
        + String(windowSince) + ' through ' + String(windowUntil)
        + ', not ' + ctx.since.toISOString() + ' through ' + ctx.until.toISOString() + '.',
    );
  }
  if (!legacyUnbound && nextCursor !== snapshotId) {
    throw receiptError(
      spec.platform,
      'snapshot ' + snapshotId + ' has a missing or mismatched generic continuation cursor.',
    );
  }
  if (!pendingSince || !Number.isFinite(Date.parse(pendingSince))) {
    throw receiptError(spec.platform, 'snapshot ' + snapshotId + ' has no valid start time.');
  }

  const now = spec.now ?? new Date();
  const ageMs = now.getTime() - Date.parse(pendingSince);
  if (ageMs < -5 * 60 * 1000) {
    throw receiptError(spec.platform, 'snapshot ' + snapshotId + ' has a future start time.');
  }
  if (legacyUnbound) {
    return {
      snapshotId,
      pendingSince,
      resumeSnapshotId: snapshotId,
      replacementAttempts: 0,
      automaticReplacement: false,
      finalRecoveryPoll: false,
      legacyUnbound: true,
      warnings: [
        'This legacy Bright Data receipt predates window binding. Data Dumpster is polling the '
          + 'exact saved snapshot without starting another paid job. Its rows may refresh public '
          + 'observations, but cannot certify historical coverage.',
      ],
    };
  }
  if (ageMs > BRIGHTDATA_RECEIPT_MAX_AGE_MS) {
    if (replacements >= BRIGHTDATA_MAX_AUTOMATIC_REPLACEMENTS) {
      return {
        snapshotId,
        pendingSince,
        resumeSnapshotId: snapshotId,
        replacementAttempts: replacements,
        automaticReplacement: false,
        finalRecoveryPoll: true,
        legacyUnbound: false,
        warnings: [
          'Bright Data snapshot ' + snapshotId + ' for stage "' + spec.stage
            + '" is the one automatic replacement and is older than 24 hours. Data Dumpster '
            + 'will make one final receipt-only poll and will not start another paid snapshot.',
        ],
      };
    }
    return {
      snapshotId,
      pendingSince: now.toISOString(),
      replacementAttempts: replacements + 1,
      automaticReplacement: true,
      finalRecoveryPoll: false,
      legacyUnbound: false,
      warnings: [
        'Bright Data snapshot ' + snapshotId + ' for stage "' + spec.stage
          + '" was older than 24 hours and was explicitly abandoned before the one allowed '
          + 'automatic replacement snapshot was attempted.',
      ],
    };
  }

  return {
    snapshotId,
    pendingSince,
    resumeSnapshotId: snapshotId,
    replacementAttempts: replacements,
    automaticReplacement: false,
    finalRecoveryPoll: false,
    legacyUnbound: false,
    warnings: [],
  };
}

/** Nulls deliberately clear the runner's merged channel cursor after completion. */
export function clearBrightDataReceipt(): Record<string, null> {
  return {
    brightDataStage: null,
    brightDataDatasetId: null,
    pendingSnapshotId: null,
    pendingSince: null,
    brightDataReplacementAttempts: null,
    nextCursor: null,
    windowSince: null,
    windowUntil: null,
    pendingProfileExternalId: null,
    pendingProfileHandle: null,
    pendingProfileSource: null,
  };
}

/** Public profile identity carried across a later paid post snapshot. */
export function profileFromBrightDataReceipt(
  cursor: Record<string, unknown>,
): AdapterProfile | undefined {
  const externalId = nonEmpty(cursor.pendingProfileExternalId);
  const handle = nonEmpty(cursor.pendingProfileHandle);
  const source = nonEmpty(cursor.pendingProfileSource);
  if (!externalId || !handle || !source) return undefined;
  return { externalId, handle, meta: { source } };
}

/**
 * Run one paid stage, resuming a validated receipt when present. Pending work
 * becomes a normal FetchResult continuation so the durable queue saves it.
 */
export async function runBrightDataStage<T>(
  ctx: ReceiptContext,
  spec: BrightDataStageSpec,
  run: (resumeSnapshotId?: string) => Promise<T>,
  profile?: AdapterProfile,
  audience: NormalizedAudience[] = [],
): Promise<BrightDataStageResult<T>> {
  if (!profile && audience.length > 0) {
    throw new AdapterError(
      'Bright Data stage "' + spec.stage + '" attempted to carry audience observations without '
        + 'a source-resolved profile identity. No observations were accepted.',
      { platform: spec.platform, retryable: false },
    );
  }
  const receipt = readReceipt(ctx, spec);
  const now = spec.now ?? new Date();

  try {
    const value = await run(receipt?.resumeSnapshotId);
    return {
      kind: 'complete',
      value,
      resumed: receipt?.resumeSnapshotId !== undefined,
      warnings: [
        ...(receipt?.warnings ?? []),
        ...(receipt?.resumeSnapshotId
          ? ['Completed Bright Data snapshot ' + receipt.snapshotId
              + ' for stage "' + spec.stage + '" without starting another paid job.']
          : []),
      ],
    };
  } catch (err) {
    if (!(err instanceof PendingSnapshotError)) {
      if (receipt?.automaticReplacement) {
        const detail = err instanceof Error ? err.message : String(err);
        throw new AdapterError(
          'The one automatic replacement for stale Bright Data snapshot '
            + receipt.snapshotId + ' at stage "' + spec.stage
            + '" did not return data or a durable new receipt. Automatic paid recovery is '
            + 'stopped because retrying could purchase duplicate work. Cause: ' + detail,
          { platform: spec.platform, retryable: false },
        );
      }
      if (receipt?.finalRecoveryPoll) {
        const detail = err instanceof Error ? err.message : String(err);
        throw replacementLimitError(
          spec.platform,
          receipt.snapshotId,
          spec.stage,
          'The final receipt-only poll failed: ' + detail,
        );
      }
      throw err;
    }
    if (receipt?.resumeSnapshotId && receipt.resumeSnapshotId !== err.snapshotId) {
      throw receiptError(
        spec.platform,
        'resuming snapshot ' + receipt.resumeSnapshotId + ' unexpectedly returned receipt '
          + err.snapshotId + '.',
      );
    }
    if (receipt?.legacyUnbound) {
      throw new AdapterError(
        'Legacy Bright Data snapshot ' + receipt.snapshotId + ' is still pending after its '
          + 'receipt-only recovery poll. No replacement was purchased. Operator review is '
          + 'required before another paid snapshot can be approved.',
        { platform: spec.platform, retryable: false },
      );
    }
    if (receipt?.finalRecoveryPoll) {
      throw replacementLimitError(spec.platform, receipt.snapshotId, spec.stage);
    }

    const pendingSince = receipt?.resumeSnapshotId
      ? receipt.pendingSince
      : now.toISOString();
    return {
      kind: 'continuation',
      result: {
        posts: [],
        // Safe only with the source-resolved profile above: the runner claims
        // that stable id before writing this already-fetched audience stock.
        audience: profile ? audience : [],
        ...(profile ? { profile } : {}),
        cursor: {
          source: 'brightdata',
          brightDataStage: spec.stage,
          brightDataDatasetId: spec.datasetId,
          pendingSnapshotId: err.snapshotId,
          pendingSince,
          brightDataReplacementAttempts: receipt?.replacementAttempts ?? 0,
          nextCursor: err.snapshotId,
          windowSince: ctx.since.toISOString(),
          windowUntil: ctx.until.toISOString(),
          ...(profile ? {
            pendingProfileExternalId: profile.externalId,
            pendingProfileHandle: profile.handle,
            pendingProfileSource: nonEmpty(profile.meta?.source) ?? 'brightdata',
          } : {}),
          lastRunAt: now.toISOString(),
        },
        hasMore: true,
        exhaustive: false,
        incompleteReason: err.message,
        warnings: [...(receipt?.warnings ?? []), err.message],
      },
    };
  }
}
