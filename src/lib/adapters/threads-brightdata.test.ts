import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mapThreadsPost } from './threads-brightdata';

describe('Bright Data Threads post mapping', () => {
  it('maps the live video payload to a playable video and poster', () => {
    const post = mapThreadsPost({
      post_id: 'DbnupqKGtuu',
      url: 'https://www.threads.com/@nesn/post/DbnupqKGtuu',
      post_time: '2026-08-04T14:00:48.000Z',
      profile_name: 'nesn',
      post_content: 'A behind-the-scenes look ✨',
      number_of_likes: 1,
      number_of_comments: 2,
      number_of_reshares: 3,
      number_of_shares: 4,
      images: ['https://scontent.example.cdninstagram.com/cover.jpg'],
      videos: ['https://scontent.example.cdninstagram.com/video.mp4'],
      videos_duration: [{
        video_url: 'https://scontent.example.cdninstagram.com/video.mp4',
        video_duration: 15,
      }],
      views: 124,
    });

    assert.ok(post);
    assert.equal(post.externalId, 'DbnupqKGtuu');
    assert.equal(post.type, 'video');
    assert.equal(post.thumbnailUrl, 'https://scontent.example.cdninstagram.com/cover.jpg');
    assert.equal(post.mediaUrl, 'https://scontent.example.cdninstagram.com/video.mp4');
    assert.equal(post.durationSec, 15);
    assert.equal(post.applause, 1);
    assert.equal(post.conversation, 2);
    assert.equal(post.amplification, 7);
    assert.equal(post.views, 124);
  });

  it('classifies multi-image posts as carousels', () => {
    const post = mapThreadsPost({
      post_id: 'carousel-code',
      post_time: '2026-08-04T14:00:48.000Z',
      images: [
        'https://scontent.example.cdninstagram.com/one.jpg',
        'https://scontent.example.cdninstagram.com/two.jpg',
      ],
    });

    assert.ok(post);
    assert.equal(post.type, 'carousel');
    assert.equal(post.mediaUrl, 'https://scontent.example.cdninstagram.com/one.jpg');
    assert.equal(post.thumbnailUrl, 'https://scontent.example.cdninstagram.com/one.jpg');
  });
});
