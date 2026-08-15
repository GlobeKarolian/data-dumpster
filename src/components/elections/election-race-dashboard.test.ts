import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const dashboard = readFileSync(new URL('./election-race-dashboard.tsx', import.meta.url), 'utf8');
const workspace = readFileSync(new URL('./election-race-workspace.tsx', import.meta.url), 'utf8');
const queries = readFileSync(new URL('../../lib/elections/queries.ts', import.meta.url), 'utf8');
const page = readFileSync(new URL('../../app/(app)/elections/[slug]/page.tsx', import.meta.url), 'utf8');
const topbar = readFileSync(new URL('../shell/topbar.tsx', import.meta.url), 'utf8');

describe('Live Election Center analytics', () => {
  it('replaces the setup placeholder with the four substantive race views', () => {
    assert.match(dashboard, /State of the field/);
    assert.match(dashboard, /Candidate profiles/);
    assert.match(dashboard, /Head-to-head/);
    assert.match(dashboard, /Top content/);
    assert.match(workspace, /ElectionRaceDashboard/);
    assert.doesNotMatch(workspace, /h-24 rounded-lg bg-gradient/);
  });

  it('uses the shared metrics layer instead of a fabricated viability score', () => {
    assert.match(queries, /getLeaderboard/);
    assert.match(queries, /getTimeSeries/);
    assert.match(queries, /getTopPostsByPlatform/);
    assert.match(dashboard, /Share of engagement/);
    assert.doesNotMatch(dashboard, /Social viability/);
  });

  it('keeps source administration available without making it the default page', () => {
    assert.match(workspace, /<details/);
    assert.match(workspace, /Sources &amp; candidate setup/);
    assert.match(workspace, /Review source/);
  });

  it('opens rich post details from the race content view', () => {
    assert.match(dashboard, /TopPostsPanel/);
    assert.match(dashboard, /Content shaping the race/);
    assert.match(dashboard, /Top content driving the race/);
    assert.match(dashboard, /candidate\.name \+ ' top content'/);
    assert.match(dashboard, /landscapeId={race\.landscapeId}/);
  });

  it('recomputes every race metric against the selected URL date range', () => {
    assert.match(workspace, /<DateRangePicker/);
    assert.match(page, /parseRangeParams/);
    assert.match(page, /getElectionRaceAnalytics\(race, session, range\)/);
    assert.match(queries, /range: DateRange/);
    assert.match(queries, /metric: 'posts', granularity: autoGranularity\(range\)/);
    assert.match(queries, /metric: 'views', granularity: autoGranularity\(range\)/);
  });

  it('shows a single race-scoped refresh and multiple detailed trend views', () => {
    assert.match(topbar, /!isElectionDetail/);
    assert.match(workspace, /<RefreshButton/);
    assert.match(dashboard, /Engagement momentum/);
    assert.match(dashboard, /Publishing pace/);
    assert.match(dashboard, /Video-view momentum/);
    assert.match(dashboard, /ChartTooltip/);
  });
});
