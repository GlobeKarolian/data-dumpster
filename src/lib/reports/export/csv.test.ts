import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ReportDocument } from '@/lib/reports/render';
import { csvCell, renderReportCsv } from './csv';

describe('csvCell', () => {
  it('escapes quotes, commas, and line breaks according to RFC 4180', () => {
    assert.equal(csvCell('one, "two"\nthree'), '"one, ""two""\nthree"');
  });

  it('neutralizes spreadsheet formulas without converting real numbers to text', () => {
    assert.equal(csvCell('=HYPERLINK("https://example.com")'), '"\'=HYPERLINK(""https://example.com"")"');
    assert.equal(csvCell('  +SUM(A1:A2)'), '"\'  +SUM(A1:A2)"');
    assert.equal(csvCell(-12.5), '-12.5');
  });

  it('keeps a missing baseline blank and rejects non-finite numbers', () => {
    assert.equal(csvCell(null), '');
    assert.throws(() => csvCell(Number.POSITIVE_INFINITY), /non-finite/);
    assert.throws(() => csvCell(Number.NaN), /non-finite/);
  });
});

describe('renderReportCsv', () => {
  it('exports raw numeric facts and leaves a null change percentage empty', () => {
    const noBaseline = {
      value: 100,
      previousValue: 0,
      changePct: null,
      direction: 'unknown' as const,
    };
    const stable = {
      value: 20,
      previousValue: 20,
      changePct: 0,
      direction: 'flat' as const,
    };
    const doc: ReportDocument = {
      title: 'Weekly "signal"',
      orgName: 'Example News',
      period: { start: '2026-07-20', end: '2026-07-26' },
      dataNote: null,
      computed: {
        version: 1,
        generatedAt: '2026-07-27T12:00:00.000Z',
        landscape: { id: 'landscape-1', name: 'Example Landscape' },
        period: { start: '2026-07-20', end: '2026-07-26' },
        previousPeriod: { start: '2026-07-13', end: '2026-07-19' },
        focus: {
          companyName: 'Example News',
          followers: noBaseline,
          netFollowers: null,
          previousNetFollowers: null,
          engagementTotal: stable,
          posts: stable,
          engagementPerPost: stable,
        },
        portfolio: {
          followers: noBaseline,
          netFollowers: null,
          engagementTotal: stable,
          posts: stable,
          engagementPerPost: stable,
        },
        brands: [{
          companyId: 'company-1',
          name: 'Example News',
          rank: 1,
          totalFollowers: 100,
          previousTotalFollowers: 0,
          netChange: null,
          changePct: null,
          byPlatform: { instagram: 100 },
        }],
        topPosts: [{
          id: 'post-1',
          rank: 1,
          companyName: 'Example News',
          platform: 'instagram',
          postedAt: '2026-07-21T12:00:00.000Z',
          text: '=unsafe, "quoted"',
          permalink: 'https://example.com/post',
          engagementTotal: 20,
        }],
        cohort: {
          landscapeName: 'Example Landscape',
          focusCompanyName: 'Example News',
          focusRank: 1,
          memberCount: 1,
          engagement: stable,
          rows: [{
            companyId: 'company-1',
            name: 'Example News',
            rank: 1,
            engagementTotal: 20,
            changePct: null,
            isFocus: true,
          }],
          focusPostRank: 1,
          focusPostPool: 1,
        },
        caveats: [],
      },
      manual: { tables: {}, figures: {} },
      narrative: {},
    };

    const csv = renderReportCsv(doc);
    assert.match(csv, /"followers",100,0,,"unknown"/);
    assert.match(csv, /"net_followers",,,,,?/);
    assert.match(csv, /"Example News",100,0,,,/);
    assert.match(csv, /"'=unsafe, ""quoted"""/);
    assert.doesNotMatch(csv, /Infinity|NaN/);
  });
});
