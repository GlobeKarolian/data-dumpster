import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

test('login uses the selected GIF as a full-viewport background', () => {
  const root = process.cwd();
  const page = readFileSync(resolve(root, 'src/app/login/page.tsx'), 'utf8');
  const hero = readFileSync(
    resolve(root, 'src/components/auth/dumpster-fire-hero.tsx'),
    'utf8',
  );
  const form = readFileSync(resolve(root, 'src/components/auth/login-form.tsx'), 'utf8');
  const config = readFileSync(resolve(root, 'next.config.ts'), 'utf8');

  assert.match(hero, /xLsaBMK6Mg8DK\/giphy\.gif/);
  assert.match(hero, /absolute inset-0 overflow-hidden/);
  assert.match(hero, /\bfill\b/);
  assert.match(hero, /object-cover object-center/);
  assert.match(page, /relative min-h-dvh overflow-hidden bg-black/);
  assert.match(page, /bg-white\/90/);
  assert.match(config, /\/media\/xLsaBMK6Mg8DK\/\*\*/);
  assert.match(page, /The data is messy\./);
  assert.match(page, /href="\/request-access"/);
  assert.match(page, /Request access/);

  assert.doesNotMatch(page, /Your login shouldn’t be/);
  assert.doesNotMatch(page, /The feed is on fire|dumpster has a bouncer/);
  assert.doesNotMatch(form, /Enter the dumpster|Opening the lid/);
});
