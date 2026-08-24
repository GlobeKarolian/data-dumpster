import 'server-only';

import { and, eq, sql as dsql } from 'drizzle-orm';
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
import type { DateRange, Granularity } from '@/lib/types';
import type { TimeSeriesResult } from '@/lib/metrics/contract';
import { getLeaderboard, getTimeSeries, getTopPostsByPlatform } from '@/lib/metrics/queries';
import { autoGranularity, bucketKey, daysIn, presetRange, toDayString } from '@/lib/dates';

/**
 * Share of a race's tagged posts above which a tag stops telling you anything.
 *
 * Set at 60 percent, well clear of the 21 percent the second-place tag holds in
 * the 2028 field and well below the 86 percent Politics holds. A tag that
 * describes almost every post in a field of candidates describes the field, and
 * the useful reading of a candidate is what they talk about that the others do
 * not.
 */
const UBIQUITOUS_TAG_SHARE = 0.6;

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
      attentionSeries: { series: [], companies: [], granularity: 'day' },
      topPosts: [],
      topics: {
        tags: [], series: [], candidates: [], taggedPosts: 0, totalPosts: 0,
        diffusion: [], ubiquitous: [],
      },
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
    attentionSeries,
    topPosts,
    topics,
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
    getWikipediaAttentionSeries(race, range, autoGranularity(range)),
    getTopPostsByPlatform({ ...base, perPlatform: 3 }),
    getRaceTopicFacts(companyIds, range),
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
    attentionSeries,
    topPosts,
    topics,
  };
}

/**
 * Tag facts for a race: what the field talks about, and who talks about what.
 *
 * Reads settled AI assignments only — nothing here re-derives topics. Buckets
 * use the report zone so a day means the same thing it means everywhere else
 * in the product. Coverage is reported rather than hidden: posts the tagging
 * pipeline has not read yet are absent from every count, and the caller gets
 * taggedPosts/totalPosts to say so on screen.
 */
