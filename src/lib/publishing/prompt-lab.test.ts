import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { verifyNumbersAgainstMaterial } from '@/lib/ai/verify';
import { FEATURES, buildFactSheet, buildLabMessages, pickExamples, readSuggestion, renderFactSheet, splitByLift, visibleLength, type LabPost } from './prompt-lab-core';

const post = (i: number, over: Partial<LabPost> = {}): LabPost => ({ company: `Outlet ${i % 5}`, type: 'link', text: `Story number ${i} about the city council`, engagement: i, lift: i / 100, ...over });

describe('prompt lab', () => {
  it('compares the top tenth with the middle half', () => {
    const posts = Array.from({ length: 200 }, (_, i) => post(i));
    const { top, typical } = splitByLift(posts);
    assert.equal(top.length, 20);
    assert.equal(typical.length, 100);
    assert.ok(top.every((p) => p.lift >= 1.8));
    assert.ok(typical.every((p) => p.lift < 1.5 && p.lift >= 0.5));
  });

  it('measures patterns in code, top against typical', () => {
    const posts = Array.from({ length: 200 }, (_, i) => post(i, { text: i >= 180 ? 'Who wins the mayor\'s race? Here is what 3 polls say.' : 'The council met Tuesday to discuss the budget for next year.' }));
    const f = buildFactSheet('threads', 180, posts);
    const q = f.features.find((x) => x.key === 'question')!;
    assert.deepEqual([q.topPct, q.typicalPct], [100, 0]);
    assert.equal(f.accounts, 5);
    const text = renderFactSheet(f);
    assert.match(text, /asks a question: 100% vs 0%/);
    assert.match(text, /the best 10% by lift, 20 posts/);
  });

  it('counts what a reader sees, not links or a trailing hashtag block', () => {
    assert.equal(visibleLength('Big win https://bos.co/x #RedSox #MLB'), 7);
  });

  it('feature tests are stateless (no shared regex state)', () => {
    const link = FEATURES.find((f) => f.key === 'link')!;
    assert.equal(link.test('see https://a.co/x'), true);
    assert.equal(link.test('see https://a.co/x'), true);
  });

  it('keeps any one outlet from dominating the examples', () => {
    const posts = Array.from({ length: 30 }, (_, i) => post(i, { company: i < 20 ? 'Big' : `Small ${i}` }));
    const ex = pickExamples(posts, 10, 3);
    assert.equal(ex.filter((p) => p.company === 'Big').length, 3);
  });

  it('asks for a network-labeled instruction grounded in the measurements', () => {
    const f = buildFactSheet('bluesky', 90, Array.from({ length: 200 }, (_, i) => post(i)));
    const [system, user] = buildLabMessages(f, [post(1)], [post(2)], 'Bluesky: old.', 'House rules here.');
    assert.match(system.content, /house rules always win/i);
    assert.match(system.content, /not clicks/);
    assert.match(user.content, /<measurements>/);
    assert.match(user.content, /Start with "Bluesky:"/);
    assert.equal(readSuggestion({ prompt: 'Lead with the fact in one sentence.', reasons: [] }, 'bluesky')!.prompt, 'Bluesky: Lead with the fact in one sentence.');
    assert.equal(readSuggestion({ prompt: 'short' }, 'bluesky'), null);
  });

  it('drops a reason whose numbers are not in the measurements', () => {
    const f = buildFactSheet('threads', 180, Array.from({ length: 200 }, (_, i) => post(i, { text: i >= 180 ? 'Who won? 3 things.' : 'The council met to discuss the budget.' })));
    const material = renderFactSheet(f);
    assert.equal(verifyNumbersAgainstMaterial('Top posts asked a question 100% of the time vs 0% of typical posts.', material).ok, true);
    assert.equal(verifyNumbersAgainstMaterial('Questions lift engagement by 47%.', material).ok, false);
  });
});
