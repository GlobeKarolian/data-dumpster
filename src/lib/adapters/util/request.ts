/**
 * The request function the adapters call.
 *
 * This is the one transport implementation adapters call. The `util/http.ts`
 * barrel that used to re-export it is gone; there is no second policy to drift.
 */
import type { Platform } from '@/lib/types';
import { AdapterError } from '../types';

export type QueryValue = string | number | boolean | undefined | null;

export interface HttpInit {
  platform: Platform;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Record<string, QueryValue>;
  headers?: Record<string, string>;
  body?: unknown;
  form?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  signal?: AbortSignal;
  onApiCall?: () => void;
  classifyRetryable?: (ctx: {
    status: number;
    body: string;
    parsed: unknown;
  }) => boolean | undefined;
  extractMessage?: (parsed: unknown, body: string) => string | undefined;
  retryAfterFromHeaders?: (headers: Headers) => number | undefined;
}

export interface RawResponse {
  status: number;
  headers: Headers;
  text: string;
}

export function buildUrl(base: string, query?: Record<string, QueryValue>): string {
  if (!query) return base;
  const url = new URL(base);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/** `Retry-After` can be delta-seconds or an HTTP date. */
export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const when = Date.parse(value);
  if (Number.isFinite(when)) return Math.max(0, Math.round((when - Date.now()) / 1000));
  return undefined;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 30_000;

/** Transport-level statuses that are always worth another attempt. */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/** A platform asking us to sleep longer than this inside a request is really
 *  telling us to reschedule the run, so we surface it instead of blocking. */
const MAX_HONORED_RETRY_AFTER_SEC = 120;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function safeJsonParse(text: string): unknown {
  if (!text) return undefined;
  try { return JSON.parse(text) as unknown; } catch { return undefined; }
}

/** Best-effort human-readable message out of the error envelopes we meet. */
function defaultExtractMessage(parsed: unknown, body: string): string | undefined {
  if (isRecord(parsed)) {
    const err = parsed.error;
    if (isRecord(err) && typeof err.message === 'string') {
      const reason = Array.isArray(err.errors) && isRecord(err.errors[0]) && typeof err.errors[0].reason === 'string'
        ? ` (${err.errors[0].reason})` : '';
      return `${err.message}${reason}`;
    }
    if (typeof err === 'string') {
      const desc = typeof parsed.error_description === 'string' ? `: ${parsed.error_description}` : '';
      return `${err}${desc}`;
    }
    // AT Protocol XRPC: `{error:"InvalidRequest", message:"..."}`
    if (typeof parsed.message === 'string') return parsed.message;
    if (typeof parsed.detail === 'string') return parsed.detail;
  }
  const trimmed = body.trim();
  return trimmed ? trimmed.slice(0, 300) : undefined;
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

/** Equal jitter: half deterministic so we still back off, half random so
 *  concurrent workers desynchronise after a platform-wide 429. */
function backoffDelay(attempt: number, base: number, max: number): number {
  const exponential = Math.min(max, base * 2 ** attempt);
  return Math.round(exponential / 2 + Math.random() * (exponential / 2));
}

/**
 * Issue a request and return the raw status/headers/body.
 *
 * Any status >= 400 throws `AdapterError`. 3xx is returned untouched: `fetch`
 * follows redirects itself, and a 304 from a conditional GET is a *successful*
 * "nothing changed" answer that the RSS adapter depends on.
 */
export async function fetchRaw(url: string, init: HttpInit): Promise<RawResponse> {
  const {
    platform, method = 'GET', query, headers = {}, body, form,
    timeoutMs = DEFAULT_TIMEOUT_MS, retries = DEFAULT_RETRIES,
    baseDelayMs = DEFAULT_BASE_DELAY_MS, maxDelayMs = DEFAULT_MAX_DELAY_MS,
    signal, onApiCall, classifyRetryable, extractMessage, retryAfterFromHeaders,
  } = init;

  const target = buildUrl(url, query);
  const requestHeaders: Record<string, string> = {
    accept: 'application/json, text/*;q=0.8, */*;q=0.5',
    ...headers,
  };

  let payload: string | undefined;
  if (form) {
    payload = new URLSearchParams(form).toString();
    if (!requestHeaders['content-type']) requestHeaders['content-type'] = 'application/x-www-form-urlencoded';
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    if (!requestHeaders['content-type']) requestHeaders['content-type'] = 'application/json';
  }

  let lastError: AdapterError | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) throw abortError();

    // Per-attempt timeout, combined with the caller's cancellation signal: a
    // hung socket must not hold an ingest worker for the whole run.
    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
    const onOuterAbort = () => timeoutController.abort();
    signal?.addEventListener('abort', onOuterAbort, { once: true });

    let response: Response;
    try {
      onApiCall?.();
      response = await fetch(target, {
        method,
        headers: requestHeaders,
        body: payload,
        signal: timeoutController.signal,
        redirect: 'follow',
      });
    } catch (err) {
      // "The caller cancelled" is fatal and propagates; "the socket died or we
      // timed out" is worth another attempt.
      if (signal?.aborted) throw abortError();
      const message = err instanceof Error ? err.message : String(err);
      lastError = new AdapterError(`Network error: ${message}`, { platform, retryable: true });
      if (attempt < retries) {
        await sleep(backoffDelay(attempt, baseDelayMs, maxDelayMs), signal);
        continue;
      }
      throw lastError;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onOuterAbort);
    }

    const text = await response.text();
    if (response.status < 400) return { status: response.status, headers: response.headers, text };

    const parsed = safeJsonParse(text);
    const message = (extractMessage?.(parsed, text) ?? defaultExtractMessage(parsed, text)) ?? response.statusText;
    const override = classifyRetryable?.({ status: response.status, body: text, parsed });
    const retryable = override ?? RETRYABLE_STATUS.has(response.status);
    const serverDelay = retryAfterFromHeaders?.(response.headers)
      ?? parseRetryAfter(response.headers.get('retry-after'));

    lastError = new AdapterError(`HTTP ${response.status} from ${platform}: ${message}`, {
      platform, retryable, status: response.status, retryAfterSeconds: serverDelay,
    });

    if (!retryable || attempt >= retries) throw lastError;
    if (serverDelay !== undefined && serverDelay > MAX_HONORED_RETRY_AFTER_SEC) throw lastError;

    const delay = serverDelay !== undefined
      ? serverDelay * 1000
      : backoffDelay(attempt, baseDelayMs, maxDelayMs);
    await sleep(delay, signal);
  }

  throw lastError ?? new AdapterError('Request failed', { platform, retryable: true });
}

