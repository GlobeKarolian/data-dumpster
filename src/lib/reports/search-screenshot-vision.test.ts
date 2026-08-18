import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { rowsFromVisionPayload } from './search-screenshot-vision';

describe('vision screenshot rows', () => {
  it('keeps a row whose deltas were blank, which is exactly what the old parser deleted', () => {
    // A query with no prior period prints dashes in the change columns. Those
    // rows are the week's NEW stories, and counting tokens threw them away.
    const { rows, rejected } = rowsFromVisionPayload({
      rows: [
        { query: 'david ina steiner multimillion settlement', clicks: '3,354', impressions: '6,517', ctr: '51.47%' },
        { query: 'north station stabbing', clicks: '1,204', impressions: '5,839', ctr: '20.62%' },
      ],
    });
    assert.equal(rejected.length, 0);
    assert.deepEqual(rows[0], ['david ina steiner multimillion settlement', '3,354', '6,517', '51.47%']);
    assert.deepEqual(rows[1], ['north station stabbing', '1,204', '5,839', '20.62%']);
  });

  it('keeps digits that belong to the query rather than treating them as a metric', () => {
    const { rows } = rowsFromVisionPayload({
      rows: [{ query: 'jeremy conley 98.5', clicks: '484', impressions: '1,271', ctr: '38.08%' }],
    });
    assert.deepEqual(rows[0], ['jeremy conley 98.5', '484', '1,271', '38.08%']);
  });

  it('reports malformed rows instead of dropping them, so a short table cannot look complete', () => {
    const { rows, rejected } = rowsFromVisionPayload({
      rows: [
        { query: 'good row', clicks: '10', impressions: '100', ctr: '10%' },
        { query: 'arrow leaked in', clicks: '1,643 &', impressions: '110,229', ctr: '1.49%' },
        { query: '', clicks: '5', impressions: '50', ctr: '10%' },
        { query: 'ctr is not a percent', clicks: '5', impressions: '50', ctr: '10' },
      ],
    });
    assert.deepEqual(rows, [['good row', '10', '100', '10%']]);
    assert.equal(rejected.length, 3);
    assert.match(rejected[0].reason, /clicks "1,643 &"/);
    assert.match(rejected[1].reason, /empty query/);
    assert.match(rejected[2].reason, /CTR "10"/);
  });

  it('drops exact duplicates from overlapping captures but keeps distinct rows', () => {
    const { rows } = rowsFromVisionPayload({
      rows: [
        { query: 'boston news', clicks: '3,453', impressions: '138,110', ctr: '2.5%' },
        { query: 'boston news', clicks: '3,453', impressions: '138,110', ctr: '2.5%' },
        { query: 'boston news', clicks: '3,999', impressions: '138,110', ctr: '2.5%' },
      ],
    });
    assert.equal(rows.length, 2);
  });

  it('returns nothing rather than guessing when the payload is not the agreed shape', () => {
    assert.deepEqual(rowsFromVisionPayload(null), { rows: [], rejected: [] });
    assert.deepEqual(rowsFromVisionPayload({ rows: 'nope' }), { rows: [], rejected: [] });
  });
});
