import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const root = process.cwd();

describe('weekly report presentation', () => {
  it('shows segmented total engagement with exact hover and keyboard figures', () => {
    const panel = readFileSync(
      resolve(root, 'src/components/reports/computed-panel.tsx'),
      'utf8',
    );
    const compute = readFileSync(resolve(root, 'src/lib/reports/compute.ts'), 'utf8');

    assert.match(panel, /title="Total Engagement by BGM Brand"/);
    assert.match(panel, /title="Video Views by BGM Brand"/);
    assert.doesNotMatch(panel, /title="Engagement Rate Change by BGM Brand"/);
    assert.match(panel, /brand\.engagementByPlatform/);
    assert.match(panel, /<Tooltip/);
    assert.match(panel, /aria-label=\{brandName \+ ', ' \+ label \+ ': ' \+ formattedValue\}/);
    assert.match(compute, /engagementByPlatform,/);
    assert.match(compute, /viewsByPlatform,/);
  });

  it('keeps measurement notes internal and makes report posts openable', () => {
    const presentation = readFileSync(
      resolve(root, 'src/components/reports/report-presentation.tsx'),
      'utf8',
    );
    const panel = readFileSync(
      resolve(root, 'src/components/reports/computed-panel.tsx'),
      'utf8',
    );
    const publicDetail = readFileSync(
      resolve(root, 'src/app/api/report-share/[token]/posts/[id]/route.ts'),
      'utf8',
    );

    assert.match(presentation, /const isSharedReport = reportShareToken !== undefined/);
    assert.match(presentation, /!isSharedReport && doc\.computed\.caveats\.length > 0/);
    assert.match(presentation, /showCoverageNotes=\{!isSharedReport\}/);
    assert.match(panel, /<PostDetailDialog/);
    assert.match(panel, /role="button"/);
    assert.match(publicDetail, /sharedReportContainsPost\(report\.computed, id\)/);
  });

  it('keeps the detailed performance figures and complete brand table in shared reports', () => {
    const presentation = readFileSync(
      resolve(root, 'src/components/reports/report-presentation.tsx'),
      'utf8',
    );

    assert.match(presentation, /<PerformanceSection[\s\S]*showCoverageNotes=\{!isSharedReport\}/);
    assert.match(presentation, /<BrandsSection computed=\{doc\.computed\} \/>/);
    assert.match(presentation, /hasVisualBrandMetrics \? <BrandScorecards/);
    assert.ok(
      presentation.indexOf('<PerformanceSection') < presentation.indexOf('<PortfolioCharts'),
      'performance figures should lead the computed report sections',
    );

    const panel = readFileSync(
      resolve(root, 'src/components/reports/computed-panel.tsx'),
      'utf8',
    );
    assert.match(panel, /Platform audience/);
    assert.match(panel, /aria-label=\{label \+ ': ' \+ formatted\}/);
    assert.match(panel, /<PlatformIcon platform=\{p\}/);
    assert.match(panel, /BRAND_RANKING_PLATFORMS = REPORT_PLATFORMS\.filter\(\(platform\) => platform !== 'reddit'\)/);
    assert.match(panel, /BRAND_RANKING_PLATFORMS\.map\(\(p\) =>/);
    assert.doesNotMatch(panel, /colSpan=\{4 \+ REPORT_PLATFORMS\.length\}/);
  });
});
