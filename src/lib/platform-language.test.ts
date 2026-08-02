import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyRedditHandle,
  classifyRedditHandles,
  platformAudienceNoun,
  platformHandleLabel,
  platformMetricLabel,
  publicationNoun,
} from './platform-language';

test('video-first platforms use video language', () => {
  assert.equal(publicationNoun('tiktok'), 'Videos');
  assert.equal(platformMetricLabel('postsPerDay', 'youtube'), 'Videos per Day');
  assert.equal(platformMetricLabel('engagementPerPost', 'tiktok'), 'Engagement per Video');
});

test('other platforms retain post language', () => {
  assert.equal(publicationNoun('instagram'), 'Posts');
  assert.equal(platformMetricLabel('engagementPerPost', 'instagram'), 'Engagement per Post');
});

test('audience is called followers on a platform screen', () => {
  assert.equal(platformMetricLabel('audience', 'facebook'), 'Followers');
  assert.equal(platformMetricLabel('audienceNetChange', 'twitter'), 'Followers Net Change');
});

test('YouTube uses subscriber language for every audience metric', () => {
  assert.equal(platformMetricLabel('audience', 'youtube'), 'Subscribers');
  assert.equal(platformMetricLabel('audienceNetChange', 'youtube'), 'Subscribers Net Change');
  assert.equal(platformMetricLabel('audienceGrowthRate', 'youtube'), 'Subscriber Growth Rate');
  assert.equal(
    platformMetricLabel('engagementRateByFollower', 'youtube'),
    'Engagement Rate by Subscriber',
  );
});

test('Reddit uses community-member language for audience metrics', () => {
  assert.equal(platformAudienceNoun('reddit'), 'Members');
  assert.equal(platformAudienceNoun('reddit', false), 'Member');
  assert.equal(platformHandleLabel('reddit', 'boston'), 'r/boston');
  assert.equal(platformHandleLabel('reddit', 'r/boston'), 'r/boston');
  assert.equal(platformHandleLabel('reddit', 'u/bostonglobe'), 'u/bostonglobe');
  assert.equal(platformMetricLabel('audience', 'reddit'), 'Members');
  assert.equal(platformMetricLabel('audienceNetChange', 'reddit'), 'Members Net Change');
  assert.equal(platformMetricLabel('audienceGrowthRate', 'reddit'), 'Member Growth Rate');
  assert.equal(
    platformMetricLabel('engagementRateByFollower', 'reddit'),
    'Engagement Rate by Member',
  );
  assert.equal(platformMetricLabel('applause', 'reddit'), 'Score');
  assert.equal(platformMetricLabel('conversation', 'reddit'), 'Comments');
  assert.equal(platformMetricLabel('amplification', 'reddit'), 'Crossposts');
});

test('Reddit handles distinguish users from explicit and legacy subreddits', () => {
  assert.equal(classifyRedditHandle('u/bostonglobe'), 'user');
  assert.equal(classifyRedditHandle('U/BostonGlobe'), 'user');
  assert.equal(classifyRedditHandle('r/boston'), 'subreddit');
  assert.equal(classifyRedditHandle('boston'), 'subreddit');
});

test('Reddit handle lists report user, subreddit, mixed, or empty', () => {
  assert.equal(classifyRedditHandles([]), null);
  assert.equal(classifyRedditHandles(['u/one', 'U/two']), 'user');
  assert.equal(classifyRedditHandles(['r/boston', 'cambridge']), 'subreddit');
  assert.equal(classifyRedditHandles(['u/bostonglobe', 'r/boston']), 'mixed');
});

test('account-based platforms retain at-handle labels', () => {
  assert.equal(platformHandleLabel('instagram', 'bostonglobe'), '@bostonglobe');
  assert.equal(platformHandleLabel('twitter', '@BostonGlobe'), '@BostonGlobe');
});
