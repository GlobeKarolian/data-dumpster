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
 * The synchronous endpoint accepts up to 20 URLs and returns parsed JSON within
 * a one minute budget, which fits ChannelAdapter.fetch without any async rework.
 * If a job exceeds that budget the API degrades to returning a snapshot id
 * instead of rows, so we poll for it rather than failing the run.
 */
import { AdapterError } from '@/lib/adapters/types';
import type { Platform } from '@/lib/types';

const BASE = 'https://api.brightdata.com/datasets/v3';

/**
 * Dataset ids identify which parsed schema to return. They are stable public
 * identifiers from Bright Data's documentation, not secrets.
 */
export const DATASETS = {
  tiktokProfile: 'gd_l1villgoiiidt09ci',
  tiktokPost: 'gd_lu702nij2f790tmv9h',
  tiktokPostsByProfile: 'gd_m7n5v2gq296pex2f5m',
  tiktokComments: 'gd_lkf2st302ap89utw5k',
  instagramProfile: 'gd_l1vikfch901nx3by4',
  instagramPost: 'gd_lk5ns7kz21pck8jpis',
  instagramReel: 'gd_lyclm20il4r5helnj',
} as const;

/** Sync requests accept at most 20 URLs per call. */
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
 * with a longer per-attempt budget than any single scrape should need.
 */
const NETWORK_ATTEMPTS = 3;

async function request(
  url: string,
  init: RequestInit,
  opts: BrightDataOptions,
): Promise<unknown> {
  let res: Response | null = null;
  let lastError = '';

  for (let attempt = 1; attempt <= NETWORK_ATTEMPTS; attempt += 1) {
    opts.onApiCall?.();

    // Own timeout, so a hung socket fails predictably instead of at whatever
    // undici's default happens to be on this runtime.
    const timer = new AbortController();
    const cancel = setTimeout(() => timer.abort(), opts.timeoutMs ?? 180_000);
    const signals: AbortSignal[] = [timer.signal];
    if (opts.signal) signals.push(opts.signal);

    try {
      res = await fetch(url, {
        ...init,
        signal: signals.length > 1 ? AbortSignal.any(signals) : timer.signal,
      });
      break;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (opts.signal?.aborted) fail(opts.platform, 'request cancelled by caller');
      if (attempt === NETWORK_ATTEMPTS) {
        fail(opts.platform, 'network failure after ' + NETWORK_ATTEMPTS + ' attempts: ' + lastError);
      }
      // Linear backoff. The vendor is not rate limiting us here, the socket
      // died, so there is nothing to be gained by backing off aggressively.
      await new Promise((r) => setTimeout(r, attempt * 2000));
    } finally {
      clearTimeout(cancel);
    }
  }

  if (!res) return fail(opts.platform, 'network failure: ' + lastError);

  const text = await res.text();
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
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); }, { once: true });
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

  while (Date.now() < deadline) {
    await sleep(delay, opts.signal);
    delay = Math.min(delay * 1.5, 10000);

    const progress = await request(
      BASE + '/progress/' + encodeURIComponent(snapshotId),
      { headers, signal: opts.signal },
      opts,
    );
    const status = isRecord(progress) && typeof progress.status === 'string' ? progress.status : '';

    if (status === 'failed') fail(opts.platform, 'snapshot ' + snapshotId + ' failed');
    if (status !== 'ready') continue;

    const rows = await request(
      BASE + '/snapshot/' + encodeURIComponent(snapshotId) + '?format=json',
      { headers, signal: opts.signal },
      opts,
    );
    return Array.isArray(rows) ? rows : [];
  }

  fail(opts.platform, 'snapshot ' + snapshotId + ' did not finish within the time budget');
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
    discoverBy?: 'url' | 'user_name' | 'keyword';
  },
): Promise<T[]> {
  if (input.length === 0) return [];
  if (input.length > MAX_SYNC_URLS) {
    fail(opts.platform, 'sync requests accept at most ' + MAX_SYNC_URLS + ' URLs, got ' + input.length);
  }

  // Discovery enumerates a profile and routinely runs past the sync budget, so
  // it needs a longer ceiling before the snapshot fallback takes over.
  const timeout = opts.timeoutMs ?? (opts.discoverBy ? 300_000 : 120_000);
  const deadline = Date.now() + timeout;
  const url = BASE + '/scrape?dataset_id=' + encodeURIComponent(datasetId)
    + '&format=json&include_errors=true'
    + (opts.discoverBy ? '&type=discover_new&discover_by=' + opts.discoverBy : '');

  const body = await request(url, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + opts.apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
    signal: opts.signal,
  }, opts);

  if (Array.isArray(body)) return body as T[];

  // Over budget: the API returned a job handle instead of rows.
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
