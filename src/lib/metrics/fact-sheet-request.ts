import { createHash } from 'node:crypto';
import { z } from 'zod';
import { PLATFORMS, POST_TYPES, type AnalyticsQuery } from '@/lib/types';
import type { FactSheet } from './contract';

/**
 * The filters that determine the contents of a fact sheet.
 *
 * This is shared by the Server Component that displays the sheet and the API
 * route that recomputes it before a model call. Keeping one wire contract is
 * what prevents an answer about "all companies" from appearing beside a sheet
 * filtered to one company.
 */
export const factSheetScopeSchema = z.object({
  platforms: z.array(z.enum(PLATFORMS)).max(PLATFORMS.length).optional(),
  companyIds: z.array(z.uuid()).max(100).optional(),
  tagIds: z.array(z.uuid()).max(100).optional(),
  postTypes: z.array(z.enum(POST_TYPES)).max(POST_TYPES.length).optional(),
  search: z.string().trim().max(500).optional(),
});

export type FactSheetScope = z.infer<typeof factSheetScopeSchema>;

function populated<T>(values: readonly T[] | undefined): T[] | undefined {
  return values && values.length > 0 ? [...values] : undefined;
}

/** Convert the in-process analytics query into its stable client/API shape. */
export function factSheetScopeFromQuery(query: AnalyticsQuery): FactSheetScope {
  const search = query.search?.trim();
  return {
    platforms: populated(query.platforms),
    companyIds: populated(query.companyIds),
    tagIds: populated(query.tagIds),
    postTypes: populated(query.postTypes),
    search: search ? search : undefined,
  };
}

/**
 * Detects a fact sheet changing between page render and the paid model call.
 *
 * This is an identity check, not an authentication primitive. Authorization is
 * still enforced by the org-scoped database query. A mismatch means an ingest
 * or filter change made the panel and answer refer to different evidence, so
 * the safe response is to refresh before spending money on an answer.
 */
export function factSheetFingerprint(facts: FactSheet): string {
  return createHash('sha256').update(JSON.stringify(facts)).digest('hex');
}
