import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getExternalBrandHistory } from './external-history';

describe('external brand history', () => {
  it('returns nothing rather than querying when no company is in scope', async () => {
    const r = await getExternalBrandHistory({
      companyIds: [],
      metric: 'engagementTotal',
      start: new Date('2025-01-01'),
      end: new Date('2025-02-01'),
    });
    assert.deepEqual(r, { series: [], sources: [], earliest: null, latest: null });
  });

  it('refuses stock metrics, which cannot be summed across platforms or periods', async () => {
    await assert.rejects(
      () => getExternalBrandHistory({
        companyIds: ['11111111-1111-1111-1111-111111111111'],
        metric: 'audience',
        start: new Date('2025-01-01'),
        end: new Date('2025-02-01'),
      }),
      /refuses stock metrics/,
    );
  });
});
