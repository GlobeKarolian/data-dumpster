import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { countsAsVideoView, videoViewsByCompany } from './video-views';

describe('video views', () => {
  it('counts plays of video posts on play-count platforms only', () => {
    assert.equal(countsAsVideoView('tiktok', 'video'), true);
    assert.equal(countsAsVideoView('instagram', 'reel'), true);
    assert.equal(countsAsVideoView('youtube', 'short'), true);
    assert.equal(countsAsVideoView('facebook', 'live'), true);
    assert.equal(countsAsVideoView('twitter', 'video'), false, 'X reports impressions, not plays');
    assert.equal(countsAsVideoView('threads', 'video'), false, 'Threads reports post views');
    assert.equal(countsAsVideoView('facebook', 'photo'), false);
  });

  it('keeps an X impression spike out of a brand total', () => {
    const totals = videoViewsByCompany([
      { company_id: 'globe', platform: 'tiktok', views: '2234360' },
      { company_id: 'globe', platform: 'twitter', views: 34_703_184 },
      { company_id: 'globe', platform: 'youtube', views: 207_441 },
      { company_id: 'globe', platform: 'facebook', views: null },
    ]);
    assert.deepEqual(totals.get('globe'), { total: 2_441_801, byPlatform: { tiktok: 2_234_360, youtube: 207_441 } });
  });
});
