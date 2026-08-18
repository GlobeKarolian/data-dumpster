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
    const visibility = source('src/app/(app)/_lib/landscapes.ts');
    const session = source('src/lib/session.ts');

    // The shell and the context must read the SAME list. They used to hold
    // separate copies of this query, and the copies drifted.
    for (const file of [layout, context]) {
      assert.match(file, /visibleLandscapesQuery/);
      assert.doesNotMatch(file, /FROM landscapes l/);
    }
    assert.match(visibility, /user_landscape_access/);
    assert.match(session, /user_landscape_access|userLandscapeAccess/);
    assert.match(session, /assertLandscapeAccessible/);
  });

  it('keeps the switcher and the page on one landscape list', () => {
    const visibility = source('src/app/(app)/_lib/landscapes.ts');
    // Election-race landscapes are excluded from the analytics picker. When
    // only the shell excluded them, a URL with no ?landscape= labelled the
    // page with the shell's first landscape while querying the context's
    // first landscape — a page headed "BGM" full of election candidates.
    assert.match(visibility, /NOT EXISTS\s*\(\s*\n?\s*SELECT 1 FROM election_races/);
    // Both sides order identically, so "first landscape" means one thing.
    assert.match(visibility, /ORDER BY l\.name ASC/);
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
