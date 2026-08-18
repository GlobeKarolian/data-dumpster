import type { Metadata } from 'next';
import Link from 'next/link';
import { PageSection } from '@/components/shell/page-section';
import { Panel } from '@/components/common/panel';
import { NoLandscape } from '@/components/common/no-landscape';
import { TagPerformanceTable } from '@/components/tags/tag-performance-table';
import { TagManager, type TagRecord } from '@/components/tags/tag-manager';
import { analyticsQuery, resolveContext } from '../_lib/context';
import { loadTagPerformance, query, type SearchParamsInput } from '../_lib/data';
import { CrossChannelTabs } from '@/components/content/cross-channel-tabs';
import { roleAtLeast } from '@/lib/roles';

export const metadata: Metadata = { title: 'Post Tags' };

type TagRow = {
  id: string;
  name: string;
  color: string | null;
  rule: TagRecord['rule'];
  ai_prompt: string | null;
}

type AiStatusRow = {
  posts_read: string | number;
  read_last_hour: string | number;
  in_flight: string | number;
  awaiting_retry: string | number;
  ai_assignments: string | number;
  spend_today_usd: string | number;
};

type ProposalRow = {
  verdict: string;
  label_norm: string;
  name: string | null;
  rationale: string | null;
  support_posts: number;
  support_companies: number;
  covered_by_name: string | null;
  created_tag_id: string | null;
  created_at: string;
};

type SuggestionBacklogRow = { open_labels: string | number; open_sightings: string | number };

const VERDICT_TONE: Record<string, string> = {
  created: 'text-emerald-700 dark:text-emerald-400',
  covered: 'text-zinc-500',
  rejected: 'text-zinc-400',
  queued: 'text-amber-700 dark:text-amber-400',
};

function StatusFigure({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-28">
      <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="pb-num mt-0.5 text-lg font-semibold text-zinc-900 dark:text-zinc-100">{value}</p>
    </div>
  );
}

