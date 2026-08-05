import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toApiParams } from './api-params';

describe('toApiParams', () => {
  it('translates the screen vocabulary to the API contract', () => {
    const result = toApiParams(
      new URLSearchParams('companies=a,b&tags=t1&types=reel&q=election&landscape=ignored'),
      'landscape',
    );

    assert.equal(result.get('landscapeId'), 'landscape');
    assert.equal(result.get('companyIds'), 'a,b');
    assert.equal(result.get('tagIds'), 't1');
    assert.equal(result.get('postTypes'), 'reel');
    assert.equal(result.get('search'), 'election');
    assert.equal(result.has('landscape'), false);
  });

  it('lets route-implied scope override a stale query-string platform', () => {
    const result = toApiParams(
      new URLSearchParams('platforms=facebook&range=28d'),
      'landscape',
      { platforms: 'instagram' },
    );

    assert.equal(result.get('platforms'), 'instagram');
    assert.equal(result.get('range'), '28d');
  });
});
