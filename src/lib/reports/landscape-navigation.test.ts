import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { reportLandscapeDestination } from './landscape-navigation';

const BGM = '11111111-1111-1111-1111-111111111111';
const NEWS = '22222222-2222-2222-2222-222222222222';

describe('weekly report landscape navigation', () => {
  it('canonicalizes an unscoped saved report to the landscape that owns it', () => {
    assert.equal(reportLandscapeDestination({
      reportId: 'report-bgm',
      reportLandscapeId: BGM,
      selectedLandscapeId: NEWS,
      landscapeWasExplicit: false,
      alternateReportId: null,
      searchParams: new URLSearchParams('range=28d&companies=stale'),
    }), '/reports/report-bgm?range=28d&landscape=' + BGM);
  });

  it('opens the equivalent dated report when the selected landscape has one', () => {
    assert.equal(reportLandscapeDestination({
      reportId: 'report-bgm',
      reportLandscapeId: BGM,
      selectedLandscapeId: NEWS,
      landscapeWasExplicit: true,
      alternateReportId: 'report-news',
      searchParams: new URLSearchParams('landscape=' + NEWS + '&companies=stale'),
    }), '/reports/report-news?landscape=' + NEWS);
  });

  it('returns to the selected landscape index instead of relabelling another report', () => {
    assert.equal(reportLandscapeDestination({
      reportId: 'report-bgm',
      reportLandscapeId: BGM,
      selectedLandscapeId: NEWS,
      landscapeWasExplicit: true,
      alternateReportId: null,
      searchParams: new URLSearchParams('landscape=' + NEWS),
    }), '/reports?landscape=' + NEWS);
  });

  it('does nothing when the report and selected landscape already agree', () => {
    assert.equal(reportLandscapeDestination({
      reportId: 'report-news',
      reportLandscapeId: NEWS,
      selectedLandscapeId: NEWS,
      landscapeWasExplicit: true,
      alternateReportId: null,
      searchParams: new URLSearchParams('landscape=' + NEWS),
    }), null);
  });

  it('keeps the report index query and detail links inside the selected landscape', () => {
    const reportsPage = readFileSync(
      resolve(process.cwd(), 'src/app/(app)/reports/page.tsx'),
      'utf8',
    );

    assert.match(reportsPage, /AND r\.landscape_id = \$\{landscapeId\}::uuid/);
    assert.match(reportsPage, /'\?landscape=' \+ landscapeId/);
  });
});
