import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const raceMigration = readFileSync(
  new URL('../../../drizzle/0011_calm_baron_zemo.sql', import.meta.url),
  'utf8',
);
const rosterMigration = readFileSync(
  new URL('../../../drizzle/0012_unusual_rachel_grey.sql', import.meta.url),
  'utf8',
);

describe('Massachusetts Senate primary seed', () => {
  it('uses the primary date and campaign-only race name', () => {
    assert.match(raceMigration, /Massachusetts U\.S\. Senate Democratic Primary/);
    assert.match(raceMigration, /2026-09-01/);
    assert.doesNotMatch(raceMigration, /2026-11-03/);
  });

  it('keeps the supplied campaign roster and account caveats intact', () => {
    assert.match(rosterMigration, /https:\/\/www\.edmarkey\.com/);
    assert.match(rosterMigration, /https:\/\/sethmoulton\.com/);
    assert.match(rosterMigration, /https:\/\/www\.youtube\.com\/@markeypress/);
    assert.match(rosterMigration, /https:\/\/bsky\.app\/profile\/sethmoulton\.bsky\.social/);
    assert.match(rosterMigration, /mixes congressional-office and campaign material/);
    assert.doesNotMatch(rosterMigration, /linkedin\.com\/in\/seth-moulton/i);
  });
});
