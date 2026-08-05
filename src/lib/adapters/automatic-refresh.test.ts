import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { AUTOMATIC_REFRESH_INTERVAL_MS } from './automatic-refresh';

interface CronEntry {
  path: string;
  schedule: string;
}

test('automatic profile freshness is limited to two normal windows per day', () => {
  assert.equal(AUTOMATIC_REFRESH_INTERVAL_MS, 12 * 60 * 60 * 1_000);
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

test('the shell is a status monitor and direct coordinators respect the freshness fence', () => {
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

  assert.match(button, /Automatic · 2× daily/);
  assert.match(request, /monitor: '1'/);
  assert.doesNotMatch(button, /startRefreshJob|method:\s*['"]POST['"]/);
  assert.doesNotMatch(request, /startRefreshJob|method:\s*['"]POST['"]/);
  assert.doesNotMatch(coordinators, /force:\s*true/);
});