async function getRaceTopicFacts(
  companyIds: string[],
  range: DateRange,
): Promise<import('./types').RaceTopicFacts> {
  const empty = {
    tags: [], series: [], candidates: [], taggedPosts: 0, totalPosts: 0,
    diffusion: [], ubiquitous: [],
  };
  if (companyIds.length === 0) return empty;
  const ids = dsql.raw(`'{${companyIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id)).join(',')}}'::uuid[]`);

  const top = await db.execute<{
    id: string; name: string; color: string | null;
    posts: string | number; tagged_total: string | number;
  }>(dsql`
    WITH tagged AS (
      SELECT count(DISTINCT a.post_id) AS n
        FROM post_tag_assignments a
        JOIN posts p ON p.id = a.post_id
       WHERE p.company_id = ANY(${ids})
         AND p.posted_at >= ${range.start.toISOString()}
         AND p.posted_at < ${range.end.toISOString()}
    )
    SELECT t.id::text AS id, t.name, t.color, count(DISTINCT p.id) AS posts,
           (SELECT n FROM tagged) AS tagged_total
      FROM post_tag_assignments a
      JOIN posts p ON p.id = a.post_id
      JOIN post_tags t ON t.id = a.tag_id
     WHERE p.company_id = ANY(${ids})
       AND p.posted_at >= ${range.start.toISOString()}
       AND p.posted_at < ${range.end.toISOString()}
     GROUP BY t.id, t.name, t.color
     ORDER BY count(DISTINCT p.id) DESC
     LIMIT 24`);

  const taggedTotal = Number(top.rows[0]?.tagged_total ?? 0);
  const ranked = top.rows.map((r) => {
    const posts = Number(r.posts);
    return {
      id: r.id, name: r.name, color: r.color, posts,
      share: taggedTotal > 0 ? posts / taggedTotal : 0,
    };
  });

  // A tag on nearly every post in a field of candidates describes the field,
  // not any candidate in it. Politics sits at 86 percent of the 2028 corpus
  // against 21 for the next tag down, so while it was on the chart it WAS the
  // chart, and every candidate's top topic was the same word. Held back on
  // share rather than by name, so a taxonomy that later grows an "Elections" or
  // a "Campaign 2028" is handled without another edit here.
  const ubiquitous = ranked.filter((t) => t.share >= UBIQUITOUS_TAG_SHARE);
  const tags = ranked.filter((t) => t.share < UBIQUITOUS_TAG_SHARE).slice(0, 8)
    .map(({ id, name, color, posts }) => ({ id, name, color, posts }));
  if (tags.length === 0) return { ...empty, ubiquitous };
  const tagIds = dsql.raw(`'{${tags.map((t) => t.id).join(',')}}'::uuid[]`);
  const keptIds = tagIds;

  const [series, perCandidate, coverage] = await Promise.all([
    db.execute<{ day: string; tag_id: string; posts: string | number }>(dsql`
      SELECT to_char(date_trunc('day', p.posted_at AT TIME ZONE 'America/New_York'), 'YYYY-MM-DD') AS day,
             a.tag_id::text AS tag_id,
             count(DISTINCT p.id) AS posts
        FROM post_tag_assignments a
        JOIN posts p ON p.id = a.post_id
       WHERE p.company_id = ANY(${ids})
         AND a.tag_id = ANY(${tagIds})
         AND p.posted_at >= ${range.start.toISOString()}
         AND p.posted_at < ${range.end.toISOString()}
       GROUP BY 1, 2
       ORDER BY 1`),
    db.execute<{
      company_id: string; tag_id: string; name: string; color: string | null;
      posts: string | number; tagged_posts: string | number; rank: string | number;
    }>(dsql`
      WITH counts AS (
        -- Restricted to the kept tags, so a candidate's "most-posted topics"
        -- are not five slots of which the first is always Politics.
        SELECT p.company_id, a.tag_id, t.name, t.color,
               count(DISTINCT p.id) AS posts
          FROM post_tag_assignments a
          JOIN posts p ON p.id = a.post_id
          JOIN post_tags t ON t.id = a.tag_id
         WHERE p.company_id = ANY(${ids})
           AND a.tag_id = ANY(${keptIds})
           AND p.posted_at >= ${range.start.toISOString()}
           AND p.posted_at < ${range.end.toISOString()}
         GROUP BY p.company_id, a.tag_id, t.name, t.color
      ), totals AS (
        SELECT company_id, count(DISTINCT a.post_id) AS tagged_posts
          FROM post_tag_assignments a
          JOIN posts p ON p.id = a.post_id
         WHERE p.company_id = ANY(${ids})
           AND a.tag_id = ANY(${keptIds})
           AND p.posted_at >= ${range.start.toISOString()}
           AND p.posted_at < ${range.end.toISOString()}
         GROUP BY company_id
      )
      SELECT c.company_id::text AS company_id, c.tag_id::text AS tag_id, c.name, c.color,
             c.posts, tt.tagged_posts,
             row_number() OVER (PARTITION BY c.company_id ORDER BY c.posts DESC) AS rank
        FROM counts c
        JOIN totals tt ON tt.company_id = c.company_id
       ORDER BY c.company_id, c.posts DESC`),
    db.execute<{ tagged: string | number; total: string | number }>(dsql`
      SELECT
        (SELECT count(DISTINCT a.post_id) FROM post_tag_assignments a
          JOIN posts p ON p.id = a.post_id
         WHERE p.company_id = ANY(${ids})
           AND p.posted_at >= ${range.start.toISOString()}
           AND p.posted_at < ${range.end.toISOString()}) AS tagged,
        (SELECT count(*) FROM posts p
         WHERE p.company_id = ANY(${ids})
           AND p.posted_at >= ${range.start.toISOString()}
           AND p.posted_at < ${range.end.toISOString()}) AS total`),
  ]);

  const byDay = new Map<string, Record<string, number | string>>();
  for (const row of series.rows) {
    let bucket = byDay.get(row.day);
    if (!bucket) {
      bucket = { date: row.day };
      byDay.set(row.day, bucket);
    }
    bucket[row.tag_id] = Number(row.posts);
  }

  const candidateMap = new Map<string, {
    companyId: string; taggedPosts: number;
    topics: { id: string; name: string; color: string | null; posts: number; share: number }[];
  }>();
  for (const row of perCandidate.rows) {
    if (Number(row.rank) > 5) continue;
    let entry = candidateMap.get(row.company_id);
    if (!entry) {
      entry = { companyId: row.company_id, taggedPosts: Number(row.tagged_posts), topics: [] };
      candidateMap.set(row.company_id, entry);
    }
    const posts = Number(row.posts);
    entry.topics.push({
      id: row.tag_id, name: row.name, color: row.color, posts,
      share: entry.taggedPosts > 0 ? posts / entry.taggedPosts : 0,
    });
  }

  const cov = coverage.rows[0];
  return {
    tags,
    series: [...byDay.values()],
    candidates: [...candidateMap.values()].sort((a, b) => b.taggedPosts - a.taggedPosts),
    taggedPosts: Number(cov?.tagged ?? 0),
    totalPosts: Number(cov?.total ?? 0),
    diffusion: await getTopicDiffusion(ids, tagIds, tags, range),
    ubiquitous,
  };
}

