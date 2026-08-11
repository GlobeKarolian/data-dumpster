import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

test('public request flow is approval-gated and does not enumerate accounts', () => {
  const root = process.cwd();
  const page = readFileSync(resolve(root, 'src/app/request-access/page.tsx'), 'utf8');
  const form = readFileSync(resolve(root, 'src/components/auth/request-access-form.tsx'), 'utf8');
  const route = readFileSync(resolve(root, 'src/app/api/access-requests/route.ts'), 'utf8');
  const decision = readFileSync(
    resolve(root, 'src/app/api/settings/users/access-requests/[id]/route.ts'),
    'utf8',
  );
  const schema = readFileSync(resolve(root, 'src/db/schema.ts'), 'utf8');

  assert.match(page, /No access is granted until a person approves it/);
  assert.match(page, /single-use setup link/);
  assert.match(form, /\/api\/access-requests/);
  assert.match(form, /An administrator has been alerted/);
  assert.match(route, /identical for a new request, a duplicate, or an existing/);
  assert.match(route, /status: 202/);
  assert.match(decision, /requireRole\('admin'\)/);
  assert.match(decision, /Only an owner can approve another owner/);
  assert.match(schema, /access_requests_org_email_pending_uq/);
  assert.match(schema, /status} = 'pending'/);
});
