import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LANDSCAPE_IMPORT_MAX_ACCOUNTS,
  LANDSCAPE_IMPORT_MAX_BYTES,
  LANDSCAPE_IMPORT_MAX_COMPANIES,
  parseLandscapeImportCsv,
} from './landscape-import';

function hasCode(
  issues: { code: string }[],
  code: string,
): boolean {
  return issues.some((entry) => entry.code === code);
}

test('parses a wide CSV, aliases X, and normalizes optional company metadata', () => {
  const csv = '\uFEFFcompany_name,company_url,is_focus,segment,color,x,instagram,reddit\r\n'
    + '"The Boston Globe",https://www.bostonglobe.com,yes,metro daily,#c8102e,'
    + 'https://x.com/BostonGlobe,https://instagram.com/bostonglobe,'
    + 'https://www.reddit.com/user/bostonglobe/\r\n';

  const preview = parseLandscapeImportCsv(csv);

  assert.equal(preview.format, 'wide');
  assert.equal(preview.errors.length, 0);
  assert.equal(preview.companies.length, 1);
  assert.equal(preview.accounts.length, 3);
  assert.equal(preview.suggestedFocusCompanyKey, 'the-boston-globe');
  assert.deepEqual(
    preview.companies[0],
    {
      key: 'the-boston-globe',
      name: 'The Boston Globe',
      slug: 'the-boston-globe',
      website: 'https://www.bostonglobe.com/',
      segment: 'metro daily',
      color: '#C8102E',
      focus: true,
      rows: [2],
      accounts: preview.companies[0].accounts,
    },
  );
  assert.deepEqual(
    preview.accounts.map((account) => [account.platform, account.handle]),
    [
      ['twitter', 'bostonglobe'],
      ['instagram', 'bostonglobe'],
      ['reddit', 'u/bostonglobe'],
    ],
  );
});

test('parses long CSV rows, merges repeated companies, and permits multiple accounts', () => {
  const csv = [
    'company,website,focus,platform,account',
    'Boston.com,https://www.boston.com,true,facebook,https://facebook.com/boston',
    'Boston.com,https://www.boston.com,true,Facebook,https://facebook.com/bostondotcom',
    'Boston.com,https://www.boston.com,true,YouTube,https://youtube.com/@boston',
  ].join('\n');

  const preview = parseLandscapeImportCsv(csv);

  assert.equal(preview.format, 'long');
  assert.equal(preview.errors.length, 0);
  assert.equal(preview.companies.length, 1);
  assert.equal(preview.accounts.length, 3);
  assert.deepEqual(preview.companies[0].rows, [2, 3, 4]);
  assert.equal(preview.companies[0].focus, true);
});

test('keeps source row numbers exact after blank rows', () => {
  const csv = [
    'company,platform,account',
    'Good News,bluesky,goodnews.bsky.social',
    '',
    'Bad News,rss,https://example.com/feed.xml',
  ].join('\n');

  const preview = parseLandscapeImportCsv(csv);
  const rss = preview.errors.find((entry) => entry.code === 'unsupported_platform');

  assert.equal(rss?.row, 4);
  assert.equal(rss?.column, 'platform');
});

test('supports Rival IQ headers and explicitly reports ignored history metadata', () => {
  const csv = [
    'company_id,company_name,company_url,twitter,twitter_posts_since_date,facebook',
    '696152,The Boston Globe,https://www.bostonglobe.com,https://twitter.com/BostonGlobe,'
      + '2014-10-29 05:59:59,https://facebook.com/globe',
  ].join('\n');

  const preview = parseLandscapeImportCsv(csv);

  assert.equal(preview.format, 'wide');
  assert.equal(preview.errors.length, 0);
  assert.equal(preview.accounts.length, 2);
  assert.equal(
    preview.warnings.filter((entry) => entry.code === 'ignored_metadata').length,
    2,
  );
});

test('rejects two wide columns that map to the same platform', () => {
  const preview = parseLandscapeImportCsv([
    'company,twitter,x',
    'The Boston Globe,@BostonGlobe,@GlobeOpinion',
  ].join('\n'));

  assert.equal(preview.format, 'wide');
  assert.ok(hasCode(preview.errors, 'duplicate_mapped_header'));
});

test('reports invalid accounts on their exact row and column', () => {
  const preview = parseLandscapeImportCsv([
    'company,platform,account',
    'The Boston Globe,twitter,not valid!',
  ].join('\n'));
  const error = preview.errors.find((entry) => entry.code === 'invalid_account');

  assert.equal(error?.row, 2);
  assert.equal(error?.column, 'account');
});

test('blocks the same normalized account from being assigned to two companies', () => {
  const preview = parseLandscapeImportCsv([
    'company,platform,account',
    'First News,twitter,@SharedAccount',
    'Second News,twitter,@sharedaccount',
  ].join('\n'));

  assert.ok(hasCode(preview.errors, 'account_company_conflict'));
  assert.match(
    preview.errors.find((entry) => entry.code === 'account_company_conflict')?.message ?? '',
    /First News/,
  );
});

