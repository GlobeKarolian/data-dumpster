/**
 * The fixture is synthetic but structurally faithful: BOM, quoted header
 * comment, several stacked tables, two-row headers of differing widths, an ISP
 * "Domain" section, and period rows that do not sum to the total. Real Globe
 * analytics are deliberately not committed here.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseAdobeFreeform } from './adobe-freeform';
import { rollUpReferrals } from './referral-platforms';
import { importAdobeFreeform } from './freeform-import';

const FIXTURE = '﻿'
  + '#=================================================================\n'
  + '# Freeform\n'
  + '# Report suite: Bostonglobe.com\n'
  + '"# Date: Jul 27, 2026 - Aug 2, 2026"\n'
  + '#=================================================================\n'
  + '\n'
  + '##############################################\n'
  + '# Freeform table (4)\n'
  + '##############################################\n'
  + ',,Visits,Visits,Visits,BG Digital Subscriptions (Visit)\n'
  + ',,Visits,Other,Mobile Phone,BG Digital Subscriptions (Visit)\n'
  + 'Segments,,2568497,1164877,1326683,1954\n'
  + 'Google (Globe),,795041,159564,608114,796\n'
  + 'Google (Globe),Month,795041,159564,608114,796\n'
  + 'Google (Globe),2026-07-01,630852,135138,475387,639\n'
  + 'Google (Globe),2026-08-01,164244,24440,132765,157\n'
  + '\n'
  + '##############################################\n'
  + '# Freeform table\n'
  + '##############################################\n'
  + ',Visits,Visits,Visits,BG Digital Subscriptions (Visit)\n'
  + ',Visits,Other,Mobile Phone,BG Digital Subscriptions (Visit)\n'
  + 'Referring Domain,2334801,1007626,1258131,1865\n'
  + 'Typed/Bookmarked,1457793,802849,616947,795\n'
  + 'google.com,677905,161304,491158,761\n'
  + 'com.google,132896,1283,128608,46\n'
  + 'facebook.com,52439,8125,42703,68\n'
  + '\n'
  + '##############################################\n'
  + '# Freeform table (9)\n'
  + '##############################################\n'
  + ',BG Logged Out Visits,BG Digital Subscriptions (Visit),Conversion Rate of Site\n'
  + ',Visits,BG Digital Subscriptions (Visit),Conversion Rate of Site\n'
  + 'Referring Domain,1391557,1865,0.00134022537344859\n'
  + 'Typed/Bookmarked,623127,795,0.0012758233875277431\n'
  + 'google.com,599603,761,0.0012691731028697322\n'
  + 'com.google,123414,46,0.0003727291879365388\n'
  + 'facebook.com,49329,68,0.0013784994627906505\n'
  + 't.co,28064,30,0.0010689851767388826\n'
  + 'chatgpt.com,469,6,0.012793176975479744\n'
  + 'instagram.com,2819,17,0.006030507271017382\n'
  + 'linkin.bio,2143,13,0.006066262249183387\n'
  + 'nowhere.example,900,0,0\n'
  + 'Domain,1391557,1865,0.00134022537344859\n'
  + 'comcast.net,120000,90,0.00075\n'
  + 'verizon.net,80000,40,0.0005\n';

test('reads the header metadata', () => {
  const r = parseAdobeFreeform(FIXTURE);
  assert.equal(r.ok, true);
  assert.equal(r.reportSuite, 'Bostonglobe.com');
  assert.equal(r.dateRange, 'Jul 27, 2026 - Aug 2, 2026');
  assert.equal(r.tablesFound, 3);
});

test('prefers the conversion block over the device block', () => {
  const r = parseAdobeFreeform(FIXTURE);
  const google = r.rows.find((x) => x.domain === 'google.com');
  assert.ok(google);
  // 599603 is logged-out visits; 677905 is total visits from the other block.
  assert.equal(google.loggedOutVisits, 599603);
  assert.equal(google.totalVisits, 677905);
  assert.equal(google.newSubscriptions, 761);
});

test("Adobe's own conversion rate is preserved, not recomputed", () => {
  const r = parseAdobeFreeform(FIXTURE);
  const google = r.rows.find((x) => x.domain === 'google.com');
  assert.equal(google?.conversionRate, 0.0012691731028697322);
});

test('the conversion rate divides by logged-out visits, so the math ties', () => {
  const r = parseAdobeFreeform(FIXTURE);
  for (const row of r.rows) {
    if (!row.loggedOutVisits || row.newSubscriptions === null) continue;
    const recomputed = row.newSubscriptions / row.loggedOutVisits;
    assert.ok(Math.abs(recomputed - (row.conversionRate ?? 0)) < 1e-9,
      `${row.domain}: reported ${row.conversionRate}, recomputed ${recomputed}`);
  }
});

test('the total row is separated from the domain rows', () => {
  const r = parseAdobeFreeform(FIXTURE);
  assert.equal(r.total?.newSubscriptions, 1865);
  assert.ok(!r.rows.some((x) => x.domain === 'Referring Domain'));
});

test('the ISP breakdown after the "Domain" marker is dropped', () => {
  const r = parseAdobeFreeform(FIXTURE);
  assert.ok(!r.rows.some((x) => x.domain === 'comcast.net'));
  assert.ok(!r.rows.some((x) => x.domain === 'verizon.net'));
  assert.ok(r.problems.some((p) => p.includes('internet provider')));
});

test('period rows and segment labels never become domains', () => {
  const r = parseAdobeFreeform(FIXTURE);
  for (const bad of ['2026-07-01', '2026-08-01', 'Month', 'Segments', 'Google (Globe)']) {
    assert.ok(!r.rows.some((x) => x.domain === bad), `${bad} leaked into rows`);
  }
});

test('rejects a file that is not a Freeform export', () => {
  const r = parseAdobeFreeform('domain,visits\ngoogle.com,100\n');
  assert.equal(r.ok, false);
  assert.match(r.problems[0], /Freeform/);
});

test('survives an empty file without throwing', () => {
  const r = parseAdobeFreeform('');
  assert.equal(r.ok, false);
  assert.equal(r.rows.length, 0);
});

/* ------------------------------------------------------------- rollups */

