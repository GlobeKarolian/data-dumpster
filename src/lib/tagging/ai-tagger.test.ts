import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildTaggingMessages,
  nextRetryDelayMs,
  normalizeLabel,
  taxonomyFingerprint,
  validateAssignments,
  validateSuggestions,
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

describe('suggestion validation', () => {
  it('keeps plausible labels, drops unknown posts and echoes of existing tags', () => {
    const kept = validateSuggestions({
      suggestions: [
        { postId: 'p1', label: 'Karen Read' },
        { postId: 'p1', label: 'CRIME' },              // existing tag, case-insensitive
        { postId: 'p-unknown', label: 'Karen Read' },  // not a claimed post
        { postId: 'p2', label: '' },                   // empty
        { postId: 'p2', label: 'x'.repeat(60) },       // too long
      ],
    }, TAGS, POSTS);
    assert.deepEqual(kept, [{ postId: 'p1', label: 'Karen Read', labelNorm: 'karen read' }]);
  });

  it('caps suggestions per post and dedupes normalized labels', () => {
    const kept = validateSuggestions({
      suggestions: [
        { postId: 'p1', label: 'Karen Read' },
        { postId: 'p1', label: 'karen  read' },  // same after normalization
        { postId: 'p1', label: 'MBTA' },
        { postId: 'p1', label: 'Steward Health' },  // third distinct: over the cap
      ],
    }, TAGS, POSTS);
    assert.equal(kept.length, 2);
    assert.deepEqual(kept.map((s) => s.labelNorm), ['karen read', 'mbta']);
  });

  it('treats a malformed payload as zero suggestions, never as an exception', () => {
    assert.deepEqual(validateSuggestions(null, TAGS, POSTS), []);
    assert.deepEqual(validateSuggestions({ suggestions: 'x' }, TAGS, POSTS), []);
  });
});

describe('label normalization', () => {
  it('ignores case, spacing and trivial punctuation', () => {
    assert.equal(normalizeLabel('  Karen   Read! '), 'karen read');
    assert.equal(normalizeLabel('“MBTA”'), 'mbta');
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

  it('demands the full stack: general categories AND specific topics together', () => {
    const [system] = buildTaggingMessages(TAGS, POSTS);
    assert.match(system.content, /EVERY tag whose definition fits/);
    assert.match(system.content, /never replace their general category/);
  });

  it('asks for suggestions only where the taxonomy has no word', () => {
    const [system] = buildTaggingMessages(TAGS, POSTS);
    assert.match(system.content, /NO adequate tag/);
    assert.match(system.content, /At most 2 per post/);
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