/**
 * Same policy as `fetchRaw`, plus JSON decoding.
 *
 * `T` is caller-declared rather than `any`: adapters narrow it immediately with
 * their own type guards, because every one of these APIs will eventually return
 * null where the documentation promises a number.
 */
export async function fetchJson<T>(url: string, init: HttpInit): Promise<T> {
  const raw = await fetchRaw(url, init);
  if (!raw.text.trim()) return undefined as T;
  const parsed = safeJsonParse(raw.text);
  if (parsed === undefined) {
    throw new AdapterError(
      `Malformed JSON from ${init.platform}: ${raw.text.slice(0, 200)}`,
      { platform: init.platform, retryable: false, status: raw.status },
    );
  }
  return parsed as T;
}

/** Narrowing helpers every adapter needs when reading an untyped payload. */
export function asRecord(v: unknown): Record<string, unknown> | undefined {
  return isRecord(v) ? v : undefined;
}

export function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * Counts arrive as strings on Google APIs (`"viewCount": "12345"`) and as
 * numbers on AT Protocol. Absent means zero, not NaN.
 */
export function asCount(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  }
  return 0;
}

/** A platform timestamp that we refuse to trust blindly. */
export function asDate(v: unknown): Date | undefined {
  const s = asString(v);
  if (!s) return undefined;
  const t = Date.parse(s);
  return Number.isNaN(t) ? undefined : new Date(t);
}
