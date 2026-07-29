/**
 * EnsembleData client.
 *
 * WHY THIS REPLACED THE PREVIOUS VENDOR
 * Measured over 200 real ingestion runs, the previous vendor returned 76% on
 * TikTok and 42% on Facebook with a median call of 44 to 127 seconds, because
 * its model is "run a scrape job and hold the socket open until it finishes".
 * EnsembleData is an ordinary REST API returning JSON: the same eight TikTok
 * accounts came back 8 of 8 in 1.5 to 2.6 seconds, and the engagement figures
 * matched the old vendor exactly where both returned a post.
 *
 * That difference is not a nicety. A 90-second call cannot run inside a
 * serverless request, which forced the Refresh button to cap at 24 channels and
 * pushed full refreshes into a background job nobody had built. A 2-second call
 * makes the whole landscape refreshable in one request.
 *
 * Pricing is unit-based per endpoint rather than per record, and the vendor does
 * not charge for failed calls, so retries are free in the only sense that
 * matters here.
 */
import { AdapterError } from '@/lib/adapters/types';
import type { Platform } from '@/lib/types';

const BASE = 'https://ensembledata.com/apis';

export interface EnsembleOptions {
  token: string;
  platform: Platform;
  timeoutMs?: number;
  signal?: AbortSignal;
  onApiCall?: () => void;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * 422 means the query string was wrong, which is a programming error rather
 * than a transient one and must not be retried. 429 and 5xx are worth another
 * attempt. Everything else fails closed.
 */
function classify(status: number): boolean {
  return status === 429 || status === 408 || status >= 500;
}

const ATTEMPTS = 3;

export async function ensembleGet<T = unknown>(
  path: string,
  params: Record<string, string | number | undefined>,
  opts: EnsembleOptions,
): Promise<T> {
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') query.set(k, String(v));
  }
  query.set('token', opts.token);
  const url = BASE + path + '?' + query.toString();

  let lastMessage = '';

  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    opts.onApiCall?.();

    const timer = new AbortController();
    const cancel = setTimeout(() => timer.abort(), opts.timeoutMs ?? 45_000);
    const signal = opts.signal
      ? AbortSignal.any([timer.signal, opts.signal])
      : timer.signal;

    try {
      const res = await fetch(url, { signal, headers: { accept: 'application/json' } });
      const text = await res.text();

      if (!res.ok) {
        let detail = text.slice(0, 200);
        try {
          const parsed: unknown = JSON.parse(text);
          if (isRecord(parsed) && parsed.detail) detail = JSON.stringify(parsed.detail).slice(0, 200);
        } catch { /* keep the raw body */ }

        if (res.status === 401 || res.status === 403) {
          throw new AdapterError(
            'EnsembleData rejected the token. Check ENSEMBLEDATA_TOKEN.',
            { platform: opts.platform, retryable: false, status: res.status },
          );
        }
        // 495 is EnsembleData's daily unit quota, not a transient fault.
        // Retrying burns nothing (they do not bill failures) but delays the run
        // and cannot succeed until the quota resets at 00:00 UTC, so fail fast
        // with the one sentence that tells an operator what to actually do.
        if (res.status === 495) {
          throw new AdapterError(
            'EnsembleData daily unit quota exhausted. It resets at 00:00 UTC. '
            + 'The free trial is 50 units per day, which is roughly ten channels; '
            + 'a full landscape refresh needs about 550. Upgrade the plan or wait.',
            { platform: opts.platform, retryable: false, status: res.status },
          );
        }
        if (!classify(res.status)) {
          throw new AdapterError(
            'EnsembleData HTTP ' + res.status + '. ' + detail,
            { platform: opts.platform, retryable: false, status: res.status },
          );
        }
        lastMessage = 'HTTP ' + res.status + '. ' + detail;
        if (attempt === ATTEMPTS) {
          throw new AdapterError('EnsembleData ' + lastMessage, {
            platform: opts.platform, retryable: true, status: res.status,
          });
        }
      } else {
        return JSON.parse(text) as T;
      }
    } catch (err) {
      if (err instanceof AdapterError) throw err;
      lastMessage = err instanceof Error ? err.message : String(err);
      if (opts.signal?.aborted) {
        throw new AdapterError('EnsembleData request cancelled', {
          platform: opts.platform, retryable: false,
        });
      }
      if (attempt === ATTEMPTS) {
        throw new AdapterError('EnsembleData network failure: ' + lastMessage, {
          platform: opts.platform, retryable: true,
        });
      }
    } finally {
      clearTimeout(cancel);
    }

    await new Promise((r) => setTimeout(r, attempt * 750));
  }

  throw new AdapterError('EnsembleData failed: ' + lastMessage, {
    platform: opts.platform, retryable: true,
  });
}

/** Unwrap the vendor's { data } envelope. */
export function envelope<T>(body: unknown): T | undefined {
  if (isRecord(body) && 'data' in body) return body.data as T;
  return undefined;
}

export function resolveToken(credentials: Record<string, string>): string {
  return credentials.ensembleDataToken ?? process.env.ENSEMBLEDATA_TOKEN ?? '';
}
