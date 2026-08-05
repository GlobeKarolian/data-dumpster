import 'server-only';

import { processRefreshJobWave } from './refresh-jobs';

function trustedAppOrigin(): string {
  // A developer may keep production APP_URL in .env.local for links. Never let
  // a local button press send CRON_SECRET or paid work to that deployment.
  if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
    return 'http://localhost:' + (process.env.PORT ?? '3000');
  }
  const explicit = process.env.APP_URL
    ?? process.env.AUTH_URL
    ?? process.env.NEXTAUTH_URL
    ?? process.env.NEXT_PUBLIC_APP_URL;
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  const candidate = explicit ?? (vercel ? 'https://' + vercel : null);
  if (candidate) {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
      throw new Error('The refresh worker origin must use HTTPS.');
    }
    return parsed.origin;
  }
  throw new Error('A trusted APP_URL or Vercel deployment URL is required for refresh workers.');
}

export function refreshWorkerUrl(): string {
  return new URL('/api/ingest/worker', trustedAppOrigin()).toString();
}

export async function dispatchRefreshJob(jobId: string): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error('CRON_SECRET is required for background refresh dispatch.');

  const response = await fetch(refreshWorkerUrl(), {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + secret,
      'content-type': 'application/json',
      'idempotency-key': 'refresh-wave-' + jobId,
    },
    body: JSON.stringify({ jobId }),
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error('The background refresh worker returned status ' + response.status + '.');
  }
}

/**
 * Run one wave after the caller's response, then wake a fresh invocation.
 * Each wave therefore gets its own function-duration budget.
 */
export async function runRefreshJobAndContinue(jobId: string): Promise<void> {
  const result = await processRefreshJobWave(jobId);
  if (!result.dispatchNext) return;
  try {
    await dispatchRefreshJob(jobId);
  } catch (error) {
    // The Postgres queue and the recurring dispatcher are the recovery path.
    // Never turn a lost wake-up into lost work or expose a secret in the log.
    console.error('[data-dumpster:refresh-dispatch] next wave was not dispatched', {
      jobId,
      error: error instanceof Error ? error.message : 'Unknown dispatch failure.',
    });
  }
}
