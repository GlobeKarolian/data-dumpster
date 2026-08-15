import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const dashboard = readFileSync(new URL('./election-race-dashboard.tsx', import.meta.url), 'utf8');
const workspace = readFileSync(new URL('./election-race-workspace.tsx', import.meta.url), 'utf8');
const queries = readFileSync(new URL('../../lib/elections/queries.ts', import.meta.url), 'utf8');

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
    assert.match(dashboard, /landscapeId={race\.landscapeId}/);
  });
});
