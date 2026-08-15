import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const workspace = readFileSync(new URL('./election-race-workspace.tsx', import.meta.url), 'utf8');
const connector = readFileSync(
  new URL('../../lib/elections/source-connection.ts', import.meta.url),
  'utf8',
);
const cron = readFileSync(
  new URL('../../app/api/cron/ingest/route.ts', import.meta.url),
  'utf8',
);

describe('Election Center profile onboarding', () => {
  it('connects supplied profile URLs automatically instead of assigning setup chores', () => {
    assert.doesNotMatch(workspace, /Verify & connect|Ready to verify/);
    assert.match(workspace, /connects and starts collecting them automatically/);
    assert.match(workspace, /\/connect-sources/);
  });

  it('runs from the durable scheduled path and reserves review for conflicts', () => {
    assert.match(cron, /connectPendingElectionSources/);
    assert.match(connector, /FOR UPDATE SKIP LOCKED/);
    assert.match(connector, /pooled_account_identity_conflict/);
    assert.match(connector, /status: 'review'/);
  });

  it('stages Facebook identity without buying a duplicate preflight crawl', () => {
    assert.match(connector, /allowDeferredFacebookIdentity: true/);
  });
});
