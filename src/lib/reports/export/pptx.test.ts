import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ReportDocument } from '@/lib/reports/render';
import { renderReportPptx } from './pptx';

describe('renderReportPptx', () => {
  it('returns a valid OOXML zip even when computed data is not available', async () => {
    const doc: ReportDocument = {
      title: 'Weekly social performance',
      orgName: 'Example News',
      period: { start: '2026-07-20', end: '2026-07-26' },
      dataNote: 'Ingestion was still running when this report was prepared.',
      computed: null,
      manual: {
        tables: {},
        figures: { appleUniqueViewers: '12,345' },
      },
      narrative: {
        executiveSummary: 'The editorial team has not yet reviewed the computed metrics.',
      },
    };

    const result = await renderReportPptx(doc);
    assert.ok(Buffer.isBuffer(result));
    assert.deepEqual([...result.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
    assert.ok(result.byteLength > 10_000);
  });
});
