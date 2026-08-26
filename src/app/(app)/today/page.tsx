/**
 * Today: the glanceable morning answer to "what is going on out there".
 *
 * Deliberately not another analytics screen. One fixed window (the last 24
 * hours), no pickers beyond the landscape switcher, three questions in
 * reading order: what are the comment sections collectively arguing about
 * (the digest), which stories are driving conversation (clusters), and which
 * individual sections are worth opening (per-post summaries).
 */
import type { Metadata } from 'next';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { PageSection } from '@/components/shell/page-section';
import { Panel } from '@/components/common/panel';
import { formatInteger } from '@/components/ui/format';
import { getStoryCloud } from '@/lib/stories/query';
import { resolveContext } from '../_lib/context';
import { type SearchParamsInput } from '../_lib/data';

export const metadata: Metadata = { title: 'Today' };
export const dynamic = 'force-dynamic';

const WINDOW_HOURS = 24;
const TOP_STORIES = 6;
const TOP_SECTIONS = 6;

interface DigestRow extends Record<string, unknown> {
  digest: string;
  summaries_considered: string | number;
  generated_at: string;
}

interface SectionRow extends Record<string, unknown> {
  company: string;
  summary: string;
  comments: string | number;
  permalink: string | null;
  platform: string;
}

interface PulseRow extends Record<string, unknown> {
  posts_24h: string | number;
  engagement_24h: string | number;
  comments_24h: string | number;
  loudest_company: string | null;
}

async function loadDigest(): Promise<DigestRow | null> {
  const { rows } = await db.execute<DigestRow>(sql`
    SELECT digest, summaries_considered,
           to_char(generated_at AT TIME ZONE 'America/New_York', 'HH12:MI AM') AS generated_at
      FROM daily_comment_digests
     WHERE day = (now() AT TIME ZONE 'America/New_York')::date`);
  return rows[0] ?? null;
}

async function loadSections(landscapeId: string): Promise<SectionRow[]> {
  const { rows } = await db.execute<SectionRow>(sql`
    SELECT co.name AS company, cs.summary, cs.comments_considered AS comments,
           p.permalink, c.platform
      FROM comment_summaries cs
      JOIN posts p ON p.id = cs.post_id
      JOIN channels c ON c.id = p.channel_id
      JOIN companies co ON co.id = p.company_id
      JOIN landscape_companies lc ON lc.company_id = co.id
     WHERE lc.landscape_id = ${landscapeId}::uuid
       AND cs.summary IS NOT NULL
       AND cs.generated_at > now() - make_interval(hours => ${WINDOW_HOURS})
     ORDER BY cs.comments_considered DESC
     LIMIT ${TOP_SECTIONS}`);
  return rows;
}

async function loadPulse(landscapeId: string): Promise<PulseRow> {
  const { rows } = await db.execute<PulseRow>(sql`
    WITH member_posts AS (
      SELECT p.id, p.engagement_total, p.company_id
        FROM posts p
        JOIN landscape_companies lc ON lc.company_id = p.company_id
       WHERE lc.landscape_id = ${landscapeId}::uuid
         AND p.posted_at > now() - make_interval(hours => ${WINDOW_HOURS})
    )
    SELECT (SELECT count(*) FROM member_posts) AS posts_24h,
           (SELECT coalesce(sum(engagement_total), 0) FROM member_posts) AS engagement_24h,
           (SELECT count(*) FROM post_comments pc
             WHERE pc.collected_at > now() - make_interval(hours => ${WINDOW_HOURS})
               AND pc.post_id IN (
                 SELECT p2.id FROM posts p2
                   JOIN landscape_companies lc2 ON lc2.company_id = p2.company_id
                  WHERE lc2.landscape_id = ${landscapeId}::uuid))
             AS comments_24h,
           (SELECT co.name FROM member_posts mp
              JOIN companies co ON co.id = mp.company_id
             GROUP BY co.name ORDER BY sum(mp.engagement_total) DESC LIMIT 1)
             AS loudest_company`);
  return rows[0];
}

function PlatformDot({ platform }: { platform: string }) {
  return (
    <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
      {platform}
    </span>
  );
}

