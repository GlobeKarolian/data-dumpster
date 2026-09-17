import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createReader, type ReadDependencies } from './reader';
import type { AppContext } from '@/app/(app)/_lib/context';
const context = { orgId: 'org', userId: 'user', role: 'viewer', landscapes: [{ id: 'allowed', slug: 'allowed', name: 'Allowed' }], landscape: { id: 'allowed', slug: 'allowed', name: 'Allowed' }, companies: [{ id: 'brand', name: 'Brand', slug: 'brand' }], error: null } as unknown as AppContext;
function setup(ctx = context) {
  const calls: Record<string, unknown>[] = [];
  const deps: ReadDependencies = {
    context: async () => ctx,
    posts: async q => { calls.push({ ...q }); return { items: [], total: 26, page: q.page ?? 1, pageSize: 25 }; },
    leaderboard: async q => { calls.push({ ...q }); return []; },
    coverage: async q => { calls.push({ ...q }); return null; },
    detail: async q => { calls.push({ ...q }); return null; },
  };
  return { reader: createReader(deps), calls };
}
test('unauthorized explicit landscape performs no metric reads', async () => {
  const { reader, calls } = setup();
  await assert.rejects(() => reader('posts', { landscape: 'denied' }), /Scope unavailable/);
  assert.equal(calls.length, 0);
});
test('unknown company cannot silently become all brands', async () => {
  const { reader, calls } = setup();
  await assert.rejects(() => reader('posts', { companies: 'denied' }), /Scope unavailable/);
  assert.equal(calls.length, 0);
});
test('posts clamp out of range page using true count and tenant-scoped re-read', async () => {
  const { reader, calls } = setup();
  const result = await reader('posts', { page: '999' });
  assert.equal(result.posts?.page, 2);
  assert.equal(result.state.page, 2);
  assert(calls.every(q => q.orgId === 'org' && q.landscapeId === 'allowed'));
  assert.equal(calls.filter(q => q.page === 2).length, 1);
});
test('empty out-of-range metrics pages recover the real count before clamping', async () => {
  const requested: number[] = [];
  const reader = createReader({
    context: async () => context,
    posts: async q => { const page = q.page ?? 1; requested.push(page); return { items: [], total: page > 3 ? 0 : 51, page, pageSize: 25 }; },
    leaderboard: async () => [], coverage: async () => null, detail: async () => null,
  });
  const result = await reader('posts', { page: '999' });
  assert.equal(result.state.page, 3); assert.equal(result.posts?.total, 51);
  assert.deepEqual(requested, [999, 1, 3]);
});
test('pinned intraday comparisons do not request calendar-day deltas', async () => {
  const { reader, calls } = setup();
  await reader('compare', { range: '24h', at: '2026-09-16T14:00:00.000Z' });
  const leaderboard = calls.find(q => 'metric' in q);
  assert.equal(leaderboard?.compare, false);
  assert.equal((leaderboard?.start as Date).toISOString(), '2026-09-15T14:00:00.000Z');
});
test('context failures are not rendered as empty measured observations', async () => {
  const { reader, calls } = setup({ ...context, error: 'database unavailable' });
  await assert.rejects(() => reader('today', {}), /Unable to read/);
  assert.equal(calls.length, 0);
});
test('malformed selected post is refused before UUID detail read', async () => {
  const { reader, calls } = setup();
  const result = await reader('posts', { post: 'not-a-uuid' });
  assert.equal(result.detail, null);
  assert.equal(calls.filter(q => 'postId' in q).length, 0);
});