/**
 * How each topic moved through the field.
 *
 * For every top topic: find its busiest day, name whoever posted on it
 * earliest that day, and count what each candidate posted on that topic in the
 * seven days either side. That is all measurement — no claim that the first
 * poster caused anything, and no claim about whether the follow-on posts agree
 * or argue. Stance is not something the tagging pipeline reads, so nothing
 * here pretends to know it.
 */
async function getTopicDiffusion(
  ids: ReturnType<typeof dsql.raw>,
  tagIds: ReturnType<typeof dsql.raw>,
  tags: { id: string; name: string; color: string | null }[],
  range: DateRange,
): Promise<import('./types').TopicDiffusion[]> {
  const { rows } = await db.execute<{
    tag_id: string; company_id: string; day: string; posts: string | number; first_at: string;
  }>(dsql`
    SELECT a.tag_id::text AS tag_id,
           p.company_id::text AS company_id,
           to_char(date_trunc('day', p.posted_at AT TIME ZONE 'America/New_York'), 'YYYY-MM-DD') AS day,
           count(DISTINCT p.id) AS posts,
           min(p.posted_at)::text AS first_at
      FROM post_tag_assignments a
      JOIN posts p ON p.id = a.post_id
     WHERE p.company_id = ANY(${ids})
       AND a.tag_id = ANY(${tagIds})
       AND p.posted_at >= ${range.start.toISOString()}
       AND p.posted_at < ${range.end.toISOString()}
     GROUP BY 1, 2, 3`);

  const byTag = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byTag.get(row.tag_id) ?? [];
    list.push(row);
    byTag.set(row.tag_id, list);
  }

  const WINDOW_DAYS = 7;
  const out: import('./types').TopicDiffusion[] = [];
  for (const tag of tags) {
    const entries = byTag.get(tag.id) ?? [];
    if (entries.length === 0) continue;

    const dayTotals = new Map<string, number>();
    for (const entry of entries) {
      dayTotals.set(entry.day, (dayTotals.get(entry.day) ?? 0) + Number(entry.posts));
    }
    let surgeDay = '';
    let surgePosts = 0;
    for (const [day, total] of dayTotals) {
      if (total > surgePosts) { surgePosts = total; surgeDay = day; }
    }
    if (!surgeDay) continue;

    const surge = new Date(surgeDay + 'T00:00:00Z').getTime();
    const dayMs = 86_400_000;
    const onSurge = entries.filter((entry) => entry.day === surgeDay);
    const first = onSurge.reduce<typeof onSurge[number] | null>((earliest, entry) => (
      !earliest || entry.first_at < earliest.first_at ? entry : earliest
    ), null);

    const tally = new Map<string, { before: number; after: number }>();
    for (const entry of entries) {
      const at = new Date(entry.day + 'T00:00:00Z').getTime();
      const slot = tally.get(entry.company_id) ?? { before: 0, after: 0 };
      if (at < surge && at >= surge - WINDOW_DAYS * dayMs) slot.before += Number(entry.posts);
      if (at > surge && at <= surge + WINDOW_DAYS * dayMs) slot.after += Number(entry.posts);
      tally.set(entry.company_id, slot);
    }

    out.push({
      tag: { id: tag.id, name: tag.name, color: tag.color },
      surgeDay,
      surgePosts,
      firstCompanyId: first?.company_id ?? null,
      participants: [...tally.entries()]
        .map(([companyId, counts]) => ({
          companyId,
          before: counts.before,
          after: counts.after,
          increased: counts.after > counts.before,
        }))
        .filter((entry) => entry.before > 0 || entry.after > 0)
        .sort((a, b) => (b.after - b.before) - (a.after - a.before)),
    });
  }
  return out;
}

