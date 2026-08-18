import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildTaggingMessages,
  nextRetryDelayMs,
  taxonomyFingerprint,
  validateAssignments,
} from './ai-tagger';

const TAGS = [
  { id: 't-crime', name: 'Crime', aiPrompt: 'Crime, courts, police activity in Greater Boston.', landscapeIds: [] },
  { id: 't-clancy', name: 'Clancy trial', aiPrompt: 'The Lindsay Clancy murder trial specifically.', landscapeIds: [] },
];
const POSTS = [
  { id: 'p1', platform: 'twitter', type: 'link', text: 'Clancy trial day 4', hashtags: [], urls: [] },
  { id: 'p2', platform: 'tiktok', type: 'video', text: 'Best beaches near Boston', hashtags: ['#summer'], urls: [] },
];

describe('taxonomy fingerprint', () => {
  it('moves when a definition is edited, which is the recompute trigger', () => {
    const before = taxonomyFingerprint(TAGS);
    const edited = taxonomyFingerprint([
      TAGS[0],
      { ...TAGS[1], aiPrompt: 'The Clancy trial, including verdict reactions.' },
    ]);
    assert.notEqual(before, edited);
  });

  it('ignores ordering, so a stable taxonomy never looks changed', () => {
    assert.equal(taxonomyFingerprint(TAGS), taxonomyFingerprint([TAGS[1], TAGS[0]]));
  });
});

describe('assignment validation', () => {
  it('drops invented tag and post ids instead of writing them', () => {
    const { assignments, dropped } = validateAssignments({
      assignments: [
        { postId: 'p1', tagId: 't-clancy', confidence: 0.95 },
        { postId: 'p1', tagId: 't-made-up', confidence: 0.9 },
        { postId: 'p-unknown', tagId: 't-crime', confidence: 0.9 },
      ],
    }, TAGS, POSTS);
    assert.deepEqual(assignments, [{ postId: 'p1', tagId: 't-clancy', confidence: 0.95 }]);
    assert.equal(dropped, 2);
  });

  it('clamps confidence into [0,1] and keeps the strongest duplicate', () => {
    const { assignments } = validateAssignments({
      assignments: [
        { postId: 'p1', tagId: 't-crime', confidence: 3 },
        { postId: 'p1', tagId: 't-crime', confidence: 0.4 },
      ],
    }, TAGS, POSTS);
    assert.deepEqual(assignments, [{ postId: 'p1', tagId: 't-crime', confidence: 1 }]);
  });

  it('treats a malformed payload as zero assignments, never as an exception', () => {
    assert.deepEqual(validateAssignments(null, TAGS, POSTS), { assignments: [], dropped: 0 });
    assert.deepEqual(validateAssignments({ assignments: 'x' }, TAGS, POSTS), { assignments: [], dropped: 0 });
  });
});

describe('prompt build', () => {
  it('carries every tag definition and every post id', () => {
    const [system, user] = buildTaggingMessages(TAGS, POSTS);
    assert.match(system.content, /t-crime/);
    assert.match(system.content, /Clancy murder trial/);
    assert.match(user.content, /POST p1/);
    assert.match(user.content, /POST p2/);
  });

  it('never lets a single post flood the prompt', () => {
    const [, user] = buildTaggingMessages(TAGS, [{
      id: 'p3', platform: 'reddit', type: 'text', text: 'x'.repeat(100_000), hashtags: [], urls: [],
    }]);
    assert.ok(user.content.length < 3_000);
  });
});

describe('retry backoff', () => {
  it('doubles from ten minutes and caps at a day', () => {
    assert.equal(nextRetryDelayMs(1), 10 * 60_000);
    assert.equal(nextRetryDelayMs(2), 20 * 60_000);
    assert.equal(nextRetryDelayMs(10), 24 * 3_600_000);
  });
});
