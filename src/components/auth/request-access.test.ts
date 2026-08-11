import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

test('public request flow is approval-gated and does not enumerate accounts', () => {
  const root = process.cwd();
  const page = readFileSync(resolve(root, 'src/app/request-access/page.tsx'), 'utf8');
  const hero = readFileSync(resolve(root, 'src/components/auth/request-access-hero.tsx'), 'utf8');
  const nextConfig = readFileSync(resolve(root, 'next.config.ts'), 'utf8');
  const form = readFileSync(resolve(root, 'src/components/auth/request-access-form.tsx'), 'utf8');
  const route = readFileSync(resolve(root, 'src/app/api/access-requests/route.ts'), 'utf8');
  const decision = readFileSync(
    resolve(root, 'src/app/api/settings/users/access-requests/[id]/route.ts'),
    'utf8',
  );
  const schema = readFileSync(resolve(root, 'src/db/schema.ts'), 'utf8');

  assert.doesNotMatch(page, /Get inside/);
  assert.doesNotMatch(page, /Ask for access\. Skip the invite chase/);
  assert.doesNotMatch(page, /The administrators are alerted automatically/);
  assert.match(page, /<RequestAccessHero \/>/);
  assert.match(page, /relative min-h-dvh overflow-hidden bg-black/);
  assert.match(page, /bg-white\/95/);
  assert.match(page, /<h1 className="text-2xl font-semibold tracking-tight">Request access<\/h1>/);
  assert.match(hero, /B7aksBgcJzFDO\/giphy\.gif/);
  assert.match(hero, /object-cover object-center/);
  assert.match(hero, /gifs\/ace-ventura-funny-dog-B7aksBgcJzFDO/);
  assert.match(nextConfig, /\/media\/B7aksBgcJzFDO\/\*\*/);
  assert.match(form, /\/api\/access-requests/);
  assert.match(form, /An administrator has been alerted/);
  assert.match(route, /identical for a new request, a duplicate, or an existing/);
  assert.match(route, /status: 202/);
  assert.match(decision, /requireRole\('admin'\)/);
  assert.match(decision, /Only an owner can approve another owner/);
  assert.match(schema, /access_requests_org_email_pending_uq/);
  assert.match(schema, /status} = 'pending'/);
});
