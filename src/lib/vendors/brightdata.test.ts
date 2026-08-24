import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AdapterError } from '@/lib/adapters/types';
import { PendingSnapshotError, scrapeSync } from './brightdata';

const OPTIONS = {
  apiKey: 'test-key',
  platform: 'facebook' as const,
};

function abortableHang(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    if (!signal) {
      reject(new Error('expected a request signal'));
      return;
    }
    if (signal.aborted) {
      reject(signal.reason ?? new Error('aborted'));
      return;
    }
    signal.addEventListener(
      'abort',
      () => reject(signal.reason ?? new Error('aborted')),
      { once: true },
    );
  });
}

describe('Bright Data operation deadline', () => {
  it('always starts paid work through the resumable trigger endpoint', async (t) => {
    let requestedUrl = '';
    t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({ snapshot_id: 'sd_trigger_test' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    await assert.rejects(
      scrapeSync('dataset', [{ profile_url: 'https://example.com/profile' }], {
        ...OPTIONS,
        discoverBy: 'profile',
        timeoutMs: 30,
      }),
      (err: unknown) => err instanceof PendingSnapshotError,
    );

    const url = new URL(requestedUrl);
    assert.equal(url.pathname, '/datasets/v3/trigger');
    assert.equal(url.searchParams.get('type'), 'discover_new');
    assert.equal(url.searchParams.get('discover_by'), 'profile');
  });

  it('aborts a hung trigger once, inside the whole-operation budget', async (t) => {
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      calls += 1;
      return await abortableHang(init?.signal);
    });

    const startedAt = Date.now();
    await assert.rejects(
      scrapeSync('dataset', [{ url: 'https://example.com/profile' }], {
        ...OPTIONS,
        timeoutMs: 30,
      }),
      (err: unknown) => {
        assert.ok(err instanceof AdapterError);
        assert.equal(err.opts.retryable, true);
        assert.match(err.message, /operation exceeded its 30ms budget/i);
        return true;
      },
    );

    assert.equal(calls, 1, 'a timed-out attempt must not receive a fresh retry budget');
    assert.ok(Date.now() - startedAt < 500, 'the configured total budget must bound the call');
  });

  it('clips retry backoff to the same operation deadline', async (t) => {
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      calls += 1;
      throw new TypeError('socket closed');
    });

    const startedAt = Date.now();
    await assert.rejects(
      scrapeSync('dataset', [{ url: 'https://example.com/profile' }], {
        ...OPTIONS,
        timeoutMs: 35,
      }),
      /operation exceeded its 35ms budget/i,
    );

    assert.ok(calls < 3, 'the client must stop retrying when the shared deadline expires');
    assert.ok(Date.now() - startedAt < 500, 'retry backoff must not outlive the operation budget');
  });

  it('returns the paid receipt when snapshot polling uses the remaining budget', async (t) => {
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      calls += 1;
      return new Response(JSON.stringify({ snapshot_id: 'sd_deadline_test' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const startedAt = Date.now();
    await assert.rejects(
      scrapeSync('dataset', [{ url: 'https://example.com/profile' }], {
        ...OPTIONS,
        timeoutMs: 40,
      }),
      (err: unknown) => {
        assert.ok(err instanceof PendingSnapshotError);
        assert.equal(err.snapshotId, 'sd_deadline_test');
        return true;
      },
    );

    assert.equal(calls, 1, 'an expired poll budget must not trigger or poll another paid request');
    assert.ok(Date.now() - startedAt < 500, 'snapshot polling must share the original deadline');
  });
});

/*
 * These four exist because a spend cap was passed in the request body, where
 * this dataset accepts and ignores it, and 57,037 records were bought in a
 * round meant to buy 150. limit_per_input is a trigger query parameter or it is
 * nothing, so the query string is what the tests assert on.
 */
describe('Bright Data record caps', () => {
  async function triggerUrlFor(opts: Record<string, unknown>, t: {
    mock: { method: typeof import('node:test').mock.method };
  }): Promise<string> {
    let requestedUrl = '';
    t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({ snapshot_id: 'sd_cap' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    await assert.rejects(scrapeSync('dataset', [{ url: 'https://example.com/g' }], {
      ...OPTIONS, timeoutMs: 40, ...opts,
    }));
    return requestedUrl;
  }

  it('sends the record cap as a trigger query parameter, not a body field', async (t) => {
    const url = await triggerUrlFor({ limitPerInput: 75 }, t);
    assert.match(url, /[?&]limit_per_input=75(&|$)/);
  });

  it('caps the total as well as the per-input count', async (t) => {
    const url = await triggerUrlFor({ limitPerInput: 75, limitTotal: 75 }, t);
    assert.match(url, /[?&]limit_multiple_results=75(&|$)/);
  });

  it('omits the cap entirely when none is asked for', async (t) => {
    const url = await triggerUrlFor({}, t);
    assert.ok(!url.includes('limit_per_input'), 'an absent cap must not become limit_per_input=');
  });

  it('refuses a cap that would not bind', async (t) => {
    // Bright Data rejects limit_per_input=0 and ignores a non-integer, and an
    // ignored cap is indistinguishable from no cap right up until the invoice.
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const url = await triggerUrlFor({ limitPerInput: bad }, t);
      assert.ok(
        !url.includes('limit_per_input'),
        'a cap of ' + String(bad) + ' must be dropped rather than sent',
      );
    }
  });
});
