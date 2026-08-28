import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  collectionStateOf,
  summarizeCollectionHealth,
  type ChannelRecord,
  type CompanySources,
} from './sources-manager';
import { facebookAdapter } from '@/lib/adapters/meta';
import { POOLED_SOURCE_DISCLOSURE } from '@/lib/adapters/supported-platforms';

function channel(overrides: Partial<ChannelRecord> = {}): ChannelRecord {
  return {
    id: 'channel-1',
    platform: 'facebook',
    handle: 'example',
    profileUrl: null,
    active: true,
    lastIngestedAt: '2026-07-31T12:00:00Z',
    lastRunStatus: 'succeeded',
    lastRunError: null,
    collectionStatus: 'succeeded',
    collectionOutcome: 'certified_complete',
    collectionRequiredSince: '2026-05-01T00:00:00Z',
    collectionRequiredUntil: '2026-07-31T00:00:00Z',
    collectionCoverageSince: '2026-05-01T00:00:00Z',
    collectionCoverageUntil: '2026-07-31T00:00:00Z',
    collectionAttempts: 1,
    collectionNextAttemptAt: null,
    collectionLeaseUntil: null,
    collectionHasMore: false,
    collectionLastError: null,
    collectionUpdatedAt: '2026-07-31T12:00:00Z',
    postCount: 10,
    ...overrides,
  };
}

test('requires durable bounds covering the entire requested window', () => {
  assert.equal(collectionStateOf(channel()).health, 'complete');
  assert.equal(collectionStateOf(channel({
    collectionCoverageSince: '2026-05-02T00:00:00Z',
  })).health, 'blocked');
  assert.equal(collectionStateOf(channel({ collectionOutcome: null })).health, 'blocked');
  // A source-certification limit is not an error: recent data is usable, the
  // history depth proof is capped. It reads complete, not a warning tier.
  assert.equal(collectionStateOf(channel({ collectionOutcome: 'terminal_source_limitation' })).health, 'complete');
});

test('a source limit reads complete; only genuine failures surface as blocked', () => {
  const limited = collectionStateOf(channel({
    collectionStatus: 'partial',
    collectionOutcome: 'terminal_source_limitation',
    collectionLastError: 'The source exposes a selected highlights feed, not a chronological timeline.',
  }));
  assert.equal(limited.health, 'complete');
  assert.equal(limited.label, 'Complete');
  assert.equal(limited.cause, null);

  const permanent = collectionStateOf(channel({
    collectionStatus: 'failed',
    collectionOutcome: 'permanent_failure',
    collectionLastError: 'API credential is unauthorized',
  }));
  assert.equal(permanent.health, 'blocked');
  assert.equal(permanent.label, 'Action required');
  assert.equal(permanent.cause?.key, 'credentials');

  for (const collectionOutcome of ['continuation', 'retryable_operational_failure'] as const) {
    const state = collectionStateOf(channel({
      collectionStatus: collectionOutcome === 'continuation' ? 'partial' : 'failed',
      collectionOutcome,
      collectionNextAttemptAt: null,
    }));
    assert.equal(state.health, 'collecting');
  }
});

test('Facebook settings describe only the current pooled route', () => {
  const settingsUi = readFileSync(
    resolve(process.cwd(), 'src/components/settings/sources-manager.tsx'),
    'utf8',
  );

  assert.deepEqual(facebookAdapter.credentialFields, []);
  assert.match(facebookAdapter.accessNotes, /existing Facebook profiles use Bright Data only/i);
  assert.match(facebookAdapter.accessNotes, /Meta verification does not activate/i);
  assert.doesNotMatch(facebookAdapter.accessNotes, /set ppcaApproved|supply ppcaAccessToken/i);

  assert.match(POOLED_SOURCE_DISCLOSURE.vendors, /Bright Data.*primary/i);
  assert.match(POOLED_SOURCE_DISCLOSURE.vendors, /LinkedIn/i);
  assert.match(POOLED_SOURCE_DISCLOSURE.vendors, /YouTube and Bluesky.*sanctioned/i);
  assert.match(POOLED_SOURCE_DISCLOSURE.facebook, /Bright Data only/i);
  assert.match(POOLED_SOURCE_DISCLOSURE.facebook, /onboarding remains unavailable/i);
  assert.match(POOLED_SOURCE_DISCLOSURE.meta, /not connected to pooled collection/i);
  assert.match(POOLED_SOURCE_DISCLOSURE.meta, /verification does not activate/i);
  assert.match(settingsUi, /aria-label="Pooled source routing"/);
  assert.match(settingsUi, /POOLED_SOURCE_DISCLOSURE\.vendors/);
  assert.match(settingsUi, /POOLED_SOURCE_DISCLOSURE\.facebook/);
  assert.match(settingsUi, /POOLED_SOURCE_DISCLOSURE\.meta/);
});

