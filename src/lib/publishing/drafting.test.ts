import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractArticle, readJsonObject } from './article-extract';
import {
  DEFAULT_DRAFT_PROMPTS, buildDraftMessages, checkDraft, mergePrompts, readDrafts, textBudget, type DraftAccount,
} from './drafting-core';

const para = (n: number) => Array.from({ length: n }, (_, i) =>
  `<p>Paragraph ${i + 1} says the council voted 7-2 on Tuesday to approve a $4.5 million plan for new bike lanes downtown.</p>`).join('');

describe('extractArticle', () => {
  it('reads Arc globalContent, the full story behind the paywall', () => {
    const content = {
      headlines: { basic: 'Council backs bike lanes' },
      subheadlines: { basic: 'A 7-2 vote' },
      credits: { by: [{ name: 'Jane Reporter' }] },
      taxonomy: { primary_section: { name: 'Metro' } },
      first_publish_date: '2026-10-06T14:00:00Z',
      content_elements: [
        { type: 'text', content: 'The council voted <b>7-2</b> on Tuesday.' },
        { type: 'image', url: 'x' },
        { type: 'text', content: 'The plan costs $4.5 million &amp; adds 12 miles of lanes. ' + 'More detail follows. '.repeat(30) },
      ],
    };
    const html = `<html><head><meta property="og:title" content="Council backs bike lanes - The Boston Globe"></head>
      <script>Fusion.globalContent=${JSON.stringify(content)};Fusion.globalContentConfig={"a":1};</script></html>`;
    const a = extractArticle(html, 'https://www.bostonglobe.com/x');
    assert.equal(a.source, 'arc');
    assert.equal(a.title, 'Council backs bike lanes - The Boston Globe');
    assert.deepEqual(a.byline, ['Jane Reporter']);
    assert.equal(a.section, 'Metro');
    assert.match(a.text, /^The council voted 7-2 on Tuesday\.\n\nThe plan costs \$4\.5 million & adds 12 miles/);
  });

  it('prefers JSON-LD articleBody when a site publishes it', () => {
    const body = 'Full text from structured data. '.repeat(20);
    const html = `<script type="application/ld+json">${JSON.stringify({ '@graph': [{ '@type': 'WebPage' }, { '@type': 'NewsArticle', headline: 'H', articleBody: body, author: [{ name: 'A' }, { name: 'B' }] }] })}</script>${para(8)}`;
    const a = extractArticle(html, 'https://example.com/s');
    assert.equal(a.source, 'jsonld');
    assert.deepEqual(a.byline, ['A', 'B']);
  });

  it('falls back to the story paragraphs and drops newsletter boilerplate', () => {
    const html = `<nav><p>Manage your account and preferences across the site today please.</p></nav><article>${para(6)}
      <p>Get everything you need to know to start your day, delivered right to your inbox every morning.</p>
      <p>Short.</p></article>`;
    const a = extractArticle(html, 'https://www.boston.com/s');
    assert.equal(a.source, 'paragraphs');
    assert.doesNotMatch(a.text, /inbox|Manage your account/);
    assert.equal(a.text.split('\n\n').length, 6);
  });

  it('says so when only the summary is available', () => {
    const a = extractArticle('<meta name="description" content="Just a teaser.">', 'https://example.com/s');
    assert.equal(a.source, 'summary');
    assert.equal(a.text, 'Just a teaser.');
  });

  it('reads one JSON object and ignores the script after it', () => {
    assert.deepEqual(readJsonObject('x={"a":"}{","b":[1,{"c":2}]};y={}', 2), { a: '}{', b: [1, { c: 2 }] });
  });
});

describe('drafting prompts', () => {
  const article = { url: 'u', title: 'T', description: 'D', byline: [], section: null, publishedAt: null, image: null, text: 'Body', words: 1, source: 'arc' as const };
  const acct = (over: Partial<DraftAccount>): DraftAccount => ({ key: 'a1', targetId: 't', brand: 'Boston.com', platform: 'twitter', linkMode: 'text', sentLink: 'https://www.boston.com/a?utm_source=twitter', ...over });

  it('counts the link the sender will add against the limit', () => {
    assert.equal(textBudget(acct({})), 280 - 25, 'X: 23 for the link plus the blank line');
    assert.equal(textBudget(acct({ platform: 'bluesky', linkMode: 'card', sentLink: null })), 300);
  });

  it('names each account, its limit and how the link travels', () => {
    const [system, user] = buildDraftMessages(article, [acct({}), acct({ key: 'a2', platform: 'instagram', linkMode: 'none', sentLink: null })], DEFAULT_DRAFT_PROMPTS);
    assert.match(system.content, /X: one tight sentence/);
    assert.match(system.content, /Instagram: the caption/);
    assert.doesNotMatch(system.content, /LinkedIn:/, 'only the networks being drafted');
    assert.match(user.content, /a1: Boston\.com on X \(at most 255 characters; the link is added after your text automatically\)/);
    assert.match(user.content, /a2: Boston\.com on Instagram .*there is no clickable link/);
  });

  it('keeps defaults for fields an org left blank', () => {
    const p = mergePrompts({ house: '  ', platforms: { threads: 'Be brief.' } });
    assert.equal(p.house, DEFAULT_DRAFT_PROMPTS.house);
    assert.equal(p.platforms.threads, 'Be brief.');
    assert.equal(p.platforms.facebook, DEFAULT_DRAFT_PROMPTS.platforms.facebook);
  });

  it('only takes drafts for accounts that were asked for, once each', () => {
    const m = readDrafts({ posts: [{ account: 'a1', text: ' One ' }, { account: 'a1', text: 'dupe' }, { account: 'zz', text: 'made up' }, { account: 'a2', text: '' }] }, ['a1', 'a2']);
    assert.deepEqual([...m.entries()], [['a1', 'One']]);
    assert.equal(readDrafts('not json', ['a1']).size, 0);
  });
});

describe('checkDraft', () => {
  const story = 'HubSpot is laying off nearly 660 employees, about 7% of its workforce. "This is not driven by AI-related efficiencies," she wrote. It has 9,000 employees.';
  it('passes numbers and quotes that are in the story', () => {
    assert.deepEqual(checkDraft('HubSpot cuts 660 jobs, 7% of 9,000. “This is not driven by AI-related efficiencies,” the CEO said.', story, 280, 'twitter'), []);
  });
  it('flags a number the story does not have', () => {
    assert.deepEqual(checkDraft('HubSpot cuts 700 jobs.', story, 280, 'twitter'), ['“700” is not in the story. Check the number.']);
  });
  it('accepts a quote that ends with different punctuation than the story', () => {
    assert.deepEqual(checkDraft('Rangan: “This is not driven by AI-related efficiencies.”', story, 280, 'twitter'), []);
  });
  it('flags a quote that is not word for word', () => {
    const w = checkDraft('“This has nothing to do with AI at all,” she said.', story, 280, 'twitter');
    assert.equal(w.length, 1);
    assert.match(w[0], /not word for word/);
  });
  it('flags text over the budget', () => {
    assert.match(checkDraft('x'.repeat(300), story, 255, 'twitter')[0], /45 characters too long for X/);
  });
});
