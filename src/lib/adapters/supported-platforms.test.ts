import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ADDABLE_PUBLIC_PROFILE_PLATFORMS,
  ADAPTER_SUPPORTED_PLATFORMS,
  nextAddablePublicPlatform,
  publicProfileOnboardingUnavailableReason,
} from './supported-platforms';

test('channel pickers expose implemented adapters only', () => {
  assert.ok(ADAPTER_SUPPORTED_PLATFORMS.includes('youtube'));
  assert.ok(ADAPTER_SUPPORTED_PLATFORMS.includes('reddit'));
  assert.equal(ADAPTER_SUPPORTED_PLATFORMS.includes('rss' as never), false);
});

test('add-profile picker exposes public-comparable sources only', () => {
  assert.ok(ADDABLE_PUBLIC_PROFILE_PLATFORMS.includes('instagram'));
  assert.ok(ADDABLE_PUBLIC_PROFILE_PLATFORMS.includes('linkedin'));
  assert.equal(ADDABLE_PUBLIC_PROFILE_PLATFORMS.includes('facebook' as never), false);
  assert.equal(ADDABLE_PUBLIC_PROFILE_PLATFORMS.includes('rss' as never), false);
});

test('add-profile selection has an explicit exhausted state', () => {
  assert.equal(nextAddablePublicPlatform(['instagram']), 'twitter');
  assert.equal(nextAddablePublicPlatform([...ADDABLE_PUBLIC_PROFILE_PLATFORMS]), null);
  assert.match(publicProfileOnboardingUnavailableReason('facebook') ?? '', /paid posts crawl/i);
  assert.equal(publicProfileOnboardingUnavailableReason('linkedin'), null);
  assert.equal(publicProfileOnboardingUnavailableReason('instagram'), null);
});
