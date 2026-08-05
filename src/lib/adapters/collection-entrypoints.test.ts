import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { it } from 'node:test';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

it('keeps every executable collection entry point behind the durable queue', () => {
  const manual = source('scripts/ingest.ts');
  const runner = source('src/lib/adapters/runner.ts');

  assert.doesNotMatch(manual, /\brunChannelIngest\b|\brunAllDue\b/);
  assert.doesNotMatch(runner, /export\s+(?:async\s+)?function\s+runAllDue\b/);
  assert.match(manual, /runCollectionQueue/);
});

it('keeps the retired heuristic dedupe script incapable of deleting pooled history', () => {
  const retired = source('scripts/dedupe-channels.ts');

  assert.match(retired, /RETIRED/);
  assert.doesNotMatch(retired, /delete\s+from|db\.delete|update\s+posts/i);
  assert.match(retired, /db:audit-channel-identities/);
});
