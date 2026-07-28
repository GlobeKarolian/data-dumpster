/**
 * Ownership checks for ids that arrive from a client.
 *
 * lib/session.ts covers landscapes because they are the one id nearly every
 * endpoint takes. Companies need the same treatment for a narrower reason: a
 * landscape is a set of company ids, so without this a caller could quietly
 * splice another org's company into their own landscape and start reading its
 * numbers through a perfectly legitimate analytics call.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { companies } from '@/db/schema';
import { HttpError } from '@/lib/session';

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

/** Single-company variant, used by the channel endpoints. */
export async function assertCompanyInOrg(id: string, orgId: string): Promise<string> {
  const [only] = await assertCompaniesInOrg([id], orgId);
  return only;
}
