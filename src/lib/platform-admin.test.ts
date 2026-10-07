import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { effectiveRole, isPlatformAdmin } from './platform-admin';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('platform administrator policy', () => {
  it('recognizes Matt regardless of email casing or surrounding whitespace', () => {
    assert.equal(isPlatformAdmin('matt@boston.com'), true);
    assert.equal(isPlatformAdmin('  MATT@BOSTON.COM  '), true);
  });

  it('does not grant the capability to other identities', () => {
    assert.equal(isPlatformAdmin('matt.karolian@globe.com'), false);
    assert.equal(isPlatformAdmin('editor@boston.com'), false);
    assert.equal(isPlatformAdmin(null), false);
    assert.equal(isPlatformAdmin(undefined), false);
  });

  it('makes Matt owner-equivalent without changing anyone else\'s stored role', () => {
    assert.equal(effectiveRole('matt@boston.com', 'viewer'), 'owner');
    assert.equal(effectiveRole('editor@boston.com', 'editor'), 'editor');
    assert.equal(effectiveRole(null, 'admin'), 'admin');
  });

  it('applies the effective role at the central authorization boundary', () => {
    const session = source('src/lib/session.ts');
    const context = source('src/app/(app)/_lib/context.ts');

    assert.match(session, /role: effectiveRole\(normalizedEmail, role\)/);
    assert.match(session, /orgId,\s*\n\s*userId: id,/);
    assert.match(context, /isPlatformAdmin: session\.isPlatformAdmin/);
  });

  it('keeps the all-report view fenced to Matt\'s signed organization', () => {
    const index = source('src/app/(app)/reports/page.tsx');
    const detail = source('src/app/(app)/reports/[id]/page.tsx');
    const loader = source('src/app/api/reports/_lib.ts');

    assert.match(index, /WHERE r\.org_id = \$\{ctx\.orgId\}::uuid/);
    assert.match(index, /reportIndexLandscapeScope\(landscapeId, ctx\.isPlatformAdmin\)/);
    assert.match(detail, /AND r\.org_id = \$\{ctx\.orgId\}::uuid/);
    assert.match(loader, /eq\(weeklyReports\.orgId, ctx\.orgId\)/);
  });
});
