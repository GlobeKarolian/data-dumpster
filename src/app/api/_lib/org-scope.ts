/**
 * Ownership checks for ids that arrive from a client.
 *
 * lib/session.ts covers landscapes because they are the one id nearly every
 * endpoint takes. Companies need the same treatment for a narrower reason: a
 * landscape is a set of company ids, so without this a caller could quietly
 * splice another org's company into their own landscape and start reading its
 * numbers through a perfectly legitimate analytics call.
 */
import { and, eq, inArray, ne, or } from 'drizzle-orm';
import { db } from '@/db';
import {
  companies,
  landscapeCompanies,
  landscapes,
  userLandscapeAccess,
} from '@/db/schema';
import { hasRole, HttpError, type OrgContext } from '@/lib/session';

/**
 * Confirm every id belongs to the org, and return them deduplicated in the order
 * given. Throws 422 naming the count that failed rather than which id, because
 * echoing back a foreign id confirms it exists.
 */
export async function assertCompaniesInOrg(
  ids: readonly string[],
  orgId: string,
): Promise<string[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];

  const rows = await db
    .select({ id: companies.id })
    .from(companies)
    .where(and(eq(companies.orgId, orgId), inArray(companies.id, unique)));

  const found = new Set(rows.map((r) => r.id));
  const missing = unique.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new HttpError(
      422,
      missing.length + ' of the companies you referenced do not exist in this workspace.',
      'unknown_company',
    );
  }
  return unique;
}

/**
 * Landscape membership is an org-private reference to a public pooled company.
 * A company already visible through one of the org's landscapes may therefore
 * be reused in another landscape without granting mutation rights over it.
 */
export async function assertCompaniesVisibleToOrg(
  ids: readonly string[],
  orgId: string,
): Promise<string[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];

  const rows = await db
    .selectDistinct({ id: companies.id })
    .from(companies)
    .leftJoin(landscapeCompanies, eq(landscapeCompanies.companyId, companies.id))
    .leftJoin(landscapes, eq(landscapes.id, landscapeCompanies.landscapeId))
    .where(and(
      inArray(companies.id, unique),
      or(eq(companies.orgId, orgId), eq(landscapes.orgId, orgId)),
    ));

  const found = new Set(rows.map((row) => row.id));
  const missing = unique.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new HttpError(
      422,
      missing.length + ' of the companies you referenced are not available to this workspace.',
      'unknown_company',
    );
  }
  return unique;
}

/**
 * The same pooled-company check, narrowed by the caller's landscape grants.
 * Admins and owners inherit the org-wide behavior; restricted roles may reuse
 * only companies attributed to their workspace or already present in a
 * landscape they can open. Attribution keeps a newly created, not-yet-grouped
 * company usable without exposing pooled entities from inaccessible sets.
 */
export async function assertCompaniesVisibleToUser(
  ids: readonly string[],
  ctx: OrgContext,
): Promise<string[]> {
  if (hasRole(ctx.role, 'admin')) {
    return assertCompaniesVisibleToOrg(ids, ctx.orgId);
  }

  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];

  const rows = await db
    .selectDistinct({ id: companies.id })
    .from(companies)
    .leftJoin(landscapeCompanies, eq(landscapeCompanies.companyId, companies.id))
    .leftJoin(landscapes, eq(landscapes.id, landscapeCompanies.landscapeId))
    .leftJoin(
      userLandscapeAccess,
      and(
        eq(userLandscapeAccess.landscapeId, landscapes.id),
        eq(userLandscapeAccess.userId, ctx.userId),
      ),
    )
    .where(and(
      inArray(companies.id, unique),
      or(
        eq(companies.orgId, ctx.orgId),
        and(
          eq(landscapes.orgId, ctx.orgId),
          eq(userLandscapeAccess.userId, ctx.userId),
        ),
      ),
    ));

  const found = new Set(rows.map((row) => row.id));
  const missing = unique.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new HttpError(
      422,
      missing.length + ' of the companies you referenced are not available to you.',
      'unknown_company',
    );
  }
  return unique;
}

/** Single-company variant, used by the channel endpoints. */
export async function assertCompanyInOrg(id: string, orgId: string): Promise<string> {
  const [only] = await assertCompaniesInOrg([id], orgId);
  return only;
}

/**
 * Global company and channel mutations affect every workspace that tracks the
 * pooled entity. Until those controls become org-private subscriptions, fail
 * closed once another org has placed the company in a landscape.
 */
export async function assertCompanyNotSharedWithOtherOrgs(
  companyId: string,
  orgId: string,
): Promise<void> {
  const [foreignUse] = await db
    .select({ id: landscapes.id })
    .from(landscapeCompanies)
    .innerJoin(landscapes, eq(landscapes.id, landscapeCompanies.landscapeId))
    .where(and(
      eq(landscapeCompanies.companyId, companyId),
      ne(landscapes.orgId, orgId),
    ))
    .limit(1);

  if (foreignUse) {
    throw new HttpError(
      409,
      'This pooled company is used by another workspace, so its shared data cannot be changed or deleted here.',
      'pooled_company_in_use',
    );
  }
}
