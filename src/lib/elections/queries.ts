import 'server-only';

import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { electionRaces } from '@/db/schema';
import { hasRole, type OrgContext } from '@/lib/session';
import type {
  ElectionCandidateProfile,
  ElectionCandidateRecord,
  ElectionCandidateSource,
  ElectionProfileSourceStatus,
  ElectionRaceDetail,
  ElectionRaceAnalytics,
  ElectionRaceStatus,
  ElectionRaceSummary,
} from './types';
import type { Platform } from '@/lib/types';
import type { DateRange } from '@/lib/types';
import { getLeaderboard, getTimeSeries, getTopPostsByPlatform } from '@/lib/metrics/queries';
import { autoGranularity, daysIn, presetRange, toDayString } from '@/lib/dates';

type RaceSummaryRow = {
  id: string;
  landscape_id: string;
  name: string;
  slug: string;
  office: string;
  jurisdiction: string;
  election_date: string | null;
  status: string;
  description: string | null;
  candidate_count: number | string;
  profile_count: number | string;
  platform_count: number | string;
  last_ingested_at: string | null;
};

function mapSummary(row: RaceSummaryRow): ElectionRaceSummary {
  return {
    id: row.id,
    landscapeId: row.landscape_id,
    name: row.name,
    slug: row.slug,
    office: row.office,
    jurisdiction: row.jurisdiction,
    electionDate: row.election_date,
    status: row.status as ElectionRaceStatus,
    description: row.description,
    candidateCount: Number(row.candidate_count) || 0,
    profileCount: Number(row.profile_count) || 0,
    platformCount: Number(row.platform_count) || 0,
    lastIngestedAt: row.last_ingested_at,
  };
}

async function summaryRows(ctx: OrgContext, slug?: string): Promise<RaceSummaryRow[]> {
  const result = await db.execute<RaceSummaryRow>(
    // The source roster, rather than every account attached to the pooled
    // company, defines a race's campaign profile count.
    (await import('drizzle-orm')).sql`
      SELECT
        er.id,
        er.landscape_id,
        er.name,
        er.slug,
        er.office,
        er.jurisdiction,
        er.election_date,
        er.status,
        er.description,
        count(DISTINCT ec.id) AS candidate_count,
        count(DISTINCT eps.id) AS profile_count,
        count(DISTINCT eps.platform) AS platform_count,
        max(ch.last_ingested_at) AS last_ingested_at
      FROM election_races er
      LEFT JOIN election_candidates ec ON ec.race_id = er.id
      LEFT JOIN election_profile_sources eps ON eps.candidate_id = ec.id
      LEFT JOIN channels ch
        ON ch.id = eps.channel_id
       AND ch.active = true
      WHERE er.org_id = ${ctx.orgId}::uuid
        AND (${slug ?? null}::text IS NULL OR er.slug = ${slug ?? null}::text)
        AND (
          ${hasRole(ctx.role, 'admin')}
          OR EXISTS (
            SELECT 1 FROM user_landscape_access ula
             WHERE ula.landscape_id = er.landscape_id
               AND ula.user_id = ${ctx.userId}::uuid
          )
        )
      GROUP BY er.id
      ORDER BY er.election_date ASC NULLS LAST, er.name ASC
    `,
  );
  return [...result.rows];
}

export async function listElectionRaces(ctx: OrgContext): Promise<ElectionRaceSummary[]> {
  return (await summaryRows(ctx)).map(mapSummary);
}

type CandidateRow = {
  id: string;
  company_id: string;
  name: string;
  website: string | null;
  logo_url: string | null;
  color: string | null;
  segment: string | null;
  party: string | null;
  candidate_status: string;
  incumbent: boolean | null;
};

type SourceRow = {
  candidate_id: string;
  id: string;
  platform: Platform;
  url: string;
  label: string | null;
  source_status: string;
  source_channel_id: string | null;
  note: string | null;
  channel_id: string | null;
  handle: string | null;
  profile_url: string | null;
  avatar_url: string | null;
  active: boolean | null;
  last_ingested_at: string | null;
};

