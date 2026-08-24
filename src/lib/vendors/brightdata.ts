/**
 * Bright Data Web Scraper API client.
 *
 * WHY THIS EXISTS
 * Three platforms serve no competitor data through any sanctioned API:
 * TikTok, LinkedIn and (without Page Public Content Access approval) Facebook.
 * TikTok is the sharpest gap, because it is where the audience actually is.
 * Bright Data resells structured public data for all three.
 *
 * This is a deliberate, documented trade. The data is public, the vendor holds
 * SOC 2 and ISO 27001 and won Meta v. Bright Data, but collection is still
 * contrary to those platforms' terms of service. Read docs/DATA-ACCESS.md before
 * enabling it, and treat it as a decision Legal made rather than one a
 * developer made.
 *
 * TRANSPORT
 * Bright Data is always started through its asynchronous trigger endpoint.
 * The trigger returns the paid snapshot receipt immediately; ChannelAdapter
 * then polls that receipt until this invocation's budget expires and persists
 * it for the next worker when necessary. Never use the synchronous scrape
 * endpoint here: it can hold the connection open past our deadline without
 * returning the receipt, which strands paid work and purchases it again.
 */
import { AdapterError } from '@/lib/adapters/types';
import type { Platform } from '@/lib/types';

const BASE = 'https://api.brightdata.com/datasets/v3';

/**
 * Dataset ids identify which parsed schema to return. They are stable public
 * identifiers from Bright Data's documentation, not secrets.
 */
export const DATASETS = {
  facebookPagesAndProfiles: 'gd_mf124a0511bauquyow',
  tiktokProfile: 'gd_l1villgoiiidt09ci',
  tiktokPost: 'gd_lu702nij2f790tmv9h',
  tiktokPostsByProfile: 'gd_m7n5v2gq296pex2f5m',
  tiktokComments: 'gd_lkf2st302ap89utw5k',
  instagramProfile: 'gd_l1vikfch901nx3by4',
  instagramPost: 'gd_lk5ns7kz21pck8jpis',
  instagramReel: 'gd_lyclm20il4r5helnj',
  threadsProfile: 'gd_mde7jg3ld2h3hnnf2',
  threadsPosts: 'gd_md75myxy14rihbjksa',
  facebookPagePosts: 'gd_lkaxegm826bjpoo9m5',
  twitterPosts: 'gd_lwxkxvnf1cynvib9co',
  linkedinCompany: 'gd_l1vikfnt1wgvvqz95w',
  linkedinCompanyPosts: 'gd_lyy3tktm25m4avu764',
  // Facebook posts collected by group URL. Bright Data's group dataset returns
  // PUBLIC group posts only; a members-only group is not reachable through it,
  // and Group View surfaces that as an ineligible source rather than working
  // around it. See docs/GROUP-VIEW.md.
  facebookGroupPosts: 'gd_lz11l67o2cb3r0lkj3',
} as const;

/** Bright Data accepts at most 20 inputs per trigger for these datasets. */
export const MAX_SYNC_URLS = 20;

export interface BrightDataOptions {
  apiKey: string;
  platform: Platform;
  /** Total budget for a sync call plus any snapshot polling. */
  timeoutMs?: number;
  signal?: AbortSignal;
  onApiCall?: () => void;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * A spend limit is only a limit if it is a whole number above zero. Bright Data
 * rejects `limit_per_input=0` and silently ignores a non-numeric value, and a
 * silently ignored limit is how an unbounded snapshot gets bought.
 */
function positiveInt(v: number | undefined): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const n = Math.trunc(v);
  return n > 0 ? n : null;
}

/**
 * Bright Data reports failures both as HTTP status codes and as an error field
 * inside a 200 body, so both paths have to be checked.
 */
function fail(platform: Platform, message: string, status?: number): never {
  const retryable = status === undefined
    ? true
    : status === 429 || status === 408 || status >= 500;
  throw new AdapterError('Bright Data: ' + message, { platform, retryable, status });
}

