import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildWeekHeadlines, type WeekHeadlineInput } from './week-headline';
import type { MetricRow } from '@/lib/types';
import type { PostDto } from './contract';

const company = (id: string, name: string) => ({
  id, name, slug: id, logoUrl: null, color: null, segment: null,
});

// `rank` is the engine's ranking over every row including incomplete ones.
// The headline deliberately re-ranks over measured rows only, so these
// fixtures carry a rank that the logic under test is expected to ignore.
const row = (id: string, name: string, value: number, extra: Partial<MetricRow> = {}): MetricRow => ({
  company: company(id, name), value, available: true, complete: true, rank: 0, ...extra,
});

const post = (over: Partial<PostDto> & { id: string; companyName: string }): PostDto => ({
  id: over.id,
  company: company(over.id + '-c', over.companyName),
  platform: 'facebook',
  type: 'link',
  postedAt: '2026-08-17T12:00:00Z',
  text: over.text ?? null,
  permalink: over.permalink ?? null,
  thumbnailUrl: null,
  applause: 0, conversation: 0, amplification: 0, saves: 0, views: 0,
  engagementTotal: over.engagementTotal ?? 0,
  engagementRateByFollower: 0,
  followersAtPost: null,
  tags: over.tags ?? [],
  urls: [],
  medianEngagement: 100,
  outlierScore: over.outlierScore ?? null,
});

const base: WeekHeadlineInput = {
  focusCompanyId: 'globe',
  focusName: 'The Boston Globe',
  engagement: [
    row('b25', 'Boston 25 News', 90_000),
    row('globe', 'The Boston Globe', 52_000),
    row('cbs', 'CBS Boston', 71_000),
    row('wcvb', 'WCVB', 30_000),
  ],
  topPosts: [],
  days: 7,
};

describe('standing', () => {
  it('states the focus brand’s rank among measured brands', () => {
    const [finding] = buildWeekHeadlines(base);
    assert.equal(finding.kind, 'standing');
    assert.match(finding.text, /ranks 3rd of 4 on engagement/);
    assert.match(finding.text, /Boston 25 News leads/);
    assert.equal(finding.figure, '52k engagement');
  });

  it('names the runner-up when the focus brand is first', () => {
    const [finding] = buildWeekHeadlines({
      ...base,
      focusCompanyId: 'b25',
      focusName: 'Boston 25 News',
    });
    assert.match(finding.text, /leads the market on engagement, ahead of CBS Boston/);
  });

  it('excludes incomplete brands from the field rather than ranking them', () => {
    const [finding] = buildWeekHeadlines({
      ...base,
      engagement: [
        row('b25', 'Boston 25 News', 90_000, { complete: false }),
        row('globe', 'The Boston Globe', 52_000),
        row('cbs', 'CBS Boston', 71_000),
        row('wcvb', 'WCVB', 30_000),
      ],
    });
    // Boston 25 is half-collected, so the field is three and the Globe is 2nd.
    assert.match(finding.text, /ranks 2nd of 3/);
    assert.match(finding.text, /CBS Boston leads/);
  });

  it('claims no standing when the focus brand itself was not measured', () => {
    const findings = buildWeekHeadlines({
      ...base,
      engagement: base.engagement.map((r) =>
        (r.company.id === 'globe' ? { ...r, available: false } : r)),
    });
    assert.equal(findings.find((f) => f.kind === 'standing'), undefined);
  });

  it('claims no standing on a field too small to be a ranking', () => {
    const findings = buildWeekHeadlines({
      ...base,
      engagement: [row('globe', 'The Boston Globe', 52_000), row('cbs', 'CBS Boston', 71_000)],
    });
    assert.equal(findings.find((f) => f.kind === 'standing'), undefined);
  });
});

describe('breakout', () => {
  it('picks the post that most beat its own publisher’s norm, not the biggest brand', () => {
    const findings = buildWeekHeadlines({
      ...base,
      topPosts: [
        post({ id: 'a', companyName: 'The Boston Globe', engagementTotal: 40_000, outlierScore: 2 }),
        post({
          id: 'b', companyName: 'Boston 25 News', engagementTotal: 10_000, outlierScore: 19.2,
          text: 'WATCH LIVE: Day 14 of Lindsay Clancy murder trial',
        }),
      ],
    });
    const breakout = findings.find((f) => f.kind === 'breakout');
    assert.ok(breakout);
    assert.match(breakout.text, /Boston 25 News had the week's breakout/);
    assert.match(breakout.text, /WATCH LIVE: Day 14 of Lindsay Clancy murder trial/);
    assert.equal(breakout.figure, '19× their normal, 10k engagement');
  });

  it('stays silent when nothing meaningfully outperformed', () => {
    const findings = buildWeekHeadlines({
      ...base,
      topPosts: [post({ id: 'a', companyName: 'WCVB', engagementTotal: 900, outlierScore: 1.4 })],
    });
    assert.equal(findings.find((f) => f.kind === 'breakout'), undefined);
  });
});

describe('story', () => {
  it('weights tags by the engagement they earned, not by post count', () => {
    const clancy = { id: 't-clancy', name: 'Lindsay Clancy', color: null };
    const weather = { id: 't-weather', name: 'Weather', color: null };
    const findings = buildWeekHeadlines({
      ...base,
      topPosts: [
        post({ id: 'a', companyName: 'CBS Boston', engagementTotal: 10_000, tags: [clancy] }),
        post({ id: 'b', companyName: 'WCVB', engagementTotal: 9_000, tags: [clancy] }),
        post({ id: 'c', companyName: 'WHDH', engagementTotal: 300, tags: [weather] }),
        post({ id: 'd', companyName: 'WBZ', engagementTotal: 200, tags: [weather] }),
        post({ id: 'e', companyName: 'NBC10', engagementTotal: 100, tags: [weather] }),
      ],
    });
    const story = findings.find((f) => f.kind === 'story');
    assert.ok(story);
    assert.match(story.text, /biggest story was Lindsay Clancy, across 2 of the top posts/);
    assert.equal(story.figure, '19k engagement');
    assert.equal(story.href, '/posts?tags=t-clancy');
  });

  it('carries the viewer’s scope onto the link', () => {
    const tag = { id: 't1', name: 'Politics', color: null };
    const findings = buildWeekHeadlines({
      ...base,
      scopeQuery: 'landscape=abc&range=7d',
      topPosts: [
        post({ id: 'a', companyName: 'CBS Boston', engagementTotal: 10, tags: [tag] }),
        post({ id: 'b', companyName: 'WCVB', engagementTotal: 10, tags: [tag] }),
      ],
    });
    assert.equal(findings.find((f) => f.kind === 'story')?.href,
      '/posts?tags=t1&landscape=abc&range=7d');
  });

  it('does not call a single tagged post the week’s story', () => {
    const findings = buildWeekHeadlines({
      ...base,
      topPosts: [post({
        id: 'a', companyName: 'CBS Boston', engagementTotal: 10_000,
        tags: [{ id: 't1', name: 'Crime & Courts', color: null }],
      })],
    });
    assert.equal(findings.find((f) => f.kind === 'story'), undefined);
  });
});

describe('the block as a whole', () => {
  it('produces nothing rather than padding a thin window', () => {
    assert.deepEqual(buildWeekHeadlines({
      focusCompanyId: null, focusName: 'x', engagement: [], topPosts: [], days: 7,
    }), []);
  });
});
