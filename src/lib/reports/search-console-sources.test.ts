import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSearchDashboardUrl, sourceUrlFor } from './search-console-sources';

test('parses both Google Looker Studio hostnames and exposes report identifiers', () => {
  const oldHost = parseSearchDashboardUrl(
    'https://datastudio.google.com/u/0/reporting/bee9d7b7-6f7b-44d8-81bf-7232c2e9d4e8/page/qOVwC',
  );
  assert.equal(oldHost?.kind, 'report');
  if (oldHost?.kind === 'report') {
    assert.equal(oldHost.reportId, 'bee9d7b7-6f7b-44d8-81bf-7232c2e9d4e8');
    assert.equal(oldHost.pageId, 'qOVwC');
  }

  const newHost = parseSearchDashboardUrl(
    'https://lookerstudio.google.com/reporting/95f92bb2-d6c9-446c-b0c4-99c830531fe4/page/qOVwC',
  );
  assert.equal(newHost?.kind, 'report');
  if (newHost?.kind === 'report') {
    assert.equal(newHost.reportId, '95f92bb2-d6c9-446c-b0c4-99c830531fe4');
  }
});

test('accepts Google short share links without pretending they expose a report id', () => {
  const short = parseSearchDashboardUrl('https://datastudio.google.com/s/jfjTrDd7OXM');
  assert.equal(short?.kind, 'short');
  if (short?.kind === 'short') assert.equal(short.shareId, 'jfjTrDd7OXM');
});

test('rejects non-Google links and falls back to the approved property dashboard', () => {
  assert.equal(parseSearchDashboardUrl('https://example.com/reporting/a/page/b'), null);
  assert.match(sourceUrlFor('globeSearch', 'https://example.com/nope'), /datastudio\.google\.com/);
});
