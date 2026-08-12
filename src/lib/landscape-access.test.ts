import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { roleAtLeast, type Role } from './roles';

const root = process.cwd();
const source = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('landscape access policy', () => {
  it('gives universal landscape access only to admins and owners', () => {
    const universal = (['viewer', 'editor', 'admin', 'owner'] as Role[])
      .filter((role) => roleAtLeast(role, 'admin'));
    assert.deepEqual(universal, ['admin', 'owner']);
  });

  it('backfills existing restricted users without making future grants implicit', () => {
    const migration = source('drizzle/0008_small_clint_barton.sql');
    assert.match(migration, /CREATE TABLE "user_landscape_access"/);
    assert.match(migration, /u\."role" IN \('editor'::role, 'viewer'::role\)/);
    assert.match(migration, /ON CONFLICT \("user_id", "landscape_id"\) DO NOTHING/);
  });

  it('enforces grants in both the shell and the server-side context', () => {
    const layout = source('src/app/(app)/layout.tsx');
    const context = source('src/app/(app)/_lib/context.ts');
    const session = source('src/lib/session.ts');
    for (const file of [layout, context, session]) {
      assert.match(file, /user_landscape_access|userLandscapeAccess/);
    }
    assert.match(session, /assertLandscapeAccessible/);
  });

  it('supports creating a landscape with a new focus company in one request', () => {
    const route = source('src/app/api/landscapes/route.ts');
    const ui = source('src/components/settings/companies-manager.tsx');
    assert.match(route, /newFocusCompany/);
    assert.match(route, /focusCompanyCreated/);
    assert.match(ui, /Create landscape and company/);
    assert.match(ui, /variant="primary"\s+onClick=\{\(\) => setOpen\(\(v\) => !v\)\}/);
  });

  it('reuses a pooled company in another landscape without replacing membership', () => {
    const route = source('src/app/api/landscapes/[id]/companies/route.ts');
    const ui = source('src/components/settings/companies-manager.tsx');

    assert.match(route, /INSERT INTO landscape_companies/);
    assert.match(route, /ON CONFLICT \(landscape_id, company_id\) DO NOTHING/);
    assert.doesNotMatch(route, /DELETE FROM landscape_companies/);
    assert.match(route, /enqueueLandscapeCollection/);
    assert.match(ui, /Use existing/);
    assert.match(ui, /Reusing a company keeps its profiles, history, and membership in every other landscape/);
    assert.match(ui, /Add to landscape/);
  });
});
