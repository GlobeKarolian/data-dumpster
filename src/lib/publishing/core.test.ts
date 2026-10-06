import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyUtm } from './utm';
import { zonedParts, zonedToUtc, localDayKey } from './zone';
import { pickSlot, type PostingRule } from './slots';
import { buildHourWeights } from './performance';
import { parseFeed, renderTemplate } from './rss';
import { chargedLength, finalText, linkModeFor } from './platforms';

const ctx = (platform: 'facebook' | 'threads' | 'bluesky') => ({
  platform, brand: 'Boston.com', postRef: 'p1', origin: 'manual', date: new Date('2026-10-06T12:00:00Z'),
});

describe('utm', () => {
  it('tags each platform differently from one link', () => {
    const fb = new URL(applyUtm('https://www.boston.com/news/a', null, ctx('facebook')));
    const bs = new URL(applyUtm('https://www.boston.com/news/a', null, ctx('bluesky')));
    assert.equal(fb.searchParams.get('utm_source'), 'facebook');
    assert.equal(bs.searchParams.get('utm_source'), 'bluesky');
    assert.equal(fb.searchParams.get('utm_campaign'), 'boston-com');
    assert.equal(fb.searchParams.get('utm_content'), 'p1');
  });
  it('never overwrites a UTM the editor typed', () => {
    const u = new URL(applyUtm('https://x.com/a?utm_campaign=election', { campaign: 'auto' }, ctx('threads')));
    assert.equal(u.searchParams.get('utm_campaign'), 'election');
  });
  it('leaves junk untouched', () => {
    assert.equal(applyUtm('not a url', null, ctx('threads')), 'not a url');
  });
});

describe('zone', () => {
  it('reads Boston wall clock across DST', () => {
    const summer = zonedParts(new Date('2026-07-01T23:30:00Z'));
    assert.equal(summer.minute, 19 * 60 + 30);
    const winter = zonedParts(new Date('2026-12-01T23:30:00Z'));
    assert.equal(winter.minute, 18 * 60 + 30);
  });
  it('round-trips a local time to UTC', () => {
    assert.equal(zonedToUtc(2026, 10, 6, 18 * 60).toISOString(), '2026-10-06T22:00:00.000Z');
    assert.equal(zonedToUtc(2026, 11, 2, 9 * 60).toISOString(), '2026-11-02T14:00:00.000Z');
    assert.equal(localDayKey(new Date('2026-10-07T03:00:00Z')), '2026-10-06');
  });
});

describe('pickSlot', () => {
  // Tuesday 6 Oct 2026, Boston time.
  const now = zonedToUtc(2026, 10, 6, 12 * 60);
  const evenings: PostingRule[] = [{ weekday: 2, startMinute: 17 * 60, endMinute: 22 * 60 }];

  it('stays inside day-parting rules', () => {
    const r = pickSlot({
      windowStart: now, windowEnd: zonedToUtc(2026, 10, 6, 23 * 60), now,
      policy: { rules: evenings, minGapMinutes: 30, maxPerDay: null }, taken: [], weights: null,
    });
    assert.ok(r.ok);
    assert.equal(zonedParts(r.pick.at).minute, 17 * 60);
  });

  it('follows the account’s strongest hour', () => {
    const weights = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 1));
    weights[2][20] = 1.6;
    const r = pickSlot({
      windowStart: now, windowEnd: zonedToUtc(2026, 10, 6, 23 * 60), now,
      policy: { rules: evenings, minGapMinutes: 30, maxPerDay: null }, taken: [], weights,
    });
    assert.ok(r.ok);
    assert.equal(Math.floor(zonedParts(r.pick.at).minute / 60), 20);
    assert.match(r.pick.reason, /1\.6x/);
  });

  it('keeps the minimum gap from queued posts', () => {
    const taken = [zonedToUtc(2026, 10, 6, 17 * 60)];
    const r = pickSlot({
      windowStart: now, windowEnd: zonedToUtc(2026, 10, 6, 18 * 60), now,
      policy: { rules: evenings, minGapMinutes: 45, maxPerDay: null }, taken, weights: null,
    });
    assert.ok(r.ok);
    assert.ok(r.pick.at.getTime() - taken[0].getTime() >= 45 * 60000);
  });

  it('explains why nothing fits', () => {
    const r = pickSlot({
      windowStart: now, windowEnd: zonedToUtc(2026, 10, 6, 15 * 60), now,
      policy: { rules: evenings, minGapMinutes: 30, maxPerDay: null }, taken: [], weights: null,
    });
    assert.equal(r.ok, false);
  });

  it('respects the daily cap', () => {
    const taken = [zonedToUtc(2026, 10, 6, 13 * 60), zonedToUtc(2026, 10, 6, 14 * 60)];
    const r = pickSlot({
      windowStart: now, windowEnd: zonedToUtc(2026, 10, 6, 23 * 60), now,
      policy: { rules: [], minGapMinutes: 0, maxPerDay: 2 }, taken, weights: null,
    });
    assert.equal(r.ok, false);
  });
});

describe('buildHourWeights', () => {
  it('needs enough history and shrinks thin cells', () => {
    assert.equal(buildHourWeights([{ weekday: 1, hour: 9, rate: 0.01 }]), null);
    const samples = Array.from({ length: 60 }, (_, i) => ({ weekday: i % 7, hour: 9, rate: 0.01 }));
    samples.push({ weekday: 3, hour: 3, rate: 5 }); // one viral 3am post
    const w = buildHourWeights(samples)!;
    assert.ok(w[3][3] < 2, 'a single outlier must not dominate');
    assert.equal(w[1][9], 1);
  });
});

describe('rss', () => {
  const xml = `<?xml version="1.0"?><rss><channel>
    <item><title><![CDATA[Red Sox &amp; the playoffs]]></title><link>https://www.boston.com/sports/a</link>
      <guid isPermaLink="false">wp-123</guid><description><![CDATA[<p>Big night at Fenway.</p>]]></description>
      <pubDate>Tue, 06 Oct 2026 14:00:00 +0000</pubDate><category>Sports</category>
      <media:content url="https://img/a.jpg" medium="image"/></item>
  </channel></rss>`;
  it('parses WordPress items', () => {
    const [item] = parseFeed(xml);
    assert.equal(item.title, 'Red Sox & the playoffs');
    assert.equal(item.guid, 'wp-123');
    assert.equal(item.description, 'Big night at Fenway.');
    assert.equal(item.image, 'https://img/a.jpg');
    assert.deepEqual(item.categories, ['Sports']);
  });
  it('renders and trims per-platform copy', () => {
    const [item] = parseFeed(xml);
    assert.equal(renderTemplate('{title}: {description}', item, 300), 'Red Sox & the playoffs: Big night at Fenway.');
    assert.equal([...renderTemplate('{title} {description}', item, 10)].length, 10);
  });
});

describe('platform text', () => {
  it('keeps the URL out of Bluesky text when sent as a card', () => {
    const mode = linkModeFor('bluesky', 'bluesky');
    assert.equal(finalText('Hello', 'https://b.com/x', mode), 'Hello');
    assert.equal(finalText('Hello', 'https://b.com/x', linkModeFor('threads', 'ayrshare')), 'Hello\n\nhttps://b.com/x');
  });
  it('charges X 23 characters for any link', () => {
    assert.equal(chargedLength('twitter', 'a https://www.boston.com/very/long/path?utm_source=twitter'), 25);
  });
});