test('Google is one platform, not two rows', () => {
  const { platforms } = rollUpReferrals(parseAdobeFreeform(FIXTURE).rows);
  const google = platforms.find((p) => p.id === 'google');
  assert.equal(google?.newSubscriptions, 761 + 46);
  assert.equal(google?.loggedOutVisits, 599603 + 123414);
  assert.equal(google?.members.length, 2);
});

test('linkin.bio rolls into Instagram', () => {
  const { platforms } = rollUpReferrals(parseAdobeFreeform(FIXTURE).rows);
  const ig = platforms.find((p) => p.id === 'instagram');
  assert.equal(ig?.newSubscriptions, 17 + 13);
});

test('direct traffic is held out of the platform ranking', () => {
  const { platforms, direct } = rollUpReferrals(parseAdobeFreeform(FIXTURE).rows);
  assert.equal(direct?.newSubscriptions, 795);
  assert.ok(!platforms.some((p) => p.category === 'direct'));
  assert.equal(platforms[0].id, 'google');
});

test('a rolled-up conversion rate is recomputed from its own totals', () => {
  const { platforms } = rollUpReferrals(parseAdobeFreeform(FIXTURE).rows);
  const google = platforms.find((p) => p.id === 'google');
  assert.ok(google);
  const expected = (761 + 46) / (599603 + 123414);
  assert.ok(Math.abs((google.conversionRate ?? 0) - expected) < 1e-12);
});

test('conversion rate is null on zero visits, never Infinity', () => {
  const { platforms } = rollUpReferrals([
    { domain: 'ghost.example', loggedOutVisits: 0, totalVisits: null,
      newSubscriptions: 3, conversionRate: null },
  ]);
  assert.equal(platforms[0].conversionRate, null);
});

test('zero-subscription domains are counted, not silently dropped', () => {
  const r = rollUpReferrals(parseAdobeFreeform(FIXTURE).rows);
  assert.equal(r.zeroSubDomains, 1);
  assert.equal(r.zeroSubVisits, 900);
});

test('an unrecognised domain stays its own row rather than being guessed at', () => {
  const { platforms } = rollUpReferrals(parseAdobeFreeform(FIXTURE).rows);
  const unknown = platforms.find((p) => p.label === 'nowhere.example');
  assert.equal(unknown?.category, 'other');
});

/* -------------------------------------------------------------- import */

test('a rate built on too few conversions is withheld, not printed', () => {
  const r = importAdobeFreeform(FIXTURE);
  assert.ok(r.ok);
  // linkin.bio rolls into Instagram for 30 subs, so Instagram keeps its rate.
  const instagram = r.table.rows.find((row) => row[0] === 'Instagram');
  assert.notEqual(instagram?.[3], '—');
  // ChatGPT's 6 conversions clear the floor; the finding survives the guard.
  const chatgpt = r.table.rows.find((row) => row[0] === 'ChatGPT');
  assert.equal(chatgpt?.[2], '6');
  assert.equal(chatgpt?.[3], '1.279%');
});

test('a single conversion never becomes a headline percentage', () => {
  // Inserted BEFORE the ISP "Domain" marker; anything after it is correctly
  // dropped as an internet-provider row rather than a referrer.
  // Anchored to the line start: an unanchored 'Domain,' also matches inside
  // the 'Referring Domain,' total row further up.
  const tiny = FIXTURE.replace('\nDomain,1391557', '\nquestkm.example,4,1,0.25\nDomain,1391557');
  const r = importAdobeFreeform(tiny);
  assert.ok(r.ok);
  const row = r.table.rows.find((x) => x[0] === 'questkm.example');
  assert.equal(row?.[2], '1');
  assert.equal(row?.[3], '—', 'a 25% rate on four visits must not be shown');
  assert.ok(r.summary.ratesWithheld > 0);
});

test('numbers are grouped for the export, in a pinned locale', () => {
  const r = importAdobeFreeform(FIXTURE);
  assert.ok(r.ok);
  const google = r.table.rows.find((row) => row[0] === 'Google');
  assert.equal(google?.[1], '723,017');
});

test('raw is the rows, never the source file', () => {
  const r = importAdobeFreeform(FIXTURE);
  assert.ok(r.ok);
  assert.ok(!r.table.raw.includes('# Freeform'),
    'the multi-table source must not land in the editable textarea');
  assert.equal(r.table.raw.split('\n').length, r.table.rows.length);
});

test('the unitemised remainder is reported rather than absorbed', () => {
  // Total row says 1865; the itemised domains in the fixture sum to less.
  const r = importAdobeFreeform(FIXTURE);
  assert.ok(r.ok);
  assert.ok((r.summary.unitemisedSubscriptions ?? 0) > 0);
});

test('direct traffic is reported separately from the ranked totals', () => {
  const r = importAdobeFreeform(FIXTURE);
  assert.ok(r.ok);
  assert.equal(r.summary.direct?.subscriptions, 795);
  assert.ok(!r.table.rows.some((row) => row[0].includes('Typed')));
});

test('a bad file leaves the caller able to keep existing rows', () => {
  const r = importAdobeFreeform('nonsense');
  assert.equal(r.ok, false);
  assert.ok(!('table' in r));
});
