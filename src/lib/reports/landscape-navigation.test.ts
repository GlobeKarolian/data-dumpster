import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import {
  reportIndexLandscapeScope,
  reportLandscapeDestination,
  reportListLandscape,
} from './landscape-navigation';

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

  it('does not redirect the platform administrator away from any report', () => {
    assert.equal(reportLandscapeDestination({
      reportId: 'report-election',
      reportLandscapeId: BGM,
      selectedLandscapeId: NEWS,
      landscapeWasExplicit: true,
      alternateReportId: 'report-news',
      searchParams: new URLSearchParams('landscape=' + NEWS),
      platformAdmin: true,
    }), null);
  });

  it('keeps the ordinary report index inside the selected landscape', () => {
    assert.equal(reportIndexLandscapeScope(NEWS, false), NEWS);
  });

  it('gives the platform administrator one all-landscape report index', () => {
    assert.equal(reportIndexLandscapeScope(NEWS, true), null);
  });

  it('links an all-landscape result through its own landscape', () => {
    assert.equal(reportListLandscape(BGM, NEWS), BGM);
    assert.equal(reportListLandscape(null, NEWS), NEWS);
    assert.equal(reportListLandscape(null, null), null);
  });

  it('wires the report index scope and report-owned links into the page query', () => {
    const reportsPage = readFileSync(
      resolve(process.cwd(), 'src/app/(app)/reports/page.tsx'),
      'utf8',
    );

    assert.match(reportsPage, /reportIndexLandscapeScope\(landscapeId, ctx\.isPlatformAdmin\)/);
    assert.match(reportsPage, /r\.landscape_id = \$\{landscapeScope\}::uuid/);
    assert.match(reportsPage, /reportListLandscape\(r\.landscape_id, landscapeId\)/);
  });
});