/**
 * Bright Data holds the connection open for the whole scrape, which routinely
 * runs 30 to 110 seconds. Node's default fetch gives up on an idle socket well
 * before a slow profile finishes, and the failure surfaces as a bare
 * "fetch failed" with no status. That accounted for every unexplained channel
 * failure in the first production runs, so retry network faults specifically,
 * while keeping every attempt inside one bounded operation deadline.
 */
const NETWORK_ATTEMPTS = 3;

/**
 * Leave a full minute of the 300-second ingest invocation for the runner to
 * persist the receipt/outcome and release its leases. Callers may request a
 * shorter operation budget, but cannot let one vendor call consume the whole
 * serverless invocation.
 */
const MAX_OPERATION_TIMEOUT_MS = 240_000;

class OperationDeadlineExceeded extends Error {
  constructor() {
    super('Bright Data operation deadline exceeded');
    this.name = 'OperationDeadlineExceeded';
  }
}

function remainingMs(deadline: number): number {
  return Math.max(0, deadline - Date.now());
}

function operationTimeoutMs(opts: BrightDataOptions & { discoverBy?: string }): number {
  const fallback = opts.discoverBy ? 75_000 : 60_000;
  const requested = opts.timeoutMs ?? fallback;
  if (!Number.isFinite(requested)) return fallback;
  return Math.min(Math.max(0, requested), MAX_OPERATION_TIMEOUT_MS);
}

