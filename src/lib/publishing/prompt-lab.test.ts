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
    const [system, user] = buildLabMessages(f, renderFactSheet(f), [post(1)], [post(2)], 'Bluesky: old.', 'House rules here.');
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

import { fitModel, renderModel, ridge, solveSpd, spearman } from './prompt-lab-model';

/** Deterministic noise so the statistics tests never flake. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());

describe('prompt lab model', () => {
  it('solves small systems and ranks', () => {
    assert.deepEqual(solveSpd([[4, 2], [2, 3]], [2, 1])!.map((x) => Math.round(x * 1000) / 1000), [0.5, 0]);
    assert.equal(spearman([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [2, 4, 6, 8, 10, 12, 14, 16, 18, 20]), 1);
    const r = rng(1);
    const X = Array.from({ length: 500 }, () => [1, r() < 0.5 ? 1 : 0]);
    const fit = ridge(X, X.map((row) => 0.5 + 0.3 * row[1] + 0.05 * gauss(r)))!;
    assert.ok(Math.abs(fit.beta[1] - 0.3) < 0.02);
  });

  it('holds topic fixed: short breaking posts do not make "short" look like a winner', () => {
    const r = rng(7);
    const posts: LabPost[] = Array.from({ length: 3000 }, (_, i) => {
      const breaking = r() < 0.4;
      const question = r() < 0.3;
      const text = (breaking ? 'Crash closes I-93 near Medford' : 'The city council spent a long evening debating the new budget for parks, schools and roads in the next year')
        + (question ? ' What should the city do?' : ' Officials said more is coming.');
      const lift = Math.exp((breaking ? Math.log(2) : 0) + (question ? Math.log(1.3) : 0) + 0.4 * gauss(r));
      return { company: `Outlet ${i % 6}`, type: 'link', text, engagement: 1, lift, hour: 12, tags: breaking ? ['Breaking'] : ['Politics'] };
    });
    const m = fitModel(posts);
    const q = m.controlled!.effects.find((e) => e.key === 'question')!;
    assert.ok(q.clear && q.effectPct >= 20 && q.effectPct <= 40, `question ${q.effectPct}%`);
    const short = m.controlled!.effects.find((e) => e.key === 'len_short');
    assert.ok(!short || !short.clear || Math.abs(short.effectPct) < 15, `short ${short?.effectPct}%`);
    assert.ok(m.controls.some((c) => c.startsWith('topic')));
    assert.ok((m.controlled!.holdoutRank ?? 0) > 0.3);
    assert.match(renderModel(m), /asks a question: \+\d+% \(90% range/);
  });

  it('compares wording within the same story', () => {
    const r = rng(11);
    const posts: LabPost[] = [];
    for (let s = 0; s < 150; s++) {
      const news = 0.9 * gauss(r); // stories differ a lot in news value
      for (let k = 0; k < 3; k++) {
        const question = k === 0;
        posts.push({ company: 'Globe', type: 'link', story: `https://x.com/story-${s}`, hour: Math.floor(r() * 24),
          text: `Story ${s} update with some detail${question ? '. Is this the right call?' : '.'}`,
          engagement: 1, lift: Math.exp(news + (question ? Math.log(1.5) : 0) + 0.2 * gauss(r)) });
      }
    }
    const m = fitModel(posts);
    assert.equal(m.sameStory!.stories, 150);
    const q = m.sameStory!.effects.find((e) => e.key === 'question')!;
    assert.ok(q.clear && q.effectPct >= 35 && q.effectPct <= 65, `question within story ${q.effectPct}%`);
  });

  it('says nothing when there are too few posts', () => {
    const m = fitModel(Array.from({ length: 50 }, (_, i) => post(i)));
    assert.equal(m.controlled, null);
    assert.equal(m.sameStory, null);
    assert.equal(renderModel(m), '');
  });
});