export default async function TodayPage({ searchParams }: {
  searchParams: Promise<SearchParamsInput>;
}) {
  const ctx = await resolveContext(await searchParams);
  if (!ctx.landscape) {
    return (
      <PageSection title="Today">
        <Panel title="Pick a landscape">
          <p className="p-4 text-sm text-zinc-600 dark:text-zinc-400">
            Choose a landscape in the switcher and Today will show what its
            brands are stirring up.
          </p>
        </Panel>
      </PageSection>
    );
  }

  const end = new Date();
  const start = new Date(end.getTime() - WINDOW_HOURS * 3_600_000);
  const [digest, cloud, sections, pulse] = await Promise.all([
    loadDigest(),
    getStoryCloud({ landscapeId: ctx.landscape.id, start, end }),
    loadSections(ctx.landscape.id),
    loadPulse(ctx.landscape.id),
  ]);
  const stories = [...cloud.clusters]
    .sort((a, b) => b.totalEngagement - a.totalEngagement)
    .slice(0, TOP_STORIES);

  return (
    <PageSection
      title="Today"
      description={'The last 24 hours across ' + ctx.landscape.name + ', at a glance.'}
    >
      <div className="flex flex-col gap-4">

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: 'Posts', value: formatInteger(Number(pulse.posts_24h) || 0) },
            { label: 'Engagement', value: formatInteger(Number(pulse.engagement_24h) || 0) },
            { label: 'Comments collected', value: formatInteger(Number(pulse.comments_24h) || 0) },
            { label: 'Loudest brand', value: pulse.loudest_company ?? '—' },
          ].map((tile) => (
            <div key={tile.label} className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
              <p className="text-xs font-medium text-zinc-500">{tile.label}</p>
              <p className="pb-num mt-1 truncate text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                {tile.value}
              </p>
            </div>
          ))}
        </div>

        <Panel
          title="What the comment sections are arguing about"
          description={digest
            ? 'Distilled from ' + digest.summaries_considered + ' section summaries · updated ' + digest.generated_at
            : undefined}
        >
          {digest ? (
            <p className="p-4 text-[15px] leading-relaxed text-zinc-800 dark:text-zinc-200">
              {digest.digest}
            </p>
          ) : (
            <p className="p-4 text-sm text-zinc-500">
              No digest yet today. It writes itself within half an hour of the
              first comment sections arriving.
            </p>
          )}
        </Panel>

        <Panel
          title="Driving conversation"
          description={'The busiest stories of the last 24 hours, from ' + cloud.postCount + ' posts.'}
        >
          {stories.length === 0 ? (
            <p className="p-4 text-sm text-zinc-500">Nothing has clustered into a story yet today.</p>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
              {stories.map((story, index) => {
                const topPost = story.posts.find((post) => post.id === story.topPostId) ?? null;
                return (
                  <li key={story.id} className="flex items-start gap-3 px-4 py-3">
                    <span className="pb-num mt-0.5 w-5 shrink-0 text-right text-sm font-semibold text-zinc-400">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {topPost?.permalink ? (
                          <a href={topPost.permalink} target="_blank" rel="noreferrer" className="hover:underline">
                            {story.label}
                          </a>
                        ) : story.label}
                      </p>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        {formatInteger(story.totalEngagement)} engagement
                        {' · '}
                        {story.companies.slice(0, 4).map((company) => company.name).join(', ')}
                        {story.companies.length > 4 ? ' +' + (story.companies.length - 4) : ''}
                        {story.brokeBy ? ' · broke by ' + story.brokeBy.name : ''}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {story.platforms.slice(0, 6).map((platform) => (
                          <PlatformDot key={platform} platform={platform} />
                        ))}
                      </div>
                    </div>
                    {topPost?.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={topPost.thumbnailUrl}
                        alt=""
                        className="h-12 w-12 shrink-0 rounded object-cover"
                      />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel
          title="Comment sections worth opening"
          description="The loudest sections summarized in the last 24 hours."
        >
          {sections.length === 0 ? (
            <p className="p-4 text-sm text-zinc-500">
              No sections summarized in this landscape yet. They arrive within
              the hour once posts pass the eligibility window.
            </p>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
              {sections.map((section, index) => (
                <li key={index} className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {section.company}
                    </span>
                    <PlatformDot platform={section.platform} />
                    <span className="pb-num text-xs text-zinc-500">
                      {formatInteger(Number(section.comments) || 0)} comments
                    </span>
                    {section.permalink ? (
                      <a
                        href={section.permalink}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-auto text-xs text-accent-700 hover:underline dark:text-accent-400"
                      >
                        Open post
                      </a>
                    ) : null}
                  </div>
                  <p className="mt-1 text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-400">
                    {section.summary}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>

      </div>
    </PageSection>
  );
}
