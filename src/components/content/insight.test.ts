import assert from 'node:assert/strict';
import test from 'node:test';
import type { ContentAnalysis } from '@/lib/metrics/content-analysis';
import {
  channelsInsight,
  hashtagsInsight,
  timesInsight,
  topicsInsight,
  typesInsight,
} from './insight';

const analysis: ContentAnalysis = {
  days: 10,
  focusCompanyName: 'Competitor News',
  totalPosts: 20,
  activity: [],
  activityByDay: [],
  glance: {
    postsPerDay: 2,
    landscapePostsPerDay: 4,
    engagementRateByFollower: 0.01,
    landscapeEngagementRate: 0.02,
    engagementPerPost: 200,
    landscapeEngagementPerPost: 100,
    pctWithHashtags: 0.5,
    landscapePctWithHashtags: 0.4,
    topHour: 9,
    landscapeTopHour: 10,
  },
  topics: [{
    key: 'local news',
    companies: 2,
    posts: 12,
    engagementRateByFollower: 0.02,
    engagementPerPost: 10,
    focusUsed: true,
    focusPosts: 3,
  }],
  hashtags: [{
    key: '#boston',
    companies: 2,
    posts: 12,
    engagementRateByFollower: 0.02,
    engagementPerPost: 10,
    focusUsed: false,
    focusPosts: 0,
  }],
  postTypes: [{
    key: 'video',
    companies: 2,
    posts: 12,
    engagementRateByFollower: 0.02,
    engagementPerPost: 10,
    focusUsed: true,
    focusPosts: 3,
  }],
  channels: [{
    key: 'youtube',
    companies: 2,
    posts: 12,
    engagementRateByFollower: 0.02,
    engagementPerPost: 10,
    focusUsed: true,
    focusPosts: 3,
  }],
  byHour: Array.from({ length: 24 }, (_, bucket) => ({
    bucket,
    focusPosts: bucket === 8 ? 4 : 0,
    focusRate: bucket === 9 ? 0.02 : 0,
    focusEngagementPerPost: bucket === 9 ? 200 : 0,
    landscapePosts: 1,
    landscapeRate: 0.01,
    landscapeEngagementPerPost: 100,
  })),
  byWeekday: [],
};

test('content insights name a selected competitor instead of calling it you or yours', () => {
  const copy = [
    topicsInsight(analysis, 'Competitor News'),
    hashtagsInsight(analysis, 'Competitor News'),
    typesInsight(analysis, 'Competitor News'),
    channelsInsight(analysis, 'Competitor News'),
    timesInsight(analysis.byHour, analysis.glance.topHour, 'Competitor News'),
  ].join(' ');

  assert.match(copy, /Competitor News/);
  assert.doesNotMatch(copy, /\b(?:you|your|yours)\b/i);
});
