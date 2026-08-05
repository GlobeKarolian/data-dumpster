import assert from 'node:assert/strict';
import test from 'node:test';
import { channelExternalIdentity, channelIdentityKey } from './channel-identity';

test('normalizes case and @ prefixes for public handles', () => {
  assert.equal(channelIdentityKey('instagram', '@BostonGlobe'), 'handle:bostonglobe');
  assert.equal(channelIdentityKey('twitter', 'BostonGlobe'), 'handle:bostonglobe');
});

test('keeps YouTube channel ids case-sensitive while folding handles', () => {
  assert.equal(
    channelIdentityKey('youtube', 'UCabcdefghijklmnopqrstuv'),
    'channel:UCabcdefghijklmnopqrstuv',
  );
  assert.equal(channelIdentityKey('youtube', '@BostonGlobe'), 'handle:bostonglobe');
});

test('does not collide Reddit users with communities of the same name', () => {
  assert.equal(channelIdentityKey('reddit', 'u/BostonGlobe'), 'user:bostonglobe');
  assert.equal(channelIdentityKey('reddit', 'r/BostonGlobe'), 'subreddit:bostonglobe');
  assert.equal(channelIdentityKey('reddit', 'BostonGlobe'), 'subreddit:bostonglobe');
  assert.equal(channelIdentityKey('reddit', 'u/'), 'subreddit:u');
  assert.equal(channelIdentityKey('reddit', 'r/'), 'subreddit:r');
});

test('canonicalizes the Bluesky DID scheme without duplicating its namespace', () => {
  assert.equal(
    channelIdentityKey('bluesky', 'DID:PLC:AbC123'),
    'did:plc:AbC123',
  );
  assert.equal(channelIdentityKey('bluesky', 'did:bad'), 'handle:did:bad');
});

test('normalizes blank external ids to absence without folding stable ids', () => {
  assert.equal(channelExternalIdentity('  '), null);
  assert.equal(channelExternalIdentity(' UCAbC_123 '), 'UCAbC_123');
});
