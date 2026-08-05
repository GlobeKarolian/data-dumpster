import assert from 'node:assert/strict';
import test from 'node:test';
import { mergePublicChannelMeta, sanitizePooledAudienceExtra, sanitizePublicProfileMeta } from './channel-profile-meta';

test('public profile refreshes preserve global quarantine metadata', () => {
  assert.deepEqual(mergePublicChannelMeta(
    {
      disabledReason: 'Quarantined after identity review.',
      disabledAt: '2026-08-03T12:00:00Z',
      stalePublicField: 'old',
    },
    {
      disabledReason: 'vendor value must not win',
      stalePublicField: 'new',
      biography: 'Public biography',
    },
  ), {
    disabledReason: 'Quarantined after identity review.',
    disabledAt: '2026-08-03T12:00:00Z',
    stalePublicField: 'new',
    biography: 'Public biography',
  });
});

test('pooled profile metadata and audience extras default-deny unknown fields', () => {
  assert.deepEqual(sanitizePublicProfileMeta({
    source: 'ensembledata', isVerified: true, email: 'private@example.com', accessToken: 'secret',
  }), { source: 'ensembledata', isVerified: true });
  assert.deepEqual(sanitizePooledAudienceExtra({ posts: 12.4, postCount: 9, hidden: 7, fanCount: -1 }), {
    posts: 12, postCount: 9,
  });
});
