import assert from 'node:assert/strict';
import test from 'node:test';
import { parseComment, COMMENTS_PER_POST } from './collect';

const POST_ID = '2b1e0a54-0000-4000-8000-000000000000';

test('a vendor record becomes a row, with the probed field names', () => {
  // Field names come from the 25 Aug probe against the live dataset, not from
  // the docs, whose response example uses different names than it delivers.
  const row = parseComment(POST_ID, {
    comment_id: '18125898121692075',
    comment_user: 'michaeljf617',
    comment_user_url: 'https://www.instagram.com/michaeljf617',
    comment_date: '2026-08-25T16:23:07.000Z',
    comment: 'Ahhh, the misleading spin.',
    likes_number: 3,
    replies_number: 1,
  });
  assert.ok(row);
  assert.equal(row.externalId, '18125898121692075');
  assert.equal(row.authorName, 'michaeljf617');
  assert.equal(row.text, 'Ahhh, the misleading spin.');
  assert.equal(row.likes, 3);
  assert.equal(row.replies, 1);
  assert.equal(row.commentedAt?.toISOString(), '2026-08-25T16:23:07.000Z');
});

test('a record with no stable id is dropped, not written with a blank key', () => {
  assert.equal(parseComment(POST_ID, { comment: 'hello' }), null);
  assert.equal(parseComment(POST_ID, { comment_id: '   ' }), null);
});

test('junk counts and dates degrade to zero and null, never NaN', () => {
  const row = parseComment(POST_ID, {
    comment_id: 'x1',
    likes_number: 'not a number',
    replies_number: -4,
    comment_date: 'yesterday-ish',
  });
  assert.ok(row);
  assert.equal(row.likes, 0);
  assert.equal(row.replies, 0);
  assert.equal(row.commentedAt, null);
});

test('a TikTok record parses through the same parser, with its probed field names', () => {
  // Field names from the 26 Aug probe against a live Boston 25 video, whose
  // top comment carried 2,953 likes. The two vendors' key sets do not collide.
  const row = parseComment(POST_ID, {
    comment_id: '7677727839420859149',
    commenter_user_name: 'Miss Nikki2.0',
    commenter_url: 'https://www.tiktok.com/@miss.nikki2.0',
    date_created: '2026-08-24T22:25:53.000Z',
    comment_text: 'Nope. The jury can’t UNHEAR it. Automatic mistrial',
    num_likes: 2953,
    num_replies: 21,
  });
  assert.ok(row);
  assert.equal(row.externalId, '7677727839420859149');
  assert.equal(row.authorName, 'Miss Nikki2.0');
  assert.equal(row.text, 'Nope. The jury can’t UNHEAR it. Automatic mistrial');
  assert.equal(row.likes, 2953);
  assert.equal(row.replies, 21);
  assert.equal(row.commentedAt?.toISOString(), '2026-08-24T22:25:53.000Z');
});

test('the per-post cap stays a real cap', () => {
  // 100 records per post is the sampling design and the cost model. If this
  // number changes, the daily budget in vendors/budget.ts moves with it.
  assert.equal(COMMENTS_PER_POST, 100);
});