async function request(
  url: string,
  init: RequestInit,
  opts: BrightDataOptions,
  deadline: number,
): Promise<unknown> {
  let response: { res: Response; text: string } | null = null;
  let lastError = '';

  for (let attempt = 1; attempt <= NETWORK_ATTEMPTS; attempt += 1) {
    const requestBudget = remainingMs(deadline);
    if (requestBudget <= 0) throw new OperationDeadlineExceeded();

    opts.onApiCall?.();

    // This timer uses the operation's remaining budget, not a fresh budget per
    // retry. It covers both response headers and body consumption; otherwise a
    // hanging body or three slow attempts can outlive the serverless worker.
    const timer = new AbortController();
    const cancel = setTimeout(() => timer.abort(), requestBudget);
    const signals: AbortSignal[] = [timer.signal];
    if (opts.signal) signals.push(opts.signal);

    try {
      const res = await fetch(url, {
        ...init,
        signal: signals.length > 1 ? AbortSignal.any(signals) : timer.signal,
      });
      const text = await res.text();
      response = { res, text };
      break;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (opts.signal?.aborted) fail(opts.platform, 'request cancelled by caller');
      if (timer.signal.aborted || remainingMs(deadline) <= 0) {
        throw new OperationDeadlineExceeded();
      }
      if (attempt === NETWORK_ATTEMPTS) {
        fail(opts.platform, 'network failure after ' + NETWORK_ATTEMPTS + ' attempts: ' + lastError);
      }
      // Linear backoff. The vendor is not rate limiting us here, the socket
      // died, so there is nothing to be gained by backing off aggressively.
      // The wait is clipped to the same whole-operation deadline.
      const wait = Math.min(attempt * 2000, remainingMs(deadline));
      if (wait <= 0) throw new OperationDeadlineExceeded();
      try {
        await sleep(wait, opts.signal);
      } catch {
        if (opts.signal?.aborted) fail(opts.platform, 'request cancelled by caller');
        throw new OperationDeadlineExceeded();
      }
    } finally {
      clearTimeout(cancel);
    }
  }

  if (!response) return fail(opts.platform, 'network failure: ' + lastError);

  const { res, text } = response;
  let parsed: unknown = undefined;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    // Non-JSON body. Only meaningful when the status is already bad.
  }

  if (!res.ok) {
    const detail = isRecord(parsed) && typeof parsed.error === 'string'
      ? parsed.error
      : text.slice(0, 300);
    if (res.status === 401 || res.status === 403) {
      fail(opts.platform, 'authentication rejected. Check BRIGHTDATA_API_KEY. ' + detail, res.status);
    }
    fail(opts.platform, 'HTTP ' + res.status + '. ' + detail, res.status);
  }

  if (isRecord(parsed) && typeof parsed.error === 'string') {
    fail(opts.platform, parsed.error);
  }
  return parsed;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const finish = () => {
      signal?.removeEventListener('abort', abort);
      resolve();
    };
    const abort = () => {
      clearTimeout(t);
      reject(new Error('aborted'));
    };
    const t = setTimeout(finish, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

/**
 * Poll a snapshot until it is ready, then download it. Only reached when the
 * synchronous call exceeded its budget and handed back an id instead of rows.
 */
async function awaitSnapshot(
  snapshotId: string,
  opts: BrightDataOptions,
  deadline: number,
): Promise<unknown[]> {
  const headers = { Authorization: 'Bearer ' + opts.apiKey };
  let delay = 2000;

  try {
    while (Date.now() < deadline) {
      await sleep(Math.min(delay, remainingMs(deadline)), opts.signal);
      delay = Math.min(delay * 1.5, 10000);
      if (remainingMs(deadline) <= 0) break;

      const progress = await request(
        BASE + '/progress/' + encodeURIComponent(snapshotId),
        { headers, signal: opts.signal },
        opts,
        deadline,
      );
      const status = isRecord(progress) && typeof progress.status === 'string' ? progress.status : '';

      if (status === 'failed') fail(opts.platform, 'snapshot ' + snapshotId + ' failed');
      if (status !== 'ready') continue;

      const rows = await request(
        BASE + '/snapshot/' + encodeURIComponent(snapshotId) + '?format=json',
        { headers, signal: opts.signal },
        opts,
        deadline,
      );
      if (Array.isArray(rows)) return rows;

      // The download endpoint answers 202 with {status:"running"} when progress
      // has flipped to ready but the file is not materialized yet. That is a
      // 2xx, so it reaches here as a record rather than an array. Returning []
      // for it told callers "this source has no posts", which is a different
      // and much more damaging claim than "not finished". Keep polling instead.
      if (isRecord(rows) && typeof rows.status === 'string' && rows.status !== 'ready') {
        continue;
      }
      return [];
    }
  } catch (err) {
    if (!(err instanceof OperationDeadlineExceeded)) throw err;
  }

  // Out of time, but the job is still running on Bright Data's side and will
  // finish without us. Throwing a plain failure here was expensive twice over:
  // the units already spent on the trigger were forfeited, and the next attempt
  // paid for the same collection again, only to be killed at the same point.
  throw new PendingSnapshotError(opts.platform, snapshotId);
}

/**
 * A scrape that has been paid for and is still running.
 *
 * Bright Data is trigger-and-poll: a Facebook Page with a hundred posts takes
 * minutes, which is longer than a serverless request lives. The snapshot id is
 * the receipt, so it travels with the error and the caller stores it. The next
 * run polls that id instead of triggering a second collection.
 */
export class PendingSnapshotError extends AdapterError {
  readonly snapshotId: string;

  constructor(platform: Platform, snapshotId: string) {
    super(
      'Bright Data snapshot ' + snapshotId + ' is still collecting. It will be picked up '
      + 'on the next run rather than started again.',
      { platform, retryable: true },
    );
    this.name = 'PendingSnapshotError';
    this.snapshotId = snapshotId;
  }
}

/**
 * Run one synchronous scrape and return the parsed rows.
 *
 * Rows that Bright Data could not collect come back carrying an error field
 * rather than being omitted, so callers must tolerate partial results. That is
 * intentional on our side: one dead competitor handle should degrade to a gap
 * in the leaderboard, never to a failed ingest for the whole landscape.
 */
export async function scrapeSync<T = Record<string, unknown>>(
  datasetId: string,
  input: Record<string, unknown>[],
  opts: BrightDataOptions & {
    /**
     * Discovery mode. Collect endpoints take an exact item URL; discovery
     * endpoints take a profile URL and enumerate from it. This is the
     * difference between twelve posts and a real window of history, so it is a
     * first-class option rather than something callers hand-assemble.
     */
    discoverBy?:
      | 'url'
      | 'profile_url'
      | 'profiles_array'
      | 'profile'
      | 'company_url'
      | 'user_name'
      | 'keyword';
    /**
     * Poll this existing snapshot instead of paying to start a new one.
     * Set from the channel cursor after a previous run ran out of time.
     */
    resumeSnapshotId?: string;
    /**
     * Hard ceiling on records purchased, enforced by Bright Data.
     *
     * These are the only limits that actually bind. Per-dataset input fields
     * like `num_of_posts` and `start_date` are advisory: the Facebook group
     * dataset accepted `num_of_posts: 50` with a two-day window, returned
     * 57,037 records reaching back to 2018, and billed for all of them. The
     * trigger query parameters are applied by the vendor before delivery, so
     * they cap the invoice rather than requesting politely that it be small.
     *
     * Set these on any collection whose natural size is unbounded.
     */
    limitPerInput?: number;
    limitTotal?: number;
  },
): Promise<T[]> {
  if (input.length === 0) return [];
  if (input.length > MAX_SYNC_URLS) {
    fail(opts.platform, 'sync requests accept at most ' + MAX_SYNC_URLS + ' URLs, got ' + input.length);
  }

  /*
   * The budget has to leave room for the rest of the batch.
   *
   * It used to be 300s for discovery, which is the entire Vercel maxDuration:
   * one slow Facebook Page consumed the whole request, was killed mid-poll, and
   * every other channel behind it in the queue went uncollected. Since an
   * unfinished snapshot is now resumable rather than lost, a short budget costs
   * nothing but a few minutes of latency, and keeps one slow Page from
   * starving the queue.
   */
  const timeout = operationTimeoutMs(opts);
  const deadline = Date.now() + timeout;

  if (opts.resumeSnapshotId) {
    return await awaitSnapshot(opts.resumeSnapshotId, opts, deadline) as T[];
  }
  // Always buy work through /trigger, even for a single exact URL. /scrape can
  // keep the socket open until the collection finishes; if our operation budget
  // expires first there is no snapshot id to resume. /trigger returns that
  // durable receipt before collection begins, so an invocation timeout only
  // adds latency and never loses or duplicates paid work.
  const url = BASE + '/trigger?dataset_id=' + encodeURIComponent(datasetId)
    + '&format=json&include_errors=true'
    + (opts.discoverBy ? '&type=discover_new&discover_by=' + opts.discoverBy : '')
    + (positiveInt(opts.limitPerInput) ? '&limit_per_input=' + positiveInt(opts.limitPerInput) : '')
    + (positiveInt(opts.limitTotal) ? '&limit_multiple_results=' + positiveInt(opts.limitTotal) : '');

  let body: unknown;
  try {
    body = await request(url, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + opts.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
      signal: opts.signal,
    }, opts, deadline);
  } catch (err) {
    if (!(err instanceof OperationDeadlineExceeded)) throw err;
    fail(
      opts.platform,
      'operation exceeded its ' + timeout + 'ms budget before a resumable snapshot receipt was returned',
    );
  }

  // The trigger endpoint returns a job handle. Retain array support only for a
  // defensive vendor-compatibility path and for old recorded fixtures.
  if (Array.isArray(body)) return body as T[];

  if (isRecord(body) && typeof body.snapshot_id === 'string') {
    return await awaitSnapshot(body.snapshot_id, opts, deadline) as T[];
  }

  return [];
}

/** True when a row is one of Bright Data's per-input error records. */
export function isErrorRow(row: unknown): boolean {
  return isRecord(row) && (typeof row.error === 'string' || typeof row.warning === 'string');
}

export function rowError(row: unknown): string | undefined {
  if (!isRecord(row)) return undefined;
  if (typeof row.error === 'string') return row.error;
  if (typeof row.warning === 'string') return row.warning;
  return undefined;
}
