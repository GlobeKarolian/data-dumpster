import assert from 'node:assert/strict';
import test from 'node:test';
import type { RefreshJobSnapshot } from '@/lib/adapters/refresh-job-contract';
import {
  activeRefreshUrl,
  getActiveRefreshJob,
  getRefreshJob,
  startRefreshJob,
} from './refresh-request';

const job: RefreshJobSnapshot = {
  id: '7beef8b0-aac9-4e35-bb2e-d1d5e6ab7810',
  landscapeId: 'be2be162-4c04-4740-83e2-0e15a23718c0',
  scopeKey: 'be2be162-4c04-4740-83e2-0e15a23718c0',
  platforms: [],
  status: 'running',
  total: 68,
  settled: 10,
  remaining: 58,
  runnableNow: 58,
  running: 0,
  waitingForRetry: 0,
  blocked: 0,
  sourceLimited: 0,
  nextReadyAt: null,
  requiredSince: '2026-06-09T04:00:00.000Z',
  requiredUntil: '2026-08-04T03:59:59.999Z',
  createdAt: '2026-08-04T12:00:00.000Z',
  startedAt: '2026-08-04T12:00:01.000Z',
  finishedAt: null,
  lastError: null,
  activity: { collecting: [], queuedNext: [], recent: [] },
};

test('active scope lookup canonicalizes platform order', async () => {
  const url = activeRefreshUrl({
    landscapeId: job.landscapeId,
    since: job.requiredSince,
    until: job.requiredUntil,
    platforms: ['youtube', 'facebook', 'youtube'],
  });
  assert.equal(
    url,
    '/api/ingest/run?landscapeId=be2be162-4c04-4740-83e2-0e15a23718c0&since=2026-06-09T04%3A00%3A00.000Z&until=2026-08-04T03%3A59%3A59.999Z&monitor=1&platforms=facebook%2Cyoutube',
  );

  let requested = '';
  const found = await getActiveRefreshJob({
    landscapeId: job.landscapeId,
    since: job.requiredSince,
    until: job.requiredUntil,
  }, {
    fetcher: async (input) => {
      requested = String(input);
      return new Response(JSON.stringify({ job }));
    },
  });
  assert.equal(
    requested,
    '/api/ingest/run?landscapeId=' + job.landscapeId
      + '&since=2026-06-09T04%3A00%3A00.000Z&until=2026-08-04T03%3A59%3A59.999Z&monitor=1',
  );
  assert.equal(found?.id, job.id);
});

test('job polling reads the tenant-protected job endpoint', async () => {
  let requested = '';
  const found = await getRefreshJob(job.id, {
    fetcher: async (input) => {
      requested = String(input);
      return new Response(JSON.stringify({ job: { ...job, settled: 68, remaining: 0 } }));
    },
  });
  assert.equal(requested, '/api/ingest/jobs/' + job.id);
  assert.equal(found.remaining, 0);
});

test('manual refresh posts the selected scope to the protected endpoint', async () => {
  let requested = '';
  let init: RequestInit | undefined;
  const found = await startRefreshJob({
    landscapeId: job.landscapeId,
    since: job.requiredSince,
    until: job.requiredUntil,
    platforms: ['youtube'],
  }, {
    fetcher: async (input, requestInit) => {
      requested = String(input);
      init = requestInit;
      return new Response(JSON.stringify({ job }), { status: 202 });
    },
  });

  assert.equal(requested, '/api/ingest/run');
  assert.equal(init?.method, 'POST');
  assert.deepEqual(JSON.parse(String(init?.body)), {
    landscapeId: job.landscapeId,
    since: job.requiredSince,
    until: job.requiredUntil,
    platforms: ['youtube'],
  });
  assert.equal(found.id, job.id);
});
