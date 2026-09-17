import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readStoredPoster, type ArchiveDependencies } from './archive';
const id = '00000000-0000-4000-8000-000000000001';
test('archive read authorizes the landscape before reading a post and never refreshes upstream', async () => {
  const order: string[] = [];
  const deps: ArchiveDependencies = {
    authorize: async () => { order.push('authorize'); },
    storedUrl: async () => { order.push('post'); return 'private-archive'; },
    stream: async () => { order.push('archive'); return { stream: new ReadableStream(), contentType: 'image/jpeg', contentLength: 12, etag: 'tag' }; },
  };
  const result = await readStoredPoster(id, id, deps);
  assert(result); assert.deepEqual(order, ['authorize','post','archive']);
});
test('invalid scope or denied access never reads private media', async () => {
  let reads = 0;
  const deps: ArchiveDependencies = { authorize: async () => { throw new Error('denied'); }, storedUrl: async () => { reads++; return null; }, stream: async () => null };
  assert.equal(await readStoredPoster('bad', id, deps), null);
  await assert.rejects(() => readStoredPoster(id, id, deps), /denied/);
  assert.equal(reads, 0);
});
test('a missing archive stays missing rather than triggering collection', async () => {
  let streams = 0;
  const result = await readStoredPoster(id, id, { authorize: async () => {}, storedUrl: async () => null, stream: async () => { streams++; return null; } });
  assert.equal(result, null); assert.equal(streams, 0);
});