export async function getElectionRaceBySlug(
  slug: string,
  ctx: OrgContext,
): Promise<ElectionRaceDetail | null> {
  const [summaryRow] = await summaryRows(ctx, slug);
  if (!summaryRow) return null;
  const summary = mapSummary(summaryRow);

  const drizzle = await import('drizzle-orm');
  const [candidateResult, sourceResult] = await Promise.all([
    db.execute<CandidateRow>(drizzle.sql`
      SELECT ec.id, ec.company_id, c.name, c.website, c.logo_url, c.color, c.segment,
             ec.party, ec.candidate_status, ec.incumbent
        FROM election_candidates ec
        JOIN companies c ON c.id = ec.company_id
        LEFT JOIN landscape_companies lc
          ON lc.landscape_id = ${summary.landscapeId}::uuid
         AND lc.company_id = c.id
       WHERE ec.race_id = ${summary.id}::uuid
       ORDER BY lc.sort_order ASC NULLS LAST, c.name ASC
    `),
    db.execute<SourceRow>(drizzle.sql`
      SELECT
        eps.candidate_id,
        eps.id,
        eps.platform,
        eps.url,
        eps.label,
        eps.status AS source_status,
        eps.channel_id AS source_channel_id,
        eps.note,
        matched.id AS channel_id,
        matched.handle,
        matched.profile_url,
        matched.avatar_url,
        matched.active,
        matched.last_ingested_at
      FROM election_profile_sources eps
      JOIN election_candidates ec ON ec.id = eps.candidate_id
      LEFT JOIN channels matched
        ON matched.id = eps.channel_id
      WHERE ec.race_id = ${summary.id}::uuid
      ORDER BY eps.candidate_id, eps.created_at ASC
    `),
  ]);

  const sourcesByCandidate = new Map<string, ElectionCandidateSource[]>();
  const profilesByCandidate = new Map<string, ElectionCandidateProfile[]>();
  for (const row of sourceResult.rows) {
    const connected = row.channel_id !== null;
    const sources = sourcesByCandidate.get(row.candidate_id) ?? [];
    sources.push({
      id: row.id,
      platform: row.platform,
      url: row.url,
      label: row.label,
      status: (connected ? 'connected' : row.source_status) as ElectionProfileSourceStatus,
      channelId: row.channel_id,
      note: row.note,
    });
    sourcesByCandidate.set(row.candidate_id, sources);

    if (connected && row.handle) {
      const profiles = profilesByCandidate.get(row.candidate_id) ?? [];
      profiles.push({
        id: row.channel_id as string,
        platform: row.platform,
        handle: row.handle,
        profileUrl: row.profile_url,
        avatarUrl: row.avatar_url,
        active: row.active !== false,
        lastIngestedAt: row.last_ingested_at,
      });
      profilesByCandidate.set(row.candidate_id, profiles);
    }
  }

  const candidates: ElectionCandidateRecord[] = candidateResult.rows.map((row) => ({
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    website: row.website,
    logoUrl: row.logo_url,
    color: row.color,
    currentRole: row.segment,
    party: row.party,
    status: row.candidate_status as ElectionCandidateRecord['status'],
    incumbent: row.incumbent,
    profiles: profilesByCandidate.get(row.id) ?? [],
    sources: sourcesByCandidate.get(row.id) ?? [],
  }));

  return { ...summary, candidates };
}

/**
 * The real-data counterpart to the 2028 concept view.
 *
 * A race is backed by a private landscape, while its candidate company ids
 * point into the pooled public dataset. Reusing the normal metric layer keeps
 * audience stocks, missing-data rules, platform splits and post enrichment
 * identical to the rest of Data Dumpster.
 */
export async function getElectionRaceAnalytics(
  race: ElectionRaceDetail,
  ctx: OrgContext,
  range: DateRange = presetRange(28, new Date()),
): Promise<ElectionRaceAnalytics> {
  const companyIds = race.candidates.map((candidate) => candidate.companyId);
  if (companyIds.length === 0) {
    return {
      range: {
        start: toDayString(range.start),
        end: toDayString(range.end),
        days: daysIn(range),
      },
      audience: [],
      audienceNetChange: [],
      engagementTotal: [],
      shareOfEngagement: [],
      posts: [],
      views: [],
      engagementSeries: { series: [], companies: [], granularity: 'day' },
      postSeries: { series: [], companies: [], granularity: 'day' },
      viewSeries: { series: [], companies: [], granularity: 'day' },
      topPosts: [],
    };
  }
  const base = {
    orgId: ctx.orgId,
    landscapeId: race.landscapeId,
    companyIds,
    start: range.start,
    end: range.end,
  };
  const [
    audience,
    audienceNetChange,
    engagementTotal,
    shareOfEngagement,
    posts,
    views,
    engagementSeries,
    postSeries,
    viewSeries,
    topPosts,
  ] = await Promise.all([
    getLeaderboard({ ...base, metric: 'audience', compare: true }),
    getLeaderboard({ ...base, metric: 'audienceNetChange', compare: true }),
    getLeaderboard({ ...base, metric: 'engagementTotal', compare: true }),
    getLeaderboard({ ...base, metric: 'shareOfEngagement', compare: true }),
    getLeaderboard({ ...base, metric: 'posts', compare: true }),
    getLeaderboard({ ...base, metric: 'views', compare: true }),
    getTimeSeries({ ...base, metric: 'engagementTotal', granularity: autoGranularity(range) }),
    getTimeSeries({ ...base, metric: 'posts', granularity: autoGranularity(range) }),
    getTimeSeries({ ...base, metric: 'views', granularity: autoGranularity(range) }),
    getTopPostsByPlatform({ ...base, perPlatform: 3 }),
  ]);
  return {
    range: {
      start: toDayString(range.start),
      end: toDayString(range.end),
      days: daysIn(range),
    },
    audience,
    audienceNetChange,
    engagementTotal,
    shareOfEngagement,
    posts,
    views,
    engagementSeries,
    postSeries,
    viewSeries,
    topPosts,
  };
}

/** Internal helper for an API that starts from a human-readable race URL. */
export async function findElectionRaceId(slug: string, orgId: string): Promise<string | null> {
  const [row] = await db.select({ id: electionRaces.id }).from(electionRaces).where(and(
    eq(electionRaces.slug, slug),
    eq(electionRaces.orgId, orgId),
  )).limit(1);
  return row?.id ?? null;
}
