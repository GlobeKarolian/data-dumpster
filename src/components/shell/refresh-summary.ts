export interface RefreshChannelResult {
  companyName: string;
  handle: string;
  platform: string;
  status: string;
  error?: string;
}

export interface RefreshRunSummary {
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
  results?: RefreshChannelResult[];
}

/**
 * One click may drain several server-sized batches. Keep the totals from the
 * whole click while taking queue state from the newest response.
 */
export function mergeRefreshSummaries(
  aggregate: RefreshRunSummary | null,
  batch: RefreshRunSummary,
): RefreshRunSummary {
  if (!aggregate) return { ...batch, results: [...(batch.results ?? [])] };
  return {
    attempted: aggregate.attempted + batch.attempted,
    succeeded: aggregate.succeeded + batch.succeeded,
    failed: aggregate.failed + batch.failed,
    skipped: aggregate.skipped + batch.skipped,
    partial: aggregate.partial + batch.partial,
    postsUpserted: aggregate.postsUpserted + batch.postsUpserted,
    durationMs: aggregate.durationMs + batch.durationMs,
    remaining: batch.remaining,
    blocked: batch.blocked,
    complete: batch.complete,
    results: [...(aggregate.results ?? []), ...(batch.results ?? [])],
  };
}
