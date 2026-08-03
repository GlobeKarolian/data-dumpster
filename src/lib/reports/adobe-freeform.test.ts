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
  assert.equal(google.visits, 599603);
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
    if (!row.visits || row.newSubscriptions === null) continue;
    const recomputed = row.newSubscriptions / row.visits;
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

test('rejects a domain table that has no subscriptions column', () => {
  const r = parseAdobeFreeform('domain,visits\ngoogle.com,100\n');
  assert.equal(r.ok, false);
  // The message points at the export to re-pull rather than naming an internal
  // format, because the parser now accepts plain sheets as well as Freeform.
  assert.match(r.problems[0], /Top Referrals export/);
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
  assert.equal(google?.visits, 599603 + 123414);
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
    { domain: 'ghost.example', visits: 0, totalVisits: null,
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

/* ------------------------------------------------- excel-shaped variants */

/** Saving a Freeform view as a workbook drops every '#' comment row. */
const NO_MARKERS = FIXTURE
  .split('\n')
  .filter((l) => !l.trimStart().startsWith('#') && !l.startsWith('"#'))
  .join('\n');

test('a file with no "# Freeform table" markers is still recovered', () => {
  const r = parseAdobeFreeform(NO_MARKERS);
  assert.equal(r.ok, true, 'the anchor-based fallback must find the table');
  const google = r.rows.find((x) => x.domain === 'google.com');
  assert.equal(google?.newSubscriptions, 761);
  assert.equal(google?.visits, 599603);
});

test('the marker-less path still separates the total row', () => {
  const r = parseAdobeFreeform(NO_MARKERS);
  assert.equal(r.total?.newSubscriptions, 1865);
  assert.ok(!r.rows.some((x) => x.domain === 'Referring Domain'));
});

test('the marker-less path still drops the ISP breakdown', () => {
  const r = parseAdobeFreeform(NO_MARKERS);
  assert.ok(!r.rows.some((x) => x.domain === 'comcast.net'));
});

test('a percent-formatted rate is read as a fraction, not multiplied by 100', () => {
  // Excel writes the string it displays. Reading "0.127%" as 0.127 would report
  // Google converting at 12.7%, which is wrong by two orders of magnitude and
  // still looks like a real number.
  const excelish = ',BG Logged Out Visits,BG Digital Subscriptions (Visit),Conversion Rate\n'
    + ',Visits,BG Digital Subscriptions (Visit),Conversion Rate\n'
    + 'Referring Domain,1391557,1865,0.134%\n'
    + 'google.com,599603,761,0.127%\n'
    + 'chatgpt.com,469,6,1.279%\n';
  const r = parseAdobeFreeform(excelish);
  assert.equal(r.ok, true);
  const google = r.rows.find((x) => x.domain === 'google.com');
  assert.ok(google);
  assert.ok(google.conversionRate !== null && google.conversionRate < 0.002,
    `expected ~0.00127, got ${google.conversionRate}`);
  const recomputed = google.newSubscriptions! / google.visits!;
  assert.ok(Math.abs(recomputed - google.conversionRate) < 1e-4);
});

test('a plain hand-built sheet with named columns is accepted', () => {
  const sheet = 'Referring Domain,Visits,New Subscriptions\n'
    + 'google.com,599603,761\n'
    + 'chatgpt.com,469,6\n';
  const r = parseAdobeFreeform(sheet);
  assert.equal(r.ok, true);
  assert.equal(r.rows.length, 2);
  // No rate column, so it is derived and must still tie.
  const chatgpt = r.rows.find((x) => x.domain === 'chatgpt.com');
  assert.ok(Math.abs((chatgpt?.conversionRate ?? 0) - 6 / 469) < 1e-12);
});

test('an unrelated spreadsheet is refused rather than parsed into nonsense', () => {
  const payroll = 'Employee,Department,Salary\nA. Person,News,90000\n';
  const r = parseAdobeFreeform(payroll);
  assert.equal(r.ok, false);
});

/* ------------------------------------------- cross-suite contamination */

/**
 * A real Boston.com export carried a table whose 401 rows were byte-identical
 * to the Globe's, headed "BG Logged Out Visits" under a "Report suite:
 * Boston.com" file header. Because that table is the one with a conversion
 * rate, it is the table this parser prefers. Every number in it is plausible,
 * so nothing downstream would have caught it.
 */
const CONTAMINATED = '﻿'
  + '# Report suite: Boston.com\n'
  + '"# Date: Jul 27, 2026 - Aug 2, 2026"\n'
  + '\n'
  + '##############################################\n'
  + '# Freeform table\n'
  + '##############################################\n'
  + ',Visits,Visits,Bcom Digital Subscriptions\n'
  + ',Visits,Mobile Phone,Bcom Digital Subscriptions\n'
  + 'Referring Domain,1395476,830133,4\n'
  + 'Typed/Bookmarked,923955,471001,1\n'
  + 'google.com,269960,199837,0\n'
  + 'reddit.com,8073,6936,0\n'
  + '\n'
  + '##############################################\n'
  + '# Freeform table (9)\n'
  + '##############################################\n'
  + ',BG Logged Out Visits,BG Digital Subscriptions (Visit),Conversion Rate of Site\n'
  + ',Visits,BG Digital Subscriptions (Visit),Conversion Rate of Site\n'
  + 'Referring Domain,1391557,1865,0.00134022537344859\n'
  + 'Typed/Bookmarked,623127,795,0.0012758233875277431\n'
  + 'google.com,599603,761,0.0012691731028697322\n'
  + 'reddit.com,8246,8,0.0009701673538685423\n';

test("a table measuring another property is refused, not preferred", () => {
  const r = parseAdobeFreeform(CONTAMINATED, { requireSubscriptions: false });
  assert.equal(r.ok, true);
  const reddit = r.rows.find((x) => x.domain === 'reddit.com');
  assert.equal(reddit?.visits, 8073,
    'must read Boston.com\'s own 8,073, never the Globe\'s 8,246');
});

test('the cross-suite mismatch is reported rather than silently handled', () => {
  const r = parseAdobeFreeform(CONTAMINATED, { requireSubscriptions: false });
  assert.ok(r.problems.some((p) => /different report suite/i.test(p)),
    'the reader has to be told a table was thrown away and why');
});

test('the guard holds even when subscriptions are demanded', () => {
  // The old build would have taken the BG table here, since it is the only one
  // with a conversion rate, and labelled Globe figures as Boston.com.
  const r = parseAdobeFreeform(CONTAMINATED, { requireSubscriptions: true });
  if (r.ok) {
    const reddit = r.rows.find((x) => x.domain === 'reddit.com');
    assert.notEqual(reddit?.visits, 8246, 'Globe figures must never surface here');
  }
});

test("a file's own prefixed metrics are not mistaken for a foreign suite", () => {
  // The Globe export is full of "BG" metrics and its suite IS the Globe.
  const r = parseAdobeFreeform(FIXTURE);
  assert.ok(!r.problems.some((p) => /different report suite/i.test(p)));
  assert.equal(r.rows.find((x) => x.domain === 'google.com')?.visits, 599603);
});

/* --------------------------------------------------- visits-ranked mode */

test('a traffic-only export is accepted when subscriptions are not required', () => {
  const trafficOnly = '# Report suite: Boston.com\n'
    + '\n'
    + '# Freeform table\n'
    + ',Visits,Visits\n'
    + ',Visits,Mobile Phone\n'
    + 'Referring Domain,1395476,830133\n'
    + 'google.com,269960,199837\n'
    + 'reddit.com,8073,6936\n';
  const strict = parseAdobeFreeform(trafficOnly, { requireSubscriptions: true });
  assert.equal(strict.ok, false, 'the Globe section must still demand subscriptions');
  const loose = parseAdobeFreeform(trafficOnly, { requireSubscriptions: false });
  assert.equal(loose.ok, true);
  assert.equal(loose.hasSubscriptions, false);
  assert.equal(loose.rows.find((x) => x.domain === 'reddit.com')?.visits, 8073);
});

test('visits mode ranks by traffic and reports share of the whole', () => {
  const r = importAdobeFreeform(CONTAMINATED, 'visits');
  assert.ok(r.ok);
  assert.equal(r.table.rows[0][0], 'Google');
  // Share divides by all referred traffic including direct, not by the visible
  // rows, so it must not sum to 100 across the ranked subset.
  const google = r.table.rows[0];
  assert.match(google[2], /^\d+\.\d%$/);
  assert.ok(!r.table.rows.some((row) => row.length > 3),
    'visits mode has three columns, with no subscriptions or conversion');
});

test('paid and internal traffic leave the platform ranking but stay in the table', () => {
  const withPaid = CONTAMINATED.replace(
    'reddit.com,8073,6936,0\n',
    'reddit.com,8073,6936,0\noutbrain.com,1262,900,0\nbostonglobe.com,1939,1400,3\n',
  );
  const r = importAdobeFreeform(withPaid, 'visits');
  assert.ok(r.ok);
  const labels = r.table.rows.map((x) => x[0]);
  assert.ok(labels.some((l) => /Outbrain \(paid distribution\)/.test(l)));
  assert.ok(labels.some((l) => /BostonGlobe\.com \(internal cross-promotion\)/.test(l)));
  // And they rank below every earned platform rather than competing with them.
  const firstNonPlatform = labels.findIndex((l) => /\(paid|\(internal/.test(l));
  const lastPlatform = labels.map((l) => /\(paid|\(internal/.test(l)).lastIndexOf(false);
  assert.ok(firstNonPlatform > lastPlatform);
});
