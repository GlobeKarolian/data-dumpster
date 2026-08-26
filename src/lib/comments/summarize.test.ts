import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCommentSummaryMessages, validateCommentSummary,
  MAX_COMMENTS_PER_SUMMARY, MIN_COMMENTS_FOR_SUMMARY,
} from './summarize';

test('the prompt carries likes, because likes are audience agreement', () => {
  const messages = buildCommentSummaryMessages({
    company: 'WCVB',
    postText: 'Lindsay Clancy\'s defense sought a mistrial today.',
    comments: [
      { text: 'It should be a mistrial.', likes: 339 },
      { text: 'Moving in the shadows', likes: 208 },
    ],
  });
  const user = messages.find((m) => m.role === 'user');
  assert.ok(user);
  assert.match(user.content, /\[339 likes\] It should be a mistrial\./);
  assert.match(user.content, /\[208 likes\] Moving in the shadows/);
  assert.match(user.content, /WCVB/);
});

test('the prompt is bounded: comment count and per-comment length both cap', () => {
  const messages = buildCommentSummaryMessages({
    company: 'X',
    postText: 'p',
    comments: Array.from({ length: 500 }, (_, i) => ({
      text: 'c'.repeat(5_000),
      likes: 500 - i,
    })),
  });
  const user = messages.find((m) => m.role === 'user');
  assert.ok(user);
  const lines = user.content.split('\n').filter((l) => l.startsWith('['));
  assert.equal(lines.length, MAX_COMMENTS_PER_SUMMARY);
  assert.ok(lines.every((l) => l.length < 300), 'each comment line must be truncated');
});

test('the system prompt forbids adopting commenter claims as fact', () => {
  const messages = buildCommentSummaryMessages({ company: 'X', postText: 'p', comments: [] });
  const system = messages.find((m) => m.role === 'system');
  assert.ok(system);
  assert.match(system.content, /Never adopt a claim as fact/);
});

test('a summary outside glanceable bounds is rejected, not displayed', () => {
  assert.equal(validateCommentSummary({ summary: 'Too short.' }), null);
  assert.equal(validateCommentSummary({ summary: 'x'.repeat(800) }), null);
  assert.equal(validateCommentSummary({ nope: true }), null);
  assert.equal(validateCommentSummary(null), null);
  const good = 'Most commenters argue the trial has been mishandled and side with the defense, '
    + 'while a sizable minority push back that the children are the only victims.';
  assert.equal(validateCommentSummary({ summary: good }), good);
});

test('the thresholds themselves stay put', () => {
  // The cost model and the "silence beats padding" rule both hang off these.
  assert.equal(MAX_COMMENTS_PER_SUMMARY, 80);
  assert.equal(MIN_COMMENTS_FOR_SUMMARY, 5);
});