/** Internal helper for an API that starts from a human-readable race URL. */
export async function findElectionRaceId(slug: string, orgId: string): Promise<string | null> {
  const [row] = await db.select({ id: electionRaces.id }).from(electionRaces).where(and(
    eq(electionRaces.slug, slug),
    eq(electionRaces.orgId, orgId),
  )).limit(1);
  return row?.id ?? null;
}

/**
 * Wikipedia lookup attention as a race time series.
 *
 * Views are flows, so bucket totals are honest sums — the one aggregation an
 * audience stock forbids is fine here. Rows come pre-bucketed daily from the
 * wikipedia_attention cache; aggregation to the chart's granularity happens
 * here with the same bucketKey the chart grid uses, because two clocks
 * disagreeing about Monday is a bug this codebase has already paid for once.
 * A candidate without a mapped article contributes nulls, which the chart
 * omits — absent, not zero.
 */
export async function getWikipediaAttentionSeries(
  race: ElectionRaceDetail,
  range: DateRange,
  granularity: Granularity,
): Promise<TimeSeriesResult> {
  const candidates = race.candidates.filter((c) => c.companyId);
  const companies = candidates.map((c) => ({
    id: c.companyId,
    name: c.name,
    slug: c.companyId,
    logoUrl: c.logoUrl,
    color: c.color,
    segment: null,
  }));
  const empty: TimeSeriesResult = { series: [], companies, granularity };
  if (candidates.length === 0) return empty;

  const { rows } = await db.execute<{ company_id: string; day: string; views: string | number }>(dsql`
    SELECT ec.company_id::text AS company_id, w.day::text AS day, w.views
      FROM election_candidates ec
      JOIN wikipedia_attention w ON w.page_title = ec.wikipedia_title
     WHERE ec.race_id = ${race.id}
       AND ec.wikipedia_title IS NOT NULL
       AND w.day >= ${toDayString(range.start)}
       AND w.day <= ${toDayString(range.end)}`);

  const byBucket = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const key = bucketKey(new Date(`${r.day}T12:00:00Z`), granularity);
    const bucket = byBucket.get(key) ?? new Map<string, number>();
    bucket.set(r.company_id, (bucket.get(r.company_id) ?? 0) + Number(r.views));
    byBucket.set(key, bucket);
  }

  const mapped = new Set(candidates.filter((c) => rows.some((r) => r.company_id === c.companyId)).map((c) => c.companyId));
  const series = [...byBucket.keys()].sort().map((date) => {
    const point: Record<string, string | number | null> = { date };
    const bucket = byBucket.get(date);
    for (const company of companies) {
      point[company.id] = mapped.has(company.id) ? bucket?.get(company.id) ?? 0 : null;
    }
    return point as TimeSeriesResult['series'][number];
  });
  return { series, companies, granularity };
}
