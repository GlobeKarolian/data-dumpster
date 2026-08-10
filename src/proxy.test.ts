import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NextRequest } from 'next/server';
import { proxy } from './proxy';

process.env.AUTH_SECRET = 'proxy-test-secret-with-enough-entropy';

describe('request proxy', () => {
  it('leaves public product and policy pages available to reviewers', async () => {
    for (const pathname of [
      '/about',
      '/about/privacy',
      '/about/data-deletion',
      '/about/terms',
    ]) {
      const response = await proxy(new NextRequest('https://example.test' + pathname));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('x-middleware-next'), '1');
    }
  });

  it('keeps the health endpoint public', async () => {
    const response = await proxy(new NextRequest('https://example.test/api/health'));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-middleware-next'), '1');
  });

  it('lets capability-token report links render without a user session', async () => {
    const response = await proxy(new NextRequest('https://example.test/report-share/token-value'));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-middleware-next'), '1');
  });

  it('lets the bearer-authenticated refresh worker reach its route-level auth check', async () => {
    const response = await proxy(
      new NextRequest('https://example.test/api/ingest/worker', { method: 'POST' }),
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-middleware-next'), '1');
  });

  it('does not expose other ingestion endpoints without a user session', async () => {
    const response = await proxy(
      new NextRequest('https://example.test/api/ingest/run', { method: 'POST' }),
    );
    assert.equal(response.status, 401);
  });

  it('returns JSON for an unauthenticated private API request', async () => {
    const response = await proxy(new NextRequest('https://example.test/api/landscapes'));
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), {
      error: 'Sign in to continue.',
      code: 'unauthenticated',
    });
  });

  it('round-trips an unauthenticated page destination through sign-in', async () => {
    const response = await proxy(
      new NextRequest('https://example.test/cross-channel?window=30&landscape=market'),
    );
    assert.equal(response.status, 307);
    const location = new URL(response.headers.get('location') ?? '');
    assert.equal(location.pathname, '/login');
    assert.equal(location.searchParams.get('next'), '/cross-channel?window=30&landscape=market');
  });
});
