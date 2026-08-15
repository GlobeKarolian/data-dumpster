import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { facebookAdapter } from './meta';

describe('Facebook public profile handles', () => {
  it('reads Meta numeric-backed /p/ profile URLs without collapsing them to p', () => {
    assert.equal(
      facebookAdapter.parseHandle('https://www.facebook.com/p/JD-Vance-100070055152736/'),
      'JD-Vance-100070055152736',
    );
  });

  it('keeps legacy /pg/ Page URLs working', () => {
    assert.equal(
      facebookAdapter.parseHandle('https://www.facebook.com/pg/SenatorCoryBooker/'),
      'SenatorCoryBooker',
    );
  });
});
