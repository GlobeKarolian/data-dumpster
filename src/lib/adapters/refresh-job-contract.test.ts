import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  canonicalRefreshPlatforms,
  mergeRefreshPlatformSelections,
  refreshActivityPhaseForState,
  refreshCoordinatorScopeKey,
  refreshPlatformSelectionCovers,
  refreshRequestScopesCover,
  refreshScopeKey,
  refreshStatusFromProgress,
  settledProfiles,
  shouldDispatchNextWave,
} from './refresh-job-contract';

describe('refresh job contract', () => {
  it('uses one canonical scope for equivalent platform selections', () => {
    assert.deepEqual(
      canonicalRefreshPlatforms(['youtube', 'facebook', 'youtube']),
      ['facebook', 'youtube'],
    );
    assert.equal(
      refreshScopeKey(
        'landscape-1',
        undefined,
        '2026-07-01T04:00:00.000Z',
        '2026-07-29T03:59:59.999Z',
      ),
      'landscape-1:*:2026-07-01T04:00:00.000Z:2026-07-29T03:59:59.999Z',
    );
    assert.equal(
      refreshScopeKey(
        'landscape-1',
        ['youtube', 'facebook'],
        '2026-07-01T04:00:00.000Z',
        '2026-07-08T03:59:59.999Z',
      ),
      'landscape-1:facebook,youtube:2026-07-01T04:00:00.000Z:2026-07-08T03:59:59.999Z',
    );
    assert.equal(refreshCoordinatorScopeKey('landscape-1'), 'landscape-1');
  });

  it('keeps equal-length custom windows distinct', () => {
    const july = refreshScopeKey(
      'landscape-1',
      undefined,
      '2026-07-12T04:00:00.000Z',
      '2026-07-27T03:59:59.999Z',
    );
    const august = refreshScopeKey(
      'landscape-1',
      undefined,
      '2026-07-20T04:00:00.000Z',
      '2026-08-04T03:59:59.999Z',
    );
    assert.notEqual(july, august);
  });

  it('coalesces overlapping platform requests without losing all-platform semantics', () => {
    assert.equal(refreshPlatformSelectionCovers([], ['facebook']), true);
    assert.equal(refreshPlatformSelectionCovers(['facebook'], []), false);
    assert.equal(refreshPlatformSelectionCovers(['facebook', 'youtube'], ['facebook']), true);
    assert.deepEqual(
      mergeRefreshPlatformSelections(['facebook'], ['youtube']),
      ['facebook', 'youtube'],
    );
    assert.deepEqual(mergeRefreshPlatformSelections(['facebook'], []), []);
  });

  it('recognizes covering scopes without treating a shorter or disjoint crawl as complete', () => {
    const scopes = [{
      platforms: ['facebook'] as const,
      since: '2026-07-01T04:00:00.000Z',
      until: '2026-08-04T03:59:59.999Z',
    }];
    assert.equal(refreshRequestScopesCover(
      scopes.map((scope) => ({ ...scope, platforms: [...scope.platforms] })),
      ['facebook'],
      new Date('2026-07-20T04:00:00.000Z'),
      new Date('2026-07-27T03:59:59.999Z'),
    ), true);
    assert.equal(refreshRequestScopesCover(
      scopes.map((scope) => ({ ...scope, platforms: [...scope.platforms] })),
      ['instagram'],
      new Date('2026-07-20T04:00:00.000Z'),
      new Date('2026-07-27T03:59:59.999Z'),
    ), false);
    assert.equal(refreshRequestScopesCover(
      scopes.map((scope) => ({ ...scope, platforms: [...scope.platforms] })),
      ['facebook'],
      new Date('2026-06-01T04:00:00.000Z'),
      new Date('2026-07-27T03:59:59.999Z'),
    ), false);
  });

  it('classifies the live readout from durable queue facts', () => {
    const now = new Date('2026-08-04T12:00:00.000Z');
    assert.equal(refreshActivityPhaseForState({
      status: 'running', outcome: null, nextAttemptAt: null,
      leaseUntil: new Date('2026-08-04T12:05:00.000Z'), now,
    }), 'collecting');
    assert.equal(refreshActivityPhaseForState({
      status: 'queued', outcome: 'terminal_source_limitation',
      nextAttemptAt: new Date('2026-08-04T11:59:00.000Z'), leaseUntil: null, now,
    }), 'queued', 'a forced requeue must override an older source-limited outcome');
    assert.equal(refreshActivityPhaseForState({
      status: 'failed', outcome: 'retryable_operational_failure',
      nextAttemptAt: new Date('2026-08-04T12:05:00.000Z'), leaseUntil: null, now,
    }), 'waiting');
    assert.equal(refreshActivityPhaseForState({
      status: 'failed', outcome: 'permanent_failure', nextAttemptAt: null,
      leaseUntil: null, now,
    }), 'needs_attention');
    assert.equal(refreshActivityPhaseForState({
      status: 'partial', outcome: 'terminal_source_limitation', nextAttemptAt: null,
      leaseUntil: null, now,
    }), 'source_limited');
  });

  it('finishes with issues instead of looping on blocked or source-limited profiles', () => {
    assert.equal(refreshStatusFromProgress('running', {
      remaining: 0,
      blocked: 2,
      sourceLimited: 3,
    }), 'completed_with_issues');
    assert.equal(refreshStatusFromProgress('running', {
      remaining: 0,
      blocked: 0,
      sourceLimited: 0,
    }), 'completed');
  });

  it('never reopens a terminal job when the shared channel queue changes later', () => {
    for (const status of ['completed', 'completed_with_issues', 'failed'] as const) {
      assert.equal(refreshStatusFromProgress(status, {
        remaining: 12,
        blocked: 0,
        sourceLimited: 0,
      }), status);
    }
  });

  it('does not hot-loop when all remaining work is waiting for retry', () => {
    assert.equal(shouldDispatchNextWave({
      total: 68,
      remaining: 4,
      runnableNow: 0,
      running: 0,
      waitingForRetry: 4,
      blocked: 0,
      sourceLimited: 0,
      nextReadyAt: new Date('2026-08-04T13:00:00.000Z'),
    }), false);
  });

  it('reports settled profiles from unique targets rather than wave attempts', () => {
    assert.equal(settledProfiles(68, 58), 10);
    assert.equal(settledProfiles(68, -1), 68);
    assert.equal(settledProfiles(68, 99), 0);
  });
});
