/**
 * A small in-process limiter for the endpoints that cost real money.
 *
 * Three of them bill someone on every call: /api/ai/ask and /api/ai/brief spend
 * the org's own inference budget, and /api/ingest/run spends EnsembleData and
 * Bright Data units. `ask` is available to a VIEWER, the least privileged role
 * there is, so a bored account in a loop was a direct line to the newsroom's
 * vendor invoice. There was no limiter of any kind anywhere in the app.
 *
 * In-process is a deliberate limit, not an oversight. Serverless means each
 * instance keeps its own counter, so the effective ceiling is the configured
 * rate times the number of warm instances. That still turns an unbounded loop
 * into a bounded one, which is the property that matters here, and it costs no
 * new infrastructure. If this ever needs to be exact rather than sufficient,
 * the same interface can be backed by Postgres or Redis without touching a
 * single call site.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** Bound the map so a long-lived instance cannot grow it without limit. */
const MAX_TRACKED = 5_000;

function sweep(now: number): void {
  if (buckets.size < MAX_TRACKED) return;
  for (const [key, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(key);
  }
  // Still full of live buckets: drop the oldest rather than refusing to track.
  if (buckets.size >= MAX_TRACKED) {
    const oldest = [...buckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
    for (const [key] of oldest.slice(0, Math.floor(MAX_TRACKED / 4))) buckets.delete(key);
  }
}

export interface RateLimit {
  /** Requests permitted inside the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

/** Named budgets, so the numbers live in one place rather than at call sites. */
export const LIMITS = {
  /** Inference on demand. Generous enough for real use, bounded for a loop. */
  ai: { limit: 20, windowMs: 60_000 },
  /** A full refresh is minutes of vendor spend; nobody needs it every minute. */
  ingest: { limit: 4, windowMs: 60_000 },
  /** Report and brief generation, which also bills inference. */
  generate: { limit: 10, windowMs: 60_000 },
} satisfies Record<string, RateLimit>;

export type RateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterSeconds: number; message: string };

/**
 * Consume one unit against `key`.
 *
 * Returns a result rather than throwing so this module stays free of
 * `server-only` and can be tested directly; the route turns a refusal into a
 * 429. The key should identify who is PAYING, which is the org: the budget
 * being consumed is the same regardless of which member triggers the call.
 */
export function checkRateLimit(key: string, spec: RateLimit): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + spec.windowMs });
    return { ok: true };
  }

  existing.count += 1;
  if (existing.count <= spec.limit) return { ok: true };

  const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
  return {
    ok: false,
    retryAfterSeconds,
    message: `That is more than ${spec.limit} requests in `
      + `${Math.round(spec.windowMs / 1000)} seconds. This endpoint spends money on every `
      + `call, so it is capped. Try again in ${retryAfterSeconds}s.`,
  };
}

/** Reset between tests. Not exported anywhere a request can reach. */
export function __resetRateLimits(): void {
  buckets.clear();
}