export default async function PostTagsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsInput>;
}) {
  const ctx = await resolveContext(await searchParams);
  if (!ctx.landscape) return <NoLandscape reason={ctx.error} />;
  const canManageTags = roleAtLeast(ctx.role, 'editor');

  const [performance, tags, proposals, backlog, aiStatus] = await Promise.all([
    loadTagPerformance(analyticsQuery(ctx)),
    canManageTags
      ? query<TagRow>(({ sql }) => sql`
          SELECT id, name, color, rule, ai_prompt
            FROM post_tags
           WHERE org_id = ${ctx.orgId}::uuid
           ORDER BY name ASC
        `)
      : Promise.resolve({ data: [] as TagRow[], error: null }),
    query<ProposalRow>(({ sql }) => sql`
      SELECT pr.verdict, pr.label_norm, pr.name, pr.rationale,
             pr.support_posts, pr.support_companies,
             ct.name AS covered_by_name,
             pr.created_tag_id::text AS created_tag_id,
             pr.created_at::text AS created_at
        FROM tag_proposals pr
        LEFT JOIN post_tags ct ON ct.id = pr.covered_by_tag_id
       WHERE pr.org_id = ${ctx.orgId}::uuid
         AND pr.created_at > now() - interval '14 days'
       ORDER BY pr.created_at DESC
       LIMIT 12
    `),
    query<SuggestionBacklogRow>(({ sql }) => sql`
      SELECT count(DISTINCT label_norm) AS open_labels, count(*) AS open_sightings
        FROM tag_suggestions
       WHERE org_id = ${ctx.orgId}::uuid AND status = 'open'
    `),
    query<AiStatusRow>(({ sql }) => sql`
      SELECT
        (SELECT count(*) FROM ai_tag_state
          WHERE org_id = ${ctx.orgId}::uuid AND status = 'succeeded') AS posts_read,
        (SELECT count(*) FROM ai_tag_state
          WHERE org_id = ${ctx.orgId}::uuid AND status = 'succeeded'
            AND tagged_at > now() - interval '1 hour') AS read_last_hour,
        (SELECT count(*) FROM ai_tag_state
          WHERE org_id = ${ctx.orgId}::uuid AND status = 'running'
            AND next_attempt_at > now()) AS in_flight,
        (SELECT count(*) FROM ai_tag_state
          WHERE org_id = ${ctx.orgId}::uuid AND status = 'failed') AS awaiting_retry,
        (SELECT count(*) FROM post_tag_assignments a
          JOIN post_tags t ON t.id = a.tag_id
          WHERE t.org_id = ${ctx.orgId}::uuid AND a.source = 'ai') AS ai_assignments,
        (SELECT coalesce(sum(cost_usd), 0) FROM ai_usage
          WHERE org_id = ${ctx.orgId}::uuid AND feature = 'post-tagging'
            AND created_at >= date_trunc('day', now())) AS spend_today_usd
    `),
  ]);
  const status = aiStatus.data?.[0];

  return (
    <div className="space-y-6">
      <CrossChannelTabs />
      {/*
        * The tagging pipeline was invisible: the model read thousands of posts
        * and the only evidence was counts quietly changing. This strip is the
        * window — reads, throughput, retries and today's spend, straight from
        * the queue and usage tables. Refresh to update; numbers move whenever
        * the ten-minute cron or a backfill is working.
        */}
      {status ? (
        <PageSection
          title="AI tagging activity"
          description="The model reads every post in scope once, and re-reads when a tag's definition or scope changes. Refresh for current numbers."
          actions={(
            <Link
              href="/post-tags/live"
              prefetch={false}
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
              </span>
              Watch live
            </Link>
          )}
        >
          <Panel title="Pipeline" error={aiStatus.error}>
            <div className="flex flex-wrap gap-x-8 gap-y-3 px-1 py-1">
              <StatusFigure label="Posts read" value={Number(status.posts_read).toLocaleString()} />
              <StatusFigure label="Last hour" value={Number(status.read_last_hour).toLocaleString()} />
              <StatusFigure label="In flight" value={Number(status.in_flight).toLocaleString()} />
              <StatusFigure label="Awaiting retry" value={Number(status.awaiting_retry).toLocaleString()} />
              <StatusFigure label="Tags applied" value={Number(status.ai_assignments).toLocaleString()} />
              <StatusFigure label="Spend today" value={'$' + Number(status.spend_today_usd).toFixed(2)} />
            </div>
          </Panel>
        </PageSection>
      ) : null}
      {/*
        * The vocabulary governs itself in public. The tagger flags topics the
        * taxonomy has no word for; the curator model rules on each with the
        * evidence shown here. Nothing in this panel is an assignment — it is
        * the audit trail of how the tag list came to be what it is.
        */}
      {proposals.data.length > 0 || Number(backlog.data[0]?.open_labels ?? 0) > 0 ? (
        <PageSection
          title="Vocabulary curation"
          description={
            'The tagging model suggests topics it has no tag for; a stronger model rules on each once '
            + 'enough evidence accumulates. Created tags start applying automatically and can be retired '
            + 'by clearing their description. Open backlog: '
            + Number(backlog.data[0]?.open_labels ?? 0).toLocaleString() + ' topics across '
            + Number(backlog.data[0]?.open_sightings ?? 0).toLocaleString() + ' sightings.'
          }
        >
          <Panel title="Recent rulings" error={proposals.error}>
            {proposals.data.length === 0 ? (
              <p className="px-1 py-2 text-xs text-zinc-500">
                No rulings yet. The curator waits for a topic to be suggested on several posts
                across several outlets before spending a judgment on it.
              </p>
            ) : (
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                {proposals.data.map((p, i) => (
                  <li key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-1 py-2 text-xs">
                    <span className={'font-semibold uppercase tracking-wide ' + (VERDICT_TONE[p.verdict] ?? 'text-zinc-500')}>
                      {p.verdict}
                    </span>
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      {p.name ?? p.label_norm}
                    </span>
                    {p.verdict === 'covered' && p.covered_by_name ? (
                      <span className="text-zinc-500">→ {p.covered_by_name}</span>
                    ) : null}
                    <span className="text-zinc-400">
                      {p.support_posts} posts · {p.support_companies} outlets
                    </span>
                    {p.rationale ? (
                      <span className="w-full text-zinc-500 sm:w-auto sm:flex-1">{p.rationale}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </PageSection>
      ) : null}

      <PageSection
        title="Tag performance"
        description="What each tag earned in this window, and whether posts carrying it beat the same brand’s own average. Lift is the column that matters: a tag can carry a lot of engagement simply because it is applied to a lot of posts."
      >
        <Panel title="Tags in this window" error={performance.error} bodyClassName="p-0">
          <TagPerformanceTable rows={performance.data} />
        </Panel>
      </PageSection>

      {canManageTags ? (
        <PageSection
          title="Manage tags"
          description="A tag is either a deterministic keyword rule or a prompt run against your own model. Rules are free and auditable; prompts catch the cases a keyword list never will."
        >
          {tags.error ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
              {'Tag definitions could not be read: ' + tags.error}
            </p>
          ) : (
            <TagManager
              tags={tags.data.map((t) => ({
                id: t.id,
                name: t.name,
                color: t.color,
                rule: t.rule,
                aiPrompt: t.ai_prompt,
              }))}
            />
          )}
        </PageSection>
      ) : null}
    </div>
  );
}
