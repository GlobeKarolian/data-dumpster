import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postVerdict, type TrackedChannelFacts } from './verdict';

const now = new Date('2026-11-03T17:00:00Z');
const channel = (over: Partial<TrackedChannelFacts> = {}): TrackedChannelFacts => ({
  channelId: 'c1',
  company: 'Boston.com',
  handle: 'boston',
  active: true,
  status: 'partial',
  outcome: null,
  lastAttemptAt: '2026-11-03T13:00:00Z',
  lastError: null,
  newestPostAt: '2026-11-02T15:00:00Z',
  postsLast14Days: 9,
  ...over,
});
const base = { platformLabel: 'Instagram', handle: 'boston', postedOn: '2026-10-31', stored: [], now };

test('a stored post points the reporter at filters, not collection', () => {
  const v = postVerdict({ ...base, stored: [{ company: 'Boston.com', handle: 'boston', postedAt: '2026-10-31T20:00:00Z' }], channels: [channel()] });
  assert.equal(v.verdict, 'stored');
});

test('untracked, unknown and paused accounts', () => {
  assert.equal(postVerdict({ ...base, channels: [] }).verdict, 'account_not_tracked');
  assert.equal(postVerdict({ ...base, handle: null, channels: [] }).verdict, 'account_unknown');
  assert.equal(postVerdict({ ...base, channels: [channel({ active: false })] }).verdict, 'account_paused');
});

test('overdue collection', () => {
  const v = postVerdict({ ...base, channels: [channel({ lastAttemptAt: '2026-10-30T00:00:00Z' })] });
  assert.equal(v.verdict, 'collection_overdue');
  assert.match(v.text, /since 2026-10-30/);
});

test("Kaitlyn's case: collection runs, newest stored post is days older than the reported post", () => {
  const v = postVerdict({ ...base, channels: [channel({ newestPostAt: '2026-10-22T12:33:52Z', postsLast14Days: 2 })] });
  assert.equal(v.verdict, 'collection_silent');
  assert.match(v.text, /newest stored post is from 2026-10-22, before this post from 2026-10-31/);
  assert.match(v.text, /4 hours ago/);
});

test('a post skipped inside an otherwise healthy feed', () => {
  const v = postVerdict({ ...base, channels: [channel()] });
  assert.equal(v.verdict, 'skipped_in_gap');
});

test('a post newer than the last run just needs the next run', () => {
  const v = postVerdict({ ...base, postedOn: '2026-11-04', channels: [channel()] });
  assert.equal(v.verdict, 'newer_than_last_collection');
});
