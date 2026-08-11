import type { Platform } from '@/lib/types';
import {
  canonicalRefreshPlatforms,
  type RefreshJobSnapshot,
} from '@/lib/adapters/refresh-job-contract';

export interface RefreshScopeRequest {
  landscapeId: string;
  since: string;
  until: string;
  platforms?: Platform[];
}

interface JobEnvelope {
  job: RefreshJobSnapshot | null;
  reused?: boolean;
}

async function responseEnvelope(response: Response): Promise<JobEnvelope> {
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const envelope = payload as { error?: string } | null;
    throw new Error(envelope?.error ?? 'The refresh request failed with status ' + response.status + '.');
  }
  if (!payload || typeof payload !== 'object' || !('job' in payload)) {
    throw new Error('The refresh service returned no job status.');
  }
  return payload as JobEnvelope;
}

export function activeRefreshUrl(request: RefreshScopeRequest): string {
  const search = new URLSearchParams({
    landscapeId: request.landscapeId,
    since: request.since,
    until: request.until,
    monitor: '1',
  });
  const platforms = canonicalRefreshPlatforms(request.platforms);
  if (platforms.length > 0) search.set('platforms', platforms.join(','));
  return '/api/ingest/run?' + search.toString();
}

export async function getRefreshJob(
  jobId: string,
  options: { fetcher?: typeof fetch; signal?: AbortSignal } = {},
): Promise<RefreshJobSnapshot> {
  const response = await (options.fetcher ?? fetch)('/api/ingest/jobs/' + encodeURIComponent(jobId), {
    cache: 'no-store',
    signal: options.signal,
  });
  const envelope = await responseEnvelope(response);
  if (!envelope.job) throw new Error('The refresh job no longer exists.');
  return envelope.job;
}

export async function getActiveRefreshJob(
  request: RefreshScopeRequest,
  options: { fetcher?: typeof fetch; signal?: AbortSignal } = {},
): Promise<RefreshJobSnapshot | null> {
  const response = await (options.fetcher ?? fetch)(activeRefreshUrl(request), {
    cache: 'no-store',
    signal: options.signal,
  });
  return (await responseEnvelope(response)).job;
}

export async function startRefreshJob(
  request: RefreshScopeRequest,
  options: { fetcher?: typeof fetch; signal?: AbortSignal } = {},
): Promise<RefreshJobSnapshot> {
  const response = await (options.fetcher ?? fetch)('/api/ingest/run', {
    method: 'POST',
    cache: 'no-store',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
    signal: options.signal,
  });
  const envelope = await responseEnvelope(response);
  if (!envelope.job) throw new Error('The refresh service returned no job status.');
  return envelope.job;
}
