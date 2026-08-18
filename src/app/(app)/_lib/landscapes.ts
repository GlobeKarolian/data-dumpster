/**
 * The one definition of "landscapes this user may pick from".
 *
 * This existed twice: once in the layout (which feeds the sidebar switcher and
 * the topbar) and once in resolveContext (which feeds every query on the
 * page). The two drifted — the layout excluded election-race landscapes, the
 * context did not — and because both fall back to `list[0]` when the URL names
 * no landscape, a request without a `?landscape=` parameter rendered the
 * sidebar's first landscape as a LABEL and the context's first landscape as
 * DATA. On this org that meant a page headed "BGM" filled with the 2028
 * Presidential Tracker's candidates.
 *
 * A label that disagrees with its data is the worst failure this product can
 * have, so the rule is now written once and imported twice.
 *
 * Election-race landscapes are excluded on purpose: they are companies in the
 * schema sense (a candidate has channels) but they are not a competitive set,
 * and they belong to Election Center, which addresses them by race.
 */
import { sql, type SQL } from 'drizzle-orm';
import type { Role } from '@/lib/roles';
import { roleAtLeast } from '@/lib/roles';

export interface LandscapeVisibility {
  orgId: string;
  userId: string;
  role: Role;
}

/**
 * Selectable landscapes, newest concerns last: ordered by name so the picker
 * reads predictably, and filtered to what this user may see.
 */
export function visibleLandscapesQuery(v: LandscapeVisibility): SQL {
  return sql`
    SELECT l.id, l.name, l.slug, l.focus_company_id,
           fc.name AS focus_company_name,
           count(lc.company_id) AS company_count
      FROM landscapes l
      LEFT JOIN companies fc ON fc.id = l.focus_company_id
      LEFT JOIN landscape_companies lc ON lc.landscape_id = l.id
     WHERE l.org_id = ${v.orgId}::uuid
       AND NOT EXISTS (
         SELECT 1 FROM election_races er WHERE er.landscape_id = l.id
       )
       AND (
         ${roleAtLeast(v.role, 'admin')}
         OR EXISTS (
           SELECT 1
             FROM user_landscape_access ula
            WHERE ula.landscape_id = l.id
              AND ula.user_id = ${v.userId}::uuid
         )
       )
     GROUP BY l.id, l.name, l.slug, l.focus_company_id, fc.name
     ORDER BY l.name ASC`;
}
