import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  AUTOMATIC_REFRESH_INTERVAL_MS,
  automaticRefreshWindowStart,
} from './automatic-refresh';

interface CronEntry {
  path: string;
  schedule: string;
}

test('automatic profile freshness is limited to two normal windows per day', () => {
  assert.equal(AUTOMATIC_REFRESH_INTERVAL_MS, 12 * 60 * 60 * 1_000);
});

test('automatic freshness is aligned to midnight and noon instead of worker start time', () => {
  assert.equal(
    automaticRefreshWindowStart(new Date('2026-08-11T00:01:24.461Z')).toISOString(),
    '2026-08-11T00:00:00.000Z',
  );
  assert.equal(
    automaticRefreshWindowStart(new Date('2026-08-11T12:00:16.448Z')).toISOString(),
    '2026-08-11T12:00:00.000Z',
  );
});

test('production opens exactly two collection windows and recovery cannot enqueue fresh work', () => {
  const root = process.cwd();
  const config = JSON.parse(
    readFileSync(resolve(root, 'vercel.json'), 'utf8'),
  ) as { crons: CronEntry[] };

  assert.deepEqual(config.crons, [
    { path: '/api/cron/refresh', schedule: '*/10 * * * *' },
    {
      path: '/api/cron/ingest?mode=scheduled&limit=250&postLimit=500',
      schedule: '0 0,12 * * *',
    },
    {
      path: '/api/cron/ingest?mode=recover&limit=250&postLimit=500',
      schedule: '5,15,25,35,45,55 * * * *',
    },
    // AI tagging reads posts already collected and bills the org's own model.
    // It is not a collection window: it can never create vendor demand.
    { path: '/api/cron/tag', schedule: '8,18,28,38,48,58 * * * *' },
    { path: '/api/cron/narrate', schedule: '3,13,23,33,43,53 * * * *' },
    // The nightly backup reads the database and writes to Blob storage. It
    // is not a collection window either: no vendor is ever called.
    { path: '/api/cron/backup', schedule: '0 7 * * *' },
  ]);
  assert.equal(config.crons.filter((entry) => entry.path.includes('mode=scheduled')).length, 1);
  assert.equal(config.crons.some((entry) => entry.path.includes('/api/cron/coverage')), false);

  const route = readFileSync(
    resolve(root, 'src/app/api/cron/ingest/route.ts'),
    'utf8',
  );
  assert.match(route, /mode === 'scheduled' \? await runner\.enqueueTrackedProfiles\(\) : 0/);
  assert.match(route, /mode === 'scheduled'[\s\S]*startAutomaticRefreshCoordinators\(\)/);
});

test('automatic collection keeps its fence while named operators can start a forced refresh', () => {
  const root = process.cwd();
  const button = readFileSync(
    resolve(root, 'src/components/shell/refresh-button.tsx'),
    'utf8',
  );
  const request = readFileSync(
    resolve(root, 'src/components/shell/refresh-request.ts'),
    'utf8',
  );
  const coordinators = readFileSync(
    resolve(root, 'src/lib/adapters/refresh-jobs.ts'),
    'utf8',
  );
  const route = readFileSync(
    resolve(root, 'src/app/api/ingest/run/route.ts'),
    'utf8',
  );

  assert.match(button, /Automatic · 2× daily/);
  assert.match(request, /monitor: '1'/);
  assert.match(button, /manualRefreshAllowed/);
  assert.match(request, /startRefreshJob[\s\S]*method:\s*'POST'/);
  assert.match(route, /canTriggerManualRefresh\(session\.email\)/);
  assert.match(route, /forceCollection:\s*true/);
  assert.match(coordinators, /force:\s*input\.forceCollection \?\? false/);
  assert.doesNotMatch(coordinators, /force:\s*true/);
});
