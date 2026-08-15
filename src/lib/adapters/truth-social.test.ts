import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mapTruthSocialPost, parseTruthSocialHandle } from './truth-social';

describe('Truth Social Apify adapter', () => {
  it('parses public profile URLs and handles', () => {
    assert.equal(parseTruthSocialHandle('https://truthsocial.com/@Candidate_2028'), 'Candidate_2028');
    assert.equal(parseTruthSocialHandle('@Candidate_2028'), 'Candidate_2028');
    assert.throws(() => parseTruthSocialHandle('https://example.com/not-truth'), /usernames may contain/i);
  });

  it('maps the observed actor post shape without inventing unsupported metrics', () => {
    const post = mapTruthSocialPost({
      id: '117097120864035725',
      type: 'post',
      accountId: '107780257626128497',
      username: 'candidate',
      createdAt: '2026-08-14T12:30:00.000Z',
      url: 'https://truthsocial.com/@candidate/117097120864035725',
      content: 'Campaign update #Massachusetts https://example.com/plan',
      language: 'en',
      mediaAttachments: [{ type: 'image', url: 'https://cdn.example.com/full.jpg', previewUrl: 'https://cdn.example.com/small.jpg' }],
      repliesCount: 19,
      reblogsCount: 31,
      favouritesCount: 251,
      sensitive: false,
      pinned: false,
      visibility: 'public',
    });

    assert.ok(post);
    assert.equal(post.type, 'photo');
    assert.equal(post.applause, 251);
    assert.equal(post.conversation, 19);
    assert.equal(post.amplification, 31);
    assert.equal(post.saves, 0);
    assert.equal(post.views, 0);
    assert.equal(post.thumbnailUrl, 'https://cdn.example.com/small.jpg');
    assert.deepEqual(post.hashtags, ['massachusetts']);
    assert.deepEqual(post.urls, ['https://example.com/plan']);
  });
});
