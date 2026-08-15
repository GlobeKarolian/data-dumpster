import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../../../drizzle/0014_2028_presidential_watchlist.sql', import.meta.url),
  'utf8',
);
const expansion = readFileSync(
  new URL('../../../drizzle/0016_presidential_complete_account_roster.sql', import.meta.url),
  'utf8',
);
const route = readFileSync(
  new URL('../../app/(app)/elections/2028/page.tsx', import.meta.url),
  'utf8',
);
const workspace = readFileSync(new URL('./election-race-workspace.tsx', import.meta.url), 'utf8');

test('the 2028 concept URL now opens the live national tracker', () => {
  assert.match(route, /permanentRedirect\('\/elections\/2028-presidential-watchlist'\)/);
  assert.doesNotMatch(route, /ElectionTrackerPreview/);
});

test('the supplied watchlist seeds twenty people and the complete candidate-controlled account roster', () => {
  const roster = migration
    .split('WITH roster("candidate_key", "slug", "name"', 2)[1]
    .split('INSERT INTO "companies"', 1)[0];
  const sources = migration
    .split('), supplied("candidate_key"', 2)[1]
    .split('INSERT INTO "election_profile_sources"', 1)[0];
  assert.equal((roster.match(/^\s*\('[^']+', '[^']+',/gm) ?? []).length, 20);
  assert.equal((sources.match(/'pending'/g) ?? []).length, 81);
  assert.equal((expansion.match(/^\s*\('[^']+', '[^']+'::platform,/gm) ?? []).length, 25);
  assert.match(expansion, /truthsocial\.com\/@VivekRamaswamy/);
  assert.match(expansion, /candidate_platform_url_uq/);
  assert.doesNotMatch(sources, /jd-vance-1\.bsky\.social/);
});

test('the watchlist is labeled as attention data rather than candidacy or polling', () => {
  assert.match(workspace, /Prospective-candidate watchlist/);
  assert.match(workspace, /Inclusion does not mean someone has declared or will run/);
  assert.match(workspace, /social performance is not polling/i);
  assert.match(workspace, /Candidate-controlled accounts/);
  assert.match(workspace, /more than one account on the same platform/);
});