test('folds YouTube vanity handles but preserves canonical channel ids', () => {
  const vanity = parseLandscapeImportCsv([
    'company,platform,account',
    'First News,youtube,@BostonNews',
    'Second News,youtube,@bostonnews',
  ].join('\n'));
  assert.ok(hasCode(vanity.errors, 'account_company_conflict'));

  const canonical = parseLandscapeImportCsv([
    'company,platform,account',
    'First News,youtube,UC1234567890abcdefghijAB',
    'Second News,youtube,UC1234567890abcdefghijab',
  ].join('\n'));
  assert.equal(
    canonical.errors.some((entry) => entry.code === 'account_company_conflict'),
    false,
  );
});

test('allows zero or one focus marker and blocks multiple focus companies', () => {
  const noFocus = parseLandscapeImportCsv([
    'company,focus,bluesky',
    'First News,,firstnews.bsky.social',
  ].join('\n'));
  assert.equal(noFocus.errors.length, 0);
  assert.ok(hasCode(noFocus.warnings, 'focus_required'));
  assert.equal(noFocus.suggestedFocusCompanyKey, null);

  const oneFocus = parseLandscapeImportCsv([
    'company,focus,bluesky',
    'First News,yes,firstnews.bsky.social',
    'Second News,no,secondnews.bsky.social',
  ].join('\n'));
  assert.equal(oneFocus.errors.length, 0);
  assert.equal(oneFocus.suggestedFocusCompanyKey, 'first-news');

  const twoFocus = parseLandscapeImportCsv([
    'company,focus,bluesky',
    'First News,yes,firstnews.bsky.social',
    'Second News,true,secondnews.bsky.social',
  ].join('\n'));
  assert.ok(hasCode(twoFocus.errors, 'multiple_focus_companies'));
  assert.equal(twoFocus.suggestedFocusCompanyKey, null);
});

test('validates websites, colors, malformed quotes, and unsupported RSS', () => {
  const badFields = parseLandscapeImportCsv([
    'company,website,color,rss',
    'Bad News,example.com,red,https://example.com/rss',
  ].join('\n'));
  assert.ok(hasCode(badFields.errors, 'invalid_website'));
  assert.ok(hasCode(badFields.errors, 'invalid_color'));
  assert.ok(hasCode(badFields.errors, 'unsupported_platform'));

  const malformed = parseLandscapeImportCsv('company,facebook\n"Bad News,https://facebook.com/bad');
  assert.ok(hasCode(malformed.errors, 'malformed_csv'));
});

test('deduplicates identical accounts for one company without dropping the warning', () => {
  const preview = parseLandscapeImportCsv([
    'company,platform,account',
    'The Boston Globe,reddit,https://www.reddit.com/user/bostonglobe/',
    'The Boston Globe,reddit,u/bostonglobe',
  ].join('\n'));

  assert.equal(preview.errors.length, 0);
  assert.equal(preview.accounts.length, 1);
  assert.ok(hasCode(preview.warnings, 'duplicate_account'));
});

test('rejects uncollectible LinkedIn competitors and Reddit communities', () => {
  const preview = parseLandscapeImportCsv([
    'company,platform,account',
    'The Boston Globe,linkedin,https://www.linkedin.com/company/boston-globe-media/',
    'The Boston Globe,reddit,r/boston',
  ].join('\n'));

  assert.ok(hasCode(preview.errors, 'owned_account_required'));
  assert.ok(hasCode(preview.errors, 'reddit_user_required'));
  assert.equal(preview.accounts.length, 0);
});

test('enforces the company and account limits', () => {
  const companyRows = ['company,bluesky'];
  for (let index = 0; index <= LANDSCAPE_IMPORT_MAX_COMPANIES; index += 1) {
    companyRows.push(`Company ${index},company${index}.bsky.social`);
  }
  const tooManyCompanies = parseLandscapeImportCsv(companyRows.join('\n'));
  assert.ok(hasCode(tooManyCompanies.errors, 'too_many_companies'));

  const accountRows = ['company,platform,account'];
  for (let index = 0; index <= LANDSCAPE_IMPORT_MAX_ACCOUNTS; index += 1) {
    accountRows.push(`One Company,bluesky,account${index}.bsky.social`);
  }
  const tooManyAccounts = parseLandscapeImportCsv(accountRows.join('\n'));
  assert.ok(hasCode(tooManyAccounts.errors, 'too_many_accounts'));
});

test('enforces the one-megabyte UTF-8 payload limit', () => {
  const preview = parseLandscapeImportCsv('x'.repeat(LANDSCAPE_IMPORT_MAX_BYTES + 1));
  assert.ok(hasCode(preview.errors, 'file_too_large'));
});

test('accepts quoted commas, escaped quotes, and embedded newlines', () => {
  const csv = 'company,platform,account\n'
    + '"The ""Daily"", News",bluesky,"dailynews.bsky.social"\n'
    + '"A\nSecond Name",reddit,u/secondname\n';
  const preview = parseLandscapeImportCsv(csv);

  assert.equal(preview.errors.length, 0);
  assert.equal(preview.companies[0].name, 'The "Daily", News');
  assert.equal(preview.companies[1].name, 'A\nSecond Name');
});
