import 'server-only';

import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { electionRaces, userLandscapeAccess } from '@/db/schema';
import { AuthError, hasRole, type OrgContext } from '@/lib/session';
import type { ElectionRaceStatus } from './types';

export interface ElectionRaceRef {
  id: string;
  orgId: string;
  landscapeId: string;
  name: string;
  slug: string;
  office: string;
  jurisdiction: string;
  electionDate: string | null;
  status: ElectionRaceStatus;
}

/**
 * Resolve one race through the same private landscape grant used by the rest of
 * the product. A race id from the browser is a claim, not authorization.
 */
export async function assertElectionRaceAccessible(
  raceId: string,
  ctx: OrgContext,
): Promise<ElectionRaceRef> {
  const [row] = await db
    .select({
      id: electionRaces.id,
      orgId: electionRaces.orgId,
      landscapeId: electionRaces.landscapeId,
      name: electionRaces.name,
      slug: electionRaces.slug,
      office: electionRaces.office,
      jurisdiction: electionRaces.jurisdiction,
      electionDate: electionRaces.electionDate,
      status: electionRaces.status,
    })
    .from(electionRaces)
    .leftJoin(
      userLandscapeAccess,
      and(
        eq(userLandscapeAccess.landscapeId, electionRaces.landscapeId),
        eq(userLandscapeAccess.userId, ctx.userId),
      ),
    )
    .where(and(
      eq(electionRaces.id, raceId),
      eq(electionRaces.orgId, ctx.orgId),
      hasRole(ctx.role, 'admin')
        ? eq(electionRaces.orgId, ctx.orgId)
        : eq(userLandscapeAccess.userId, ctx.userId),
    ))
    .limit(1);

  if (!row) {
    throw new AuthError('not_found', 'That election race does not exist.');
  }

  return {
    ...row,
    status: row.status as ElectionRaceStatus,
  };
}