test('legacy Facebook PPCA failures cannot advertise a dormant Settings path', () => {
  const state = collectionStateOf(channel({
    collectionStatus: 'failed',
    collectionOutcome: 'permanent_failure',
    collectionCoverageSince: null,
    collectionCoverageUntil: null,
    collectionLastError: 'Facebook needs Page Public Content Access. Set ppcaApproved and supply ppcaAccessToken.',
  }));

  assert.equal(state.cause?.key, 'facebook-source-policy');
  assert.match(state.error ?? '', /Bright Data only/i);
  assert.match(state.error ?? '', /not connected to pooled collection/i);
  assert.doesNotMatch(state.error ?? '', /ppcaApproved|ppcaAccessToken|credential|secret/i);
});

test('treats an expired worker lease as blocked', () => {
  const state = collectionStateOf(channel({
    collectionStatus: 'running',
    collectionLeaseUntil: '2026-07-31T11:00:00Z',
  }), Date.parse('2026-07-31T12:00:00Z'));

  assert.equal(state.health, 'blocked');
  assert.equal(state.label, 'Stalled');
});

test('groups vendor failures and counts active LinkedIn public profiles normally', () => {
  const company: CompanySources = {
    id: 'company-1',
    name: 'Example',
    manageable: true,
    channels: [
      channel({
        collectionStatus: 'failed',
        collectionOutcome: 'permanent_failure',
        collectionCoverageSince: null,
        collectionCoverageUntil: null,
        collectionLastError: 'Bright Data: HTTP 400. Customer is not active',
      }),
      channel({
        id: 'linkedin',
        platform: 'linkedin',
        handle: 'example',
        active: true,
      }),
      channel({ id: 'reddit', platform: 'reddit', handle: 'r/example', active: false }),
    ],
  };

  const summary = summarizeCollectionHealth([company]);
  assert.equal(summary.total, 2);
  assert.equal(summary.blocked, 1);
  assert.equal(summary.complete, 1);
  assert.equal(summary.paused, 1);
  assert.equal(summary.blockedCauses[0]?.key, 'vendor-access');
  const linkedin = collectionStateOf(company.channels[1]);
  assert.equal(linkedin.health, 'complete');
  assert.equal(linkedin.label, 'Complete');
});

test('source limits count as complete; only operator failures surface as blocked', () => {
  const company: CompanySources = {
    id: 'company-1',
    name: 'Example',
    manageable: true,
    channels: [
      channel({ id: 'complete' }),
      channel({
        id: 'source-limited',
        collectionStatus: 'partial',
        collectionOutcome: 'terminal_source_limitation',
        collectionLastError: 'Only a selected feed is available.',
      }),
      channel({
        id: 'retry',
        collectionStatus: 'failed',
        collectionOutcome: 'retryable_operational_failure',
      }),
      channel({
        id: 'permanent',
        collectionStatus: 'failed',
        collectionOutcome: 'permanent_failure',
      }),
    ],
  };

  const summary = summarizeCollectionHealth([company]);
  assert.equal(summary.complete, 2);
  assert.equal(summary.collecting, 1);
  assert.equal(summary.blocked, 1);
  assert.equal(summary.blockedCauses[0]?.key, 'permanent-failure');
  assert.equal(summary.blockedCauses.length, 1);
});

test('normal settings UI cannot mutate or delete globally pooled profiles and companies', () => {
  const root = process.cwd();
  const sources = readFileSync(resolve(root, 'src/components/settings/sources-manager.tsx'), 'utf8');
  const companies = readFileSync(resolve(root, 'src/components/settings/companies-manager.tsx'), 'utf8');
  const channelRoute = readFileSync(
    resolve(root, 'src/app/api/companies/[id]/channels/route.ts'),
    'utf8',
  );
  const companyRoute = readFileSync(resolve(root, 'src/app/api/companies/[id]/route.ts'), 'utf8');

  assert.doesNotMatch(sources, /method:\s*['"](?:PATCH|DELETE)['"]/);
  assert.doesNotMatch(companies, /send\('\/api\/companies\/'\s*\+\s*id,\s*['"]DELETE['"]\)/);
  assert.doesNotMatch(channelRoute, /db\s*\.delete\(channels\)/);
  assert.doesNotMatch(companyRoute, /db\s*\.delete\(companies\)/);
  assert.match(channelRoute, /requireRole\('admin'\)/);
  assert.match(channelRoute, /scope:\s*z\.literal\('global'\)/);
  assert.match(channelRoute, /pooled_channel_delete_disabled/);
  assert.match(companyRoute, /pooled_company_delete_disabled/);
});
