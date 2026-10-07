import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildAyrshareBody, mapAyrshareResponse } from './ayrshare';
import { detectFacets } from './bluesky';
import type { SendRequest } from './types';

const req = (over: Partial<SendRequest> = {}): SendRequest => ({
  platform: 'instagram', text: 'Hi', link: null, linkMode: 'none', preview: null,
  mediaUrls: ['https://img/a.jpg'], instagramCollaborators: ['bostondotcom', 'a', 'b', 'c'],
  idempotencyKey: 'd1', secret: null, ...over,
});

describe('ayrshare', () => {
  it('sends one platform, the idempotency key and at most three collaborators', () => {
    const body = buildAyrshareBody(req());
    assert.deepEqual(body.platforms, ['instagram']);
    assert.equal(body.idempotencyKey, 'd1');
    assert.deepEqual((body.instagramOptions as { collaborators: string[] }).collaborators, ['bostondotcom', 'a', 'b']);
  });
  it('maps success and error shapes', () => {
    const ok = mapAyrshareResponse(200, { status: 'success', id: 'ay1', postIds: [{ status: 'success', id: 'ig9', postUrl: 'https://instagram.com/p/x', platform: 'instagram' }] });
    assert.deepEqual(ok.ok && [ok.providerPostId, ok.postUrl], ['ig9', 'https://instagram.com/p/x']);
    const bad = mapAyrshareResponse(400, { status: 'error', errors: [{ code: 156, message: 'Instagram requires media' }] });
    assert.equal(bad.ok, false);
    assert.equal(!bad.ok && bad.retryable, false);
    const busy = mapAyrshareResponse(503, {});
    assert.equal(!busy.ok && busy.retryable, true);
  });
  it('unwraps the posts array Ayrshare returns for a brand profile', () => {
    const ok = mapAyrshareResponse(200, { status: 'success', posts: [{ status: 'success', id: 'ay2', postIds: [{ status: 'success', id: 'th1', postUrl: 'https://threads.net/@b/post/1', platform: 'threads' }] }] });
    assert.deepEqual(ok.ok && [ok.providerPostId, ok.postUrl], ['th1', 'https://threads.net/@b/post/1']);
    const bad = mapAyrshareResponse(400, { status: 'error', posts: [{ status: 'error', postIds: [], errors: [{ code: 156, message: 'Instagram is not linked.' }] }] });
    assert.equal(!bad.ok && bad.error, 'Instagram is not linked.');
  });
  it('never retries a reused idempotency key', () => {
    const dup = mapAyrshareResponse(400, { status: 'error', errors: [{ message: 'Duplicate idempotencyKey found.' }] });
    assert.equal(!dup.ok && dup.retryable, false);
    assert.match(!dup.ok ? dup.error : '', /may be live/);
  });
});

describe('bluesky facets', () => {
  it('uses byte offsets, so emoji before a link do not shift it', () => {
    const text = '🔥 Read https://bsky.app/x #RedSox';
    const facets = detectFacets(text);
    const bytes = new TextEncoder().encode(text);
    const slice = (f: (typeof facets)[number]) => new TextDecoder().decode(bytes.slice(f.index.byteStart, f.index.byteEnd));
    assert.equal(slice(facets[0]), 'https://bsky.app/x');
    assert.equal(slice(facets[1]), '#RedSox');
  });
});
