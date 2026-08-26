/**
 * /api/cron/comments — buy the comments under pooled Instagram posts.
 *
 * Global rather than per-org, because comments on pooled posts are pooled the
 * same way the posts are. Spend is capped twice before this route can hurt
 * anyone: vendor-enforced record limits on every trigger, and the
 * dataset-scoped daily budget consulted before each purchase. Every purchase
 * lands in vendor_spend, so the response's recordsBought maps to the invoice.
 */
import type { NextRequest } from 'next/server';
import { apiHandler } from '@/lib/session';
import { assertCronAuthorized, cronJson } from '../../_lib/cron';
import { publicSourceCredentials } from '@/lib/adapters/public-sources';
import { runCommentCollection } from '@/lib/comments/collect';
import { runCommentSummaryTick } from '@/lib/comments/summarize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function handle(req: NextRequest): Promise<Response> {
  assertCronAuthorized(req);
  const apiKey = publicSourceCredentials('facebook').brightDataApiKey;
  if (!apiKey) {
    return cronJson({ skipped: 'no Bright Data credential configured' });
  }
  const result = await runCommentCollection(apiKey);
  // Summaries ride the same tick, after collection, so a freshly bought
  // section gets its paragraph within the half hour. Failures here must not
  // fail the tick: collection is the paid work, summaries are retryable.
  let summaries = null;
  try {
    summaries = await runCommentSummaryTick();
  } catch (error) {
    console.error('[data-dumpster:cron/comments] summary tick failed', {
      error: error instanceof Error ? error.message : 'Unknown summary failure.',
    });
  }
  return cronJson({
    claimed: result.postsClaimed,
    comments: result.commentsWritten,
    covered: result.covered,
    failed: result.failed,
    recordsBought: result.recordsBought,
    estimatedCents: result.estimatedCents,
    budgetExhausted: result.budgetExhausted,
    summaries,
  });
}

export const GET = apiHandler(handle);
export const POST = apiHandler(handle);
