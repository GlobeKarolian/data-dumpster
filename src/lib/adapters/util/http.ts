/**
 * The single HTTP client every adapter uses.
 *
 * Why this exists rather than raw `fetch` in each adapter:
 *
 *  1. **Every social API rate-limits differently and lies about it differently.**
 *     Google returns 403 with `reason: "quotaExceeded"`. Meta returns *200-shaped*
 *     400s with `error.code === 4|17|32|613`. X returns a clean 429 with
 *     `x-rate-limit-reset`. TikTok returns 200 with `error.code !== "ok"`. If each
 *     adapter hand-rolled this we would get seven subtly different retry bugs, and
 *     the ones that matter only show up in production at 3am.
 *
 *  2. **Retry policy is a correctness concern, not a nicety.** Ingest runs are
 *     idempotent by design (see runner.ts), so a retried request is always safe.
 *     What is *not* safe is retrying a 401 forever and burning an org's quota, so
 *     the retryable/fatal split is explicit and conservative.
 *
 *  3. **Backoff needs jitter.** The scheduler runs channels with bounded
 *     concurrency; without jitter a platform-wide 429 makes all four workers
 *     retry in lockstep and we re-trip the limit on every wave.
 *
 * Everything here throws `AdapterError`, which the runner uses to decide between
 * "mark this run failed" and "back off and try this channel again later".
 */
import type { Platform } from '@/lib/types';
import { AdapterError } from '../types';

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 30_000;

/** Transport-level statuses that are always worth another attempt. */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/** Hard ceiling on a server-supplied Retry-After. A platform asking us to sleep
 *  for an hour inside a request is really telling us to reschedule the run. */
const MAX_HONORED_RETRY_AFTER_SEC = 120;

export type QueryValue = string | number | boolean | undefined | null;

export interface HttpInit {
  platform: Platform;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Appended to the URL. `undefined` / `null` values are dropped, not stringified. */
  query?: Record<string, QueryValue>;
  headers?: Record<string, string>;
  /** JSON request body. Mutually exclusive with `form`. */
  body?: unknown;
  /** `application/x-www-form-urlencoded` body (OAuth token endpoints want this). */
  form?: Record<string, string>;
  timeoutMs?: number;
  /** Number of *additional* attempts after the first. 0 disables retrying. */
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  signal?: AbortSignal;
  /** Telemetry hook. Fired once per network attempt, including retries, because
   *  a retry costs real quota on every platform that counts requests. */
  onApiCall?: () => void;
  /**
   * Platform-specific retry classification. Return `true`/`false` to override,
   * `undefined` to fall through to the status-code default. Meta uses this to
   * recognise its rate-limit errors, which arrive as HTTP 400.
   */
  classifyRetryable?: (ctx: { status: number; body: string; parsed: unknown }) => boolean | undefined;
  /** Pull the useful sentence out of a platform's error envelope. */
  extractMessage?: (parsed: unknown, body: string) => string | undefined;
  /** Extra seconds to wait, derived by the caller from platform headers. */
  retryAfterFromHeaders?: (headers: Headers) => number | undefined;
}

export interface RawResponse {
  status: number;
  headers: Headers;
  text: string;
}

/* ------------------------------------------------------------------ utils */

export function buildUrl(base: string, query?: Record<string, QueryValue>): string {
  if (!query) return base;
  const url = new URL(base);
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    url.searchParams.set(k, String(v));
  }
  return url.toString();
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function safeJsonParse(text: string): unknown {
  if (!text) return undefined;
  try { return JSON.parse(text) as unknown; } catch { return undefined; }
}

/**
 * Best-effort extraction of a human-readable message from the six error
 * envelopes we actually encounter. Falls back to a truncated raw body, which is
 * still infinitely more useful in a log than "Request failed".
 */
function defaultExtractMessage(parsed: unknown, body: string): string | undefined {
  if (isRecord(parsed)) {
    const err = parsed.error;
    // Google (`{error:{code,message,errors:[{reason}]}}`), Meta (`{error:{message,type,code}}`)
    if (isRecord(err) && typeof err.message === 'string') {
      const reason = Array.isArray(err.errors) && isRecord(err.errors[0]) && typeof err.errors[0].reason === 'string'
        ? ` (${err.errors[0].reason})` : '';
      return `${err.message}${reason}`;
    }
    // OAuth 2.0 (`{error, error_description}`) and TikTok (`{error:{code,message,log_id}}`)
    if (typeof err === 'string') {
      const desc = typeof parsed.error_description === 'string' ? `: ${parsed.error_description}` : '';
      return `${err}${desc}`;
    }
    // X API v2 problem objects (`{title, detail, type}`)
    if (typeof parsed.detail === 'string') return parsed.detail;
    if (typeof parsed.title === 'string') return parsed.title;
    // LinkedIn (`{message, status, serviceErrorCode}`) and generic
    if (typeof parsed.message === 'string') return parsed.message;
    // X v1.1 style
    if (Array.isArray(parsed.errors) && isRecord(parsed.errors[0]) && typeof parsed.errors[0].message === 'string') {
      return parsed.errors[0].message;
    }
  }
  const trimmed = body.trim();
  return trimmed ? trimmed.slice(0, 300) : undefined;
}

/** `Retry-After` is either delta-seconds or an HTTP date. Both appear in the wild. */
export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const when = Date.parse(value);
  if (Number.isFinite(when)) return Math.max(0, Math.round((when - Date.now()) / 1000));
  return undefined;
}

function abortError(): Error {
  const e = new Error('Aborted');
  e.name = 'AbortError';
  return e;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(abortError()); return; }
    const timer = setTimeout(() => { cleanup(); resolve(); }, ms);
    const onAbort = () => { cleanup(); reject(abortError()); };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Exponential backoff with "equal jitter": half the delay is deterministic so we
 * still back off meaningfully, half is random so concurrent workers desynchronise.
 */
function backoffDelay(attempt: number, base: number, max: number): number {
  const exponential = Math.min(max, base * 2 ** attempt);
  return Math.round(exponential / 2 + Math.random() * (exponential / 2));
}
