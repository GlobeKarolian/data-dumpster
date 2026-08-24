import type { Metadata } from 'next';
import * as React from 'react';
import { ExternalLink, UsersRound } from 'lucide-react';
import { PageSection } from '@/components/shell/page-section';
import { Panel } from '@/components/common/panel';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';
import { StatTile } from '@/components/ui/stat-tile';
import { HeatmapGrid } from '@/components/charts/heatmap-grid';
import { TimeSeriesChart } from '@/components/charts/time-series-chart';
import type { TimeSeriesPoint } from '@/lib/types';
import { roleAtLeast } from '@/lib/roles';
import { compactNumber } from '@/lib/utils';
import {
  watchedGroups, groupDiscussions, sharedDomains, groupIdentitiesVisible, ownedDomains,
  groupHeadline, groupTrend, groupTopPosts, groupCadence, ourLinkShare,
} from '@/lib/groups/queries';
import { GroupManager } from '@/components/groups/group-manager';
import { resolveContext } from '../_lib/context';
import { type SearchParamsInput } from '../_lib/data';

export const metadata: Metadata = { title: 'Group View' };
export const dynamic = 'force-dynamic';

const ACCENT = '#B72B35';

/**
 * A tile for a count that has no entry in the metric contract, so it cannot
 * borrow another metric's definition tooltip. Same shell as StatTile; the
 * explanation is written out instead of looked up.
 */
function PlainTile({ label, value, footnote }: {
  label: string; value: string; footnote?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
      <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="pb-num text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {value}
        </span>
      </div>
      {footnote ? (
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-500">{footnote}</p>
      ) : null}
      <div className="mt-3 flex-1">
        <div className="flex h-10 items-center" aria-hidden>
          <div className="h-px w-full bg-zinc-200 dark:bg-zinc-800" />
        </div>
      </div>
    </div>
  );
}

function Bars({ rows }: {
  rows: { key: string; label: React.ReactNode; title: string; value: number; color?: string }[];
}) {
  const max = rows.reduce((m, r) => (r.value > m ? r.value : m), 0) || 1;
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.key} className="flex items-center gap-3 text-sm">
          <span className="w-40 shrink-0 truncate text-zinc-800 dark:text-zinc-200" title={r.title}>
            {r.label}
          </span>
          <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
            <span
              className="block h-full rounded-full"
              style={{
                width: Math.max(2, (r.value / max) * 100) + '%',
                backgroundColor: r.color ?? ACCENT,
              }}
            />
          </span>
          <span className="pb-num w-12 shrink-0 text-right text-xs tabular-nums text-zinc-500">
            {compactNumber(r.value)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default async function GroupsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsInput>;
}) {
  // Group View used to hardcode 14 and 30 day windows and ignore the date
  // picker entirely, so the toolbar lied on this screen alone. Every read below
  // takes the same window as the rest of the product. Groups are org-scoped
  // rather than landscape-scoped, so this screen does not require a landscape.
  const ctx = await resolveContext(await searchParams);
  const { orgId, role } = ctx;
  const canManage = roleAtLeast(role, 'editor');
  const identitiesVisible = groupIdentitiesVisible(role);
  const w = { start: ctx.range.start, end: ctx.range.end };

  const owned = await ownedDomains(orgId);
  const [head, trend, groups, discussions, domains, linkShare, topPosts, cadence] =
    await Promise.all([
      groupHeadline(orgId, w),
      groupTrend(orgId, w),
      watchedGroups(orgId, w),
      groupDiscussions(orgId, w),
      sharedDomains(orgId, w, owned),
      ourLinkShare(orgId, w, owned),
      groupTopPosts(orgId, w, identitiesVisible),
      groupCadence(orgId, w),
    ]);

  const hasGroups = groups.length > 0;
  const hasPosts = head.posts > 0;
  const series: TimeSeriesPoint[] = trend.map((p) => ({
    date: p.date, posts: p.posts, engagement: p.engagement,
  }));
  const postsSpark = trend.map((p) => ({ date: p.date, value: p.posts }));
  const engagementSpark = trend.map((p) => ({ date: p.date, value: p.engagement }));
  const topGroupPosts = groups[0]?.posts || 1;

  return (
    <div className="space-y-4">
      <PageSection
        title="Group View"
        description="What Greater Boston's public Facebook groups are discussing, and whose links travel into them. Public groups only; a members-only group is marked as not collectible rather than worked around."
      >
        {!hasGroups ? (
          <Panel title="No groups yet">
            <EmptyState
              compact
              icon={UsersRound}
              title="Add a public group to start"
              description="Paste a public Facebook group URL below. The collector picks it up on its next run, and the group's discussion and link-sharing show up here."
            />
          </Panel>
        ) : !hasPosts ? (
          <Panel title="Nothing in this window">
            <EmptyState
              compact
              icon={UsersRound}
              title="No group posts in the selected dates"
              description="Widen the date range in the top bar. Collection runs on its own schedule, so the newest days can lag behind by a day or two."
            />
          </Panel>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile
                metric="posts"
                label="Group posts"
                value={head.posts}
                changePct={head.postsChangePct}
                spark={postsSpark}
                color={ACCENT}
                footnote={head.activeGroups + ' of ' + groups.length
                  + (groups.length === 1 ? ' group' : ' groups') + ' active'}
              />
              <StatTile
                metric="engagementTotal"
                value={head.engagement}
                changePct={head.engagementChangePct}
                spark={engagementSpark}
                color={ACCENT}
                footnote="Reactions, comments and shares on group posts"
              />
              <StatTile
                metric="engagementPerPost"
                value={head.engagementPerPost}
                color={ACCENT}
                footnote="What a typical post in these communities earns"
              />
              <PlainTile
                label="Distinct voices"
                value={compactNumber(head.voices)}
                footnote={identitiesVisible
                  ? 'Separate accounts that posted in this window.'
                  : 'Separate accounts that posted in this window. Counted, never named on this screen.'}
              />
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <Panel
                title="Posting volume"
                metric="posts"
                description="Posts per day across every watched group."
              >
                <TimeSeriesChart
                  data={series}
                  series={[{ key: 'posts', label: 'Group posts', color: ACCENT, emphasis: true }]}
                  metric="posts"
                  granularity="day"
                  emptyHint="No group posts in this window."
                />
              </Panel>
              <Panel
                title="Engagement"
                metric="engagementTotal"
                description="Reactions, comments and shares per day."
              >
                <TimeSeriesChart
                  data={series}
                  series={[{ key: 'engagement', label: 'Engagement', color: '#0F766E', emphasis: true }]}
                  metric="engagementTotal"
                  granularity="day"
                  emptyHint="No engagement recorded in this window."
                />
              </Panel>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <Panel
                title="What the groups are discussing"
                description="Classified by the same model that reads our own posts, against the same taxonomy."
                note={discussions.length === 0
                  ? undefined
                  : 'Top ' + discussions.length + ' subjects by number of group posts.'}
              >
                {discussions.length === 0 ? (
                  <p className="px-1 py-2 text-xs leading-relaxed text-zinc-500">
                    No classified group posts in this window yet. Subjects appear here as the
                    tagging pipeline works through the backlog.
                  </p>
                ) : (
                  <Bars
                    rows={discussions.map((d) => ({
                      key: d.tagId,
                      title: d.tagName,
                      value: d.posts,
                      color: d.color ?? ACCENT,
                      label: (
                        <span className="inline-flex min-w-0 items-center gap-2">
                          <span
                            aria-hidden
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: d.color ?? ACCENT }}
                          />
                          <span className="truncate">{d.tagName}</span>
                        </span>
                      ),
                    }))}
                  />
                )}
              </Panel>

              <Panel
                title="Whose links travel"
                description="Domains shared into these groups. Attachment CDNs are excluded, because those are media rather than shared links."
                note={linkShare.sharePct === null
                  ? 'Declare your own domains in org settings and this panel will also show your share.'
                  : 'Your domains are ' + linkShare.sharePct.toFixed(1) + '% of the '
                    + compactNumber(linkShare.totalLinks) + ' links shared in this window, '
                    + compactNumber(linkShare.ourLinks) + ' of them.'}
              >
                {domains.length === 0 ? (
                  <p className="px-1 py-2 text-xs text-zinc-500">
                    No links shared into watched groups in this window.
                  </p>
                ) : (
                  <Bars
                    rows={domains.slice(0, 12).map((d) => ({
                      key: d.domain,
                      title: d.domain,
                      value: d.shares,
                      color: d.isOwned ? '#047857' : '#A1A1AA',
                      label: (
                        <span className="inline-flex min-w-0 items-center gap-1.5">
                          <span className="truncate">{d.domain}</span>
                          {d.isOwned ? <Badge tone="positive">OURS</Badge> : null}
                        </span>
                      ),
                    }))}
                  />
                )}
              </Panel>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-5">
              <Panel
                className="lg:col-span-3"
                title="Which communities are alive"
                description="Every watched group in this window, ordered by volume."
                bodyClassName="p-0"
              >
                <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                  {groups.map((g) => (
                    <li key={g.id} className="px-4 py-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <span className="inline-flex min-w-0 items-baseline gap-2">
                          <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                            {g.name}
                          </span>
                          {g.area ? (
                            <span className="shrink-0 text-[11px] text-zinc-400">{g.area}</span>
                          ) : null}
                        </span>
                        <span className="pb-num shrink-0 text-[11px] tabular-nums text-zinc-500">
                          {compactNumber(g.posts) + ' posts · '
                            + compactNumber(g.engagement) + ' engagement · '
                            + compactNumber(g.voices) + ' voices'
                            + (g.engagementPerPost === null
                              ? ''
                              : ' · ' + g.engagementPerPost.toFixed(1) + ' per post')}
                        </span>
                      </div>
                      <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                        <span
                          className="block h-full rounded-full"
                          style={{
                            width: Math.max(1, (g.posts / topGroupPosts) * 100) + '%',
                            backgroundColor: ACCENT,
                          }}
                        />
                      </span>
                    </li>
                  ))}
                </ul>
              </Panel>

              <Panel
                className="lg:col-span-2"
                title="When these communities talk"
                description="Seven days by twenty-four hours, Eastern, by post volume."
              >
                <HeatmapGrid cells={cadence} color={ACCENT} />
              </Panel>
            </div>

            <div className="mt-4">
              <Panel
                title="Posts driving the conversation"
                description="Highest engagement in this window, across every watched group."
                note={identitiesVisible
                  ? 'Author names are shown because you are an admin and this deployment has identity display switched on.'
                  : 'Author identities are collected but never displayed here.'}
                bodyClassName="p-0"
              >
                {topPosts.length === 0 ? (
                  <p className="px-4 py-6 text-center text-xs text-zinc-500">
                    No group posts with text in this window.
                  </p>
                ) : (
                  <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                    {topPosts.map((post) => (
                      <li key={post.id} className="flex gap-3 px-4 py-3">
                        <span className="pb-num w-14 shrink-0 pt-0.5 text-right text-sm font-semibold tabular-nums text-accent-700 dark:text-accent-400">
                          {compactNumber(post.engagement)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">
                            {post.content}
                          </p>
                          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-zinc-500">
                            <span className="font-medium text-zinc-600 dark:text-zinc-400">
                              {post.groupName}
                            </span>
                            {post.authorName ? <span>{post.authorName}</span> : null}
                            {post.postedAt ? (
                              <span className="pb-num tabular-nums">
                                {new Date(post.postedAt).toLocaleDateString('en-US', {
                                  month: 'short', day: 'numeric',
                                })}
                              </span>
                            ) : null}
                            <span className="pb-num tabular-nums">
                              {compactNumber(post.likes) + ' reactions · '
                                + compactNumber(post.comments) + ' comments · '
                                + compactNumber(post.shares) + ' shares'}
                            </span>
                            {post.tags.map((tag) => (
                              <Badge key={tag.id} tone="outline">{tag.name}</Badge>
                            ))}
                          </p>
                        </div>
                        {post.permalink ? (
                          <a
                            href={post.permalink}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="shrink-0 self-start pt-1 text-zinc-400 transition-colors hover:text-zinc-700 dark:hover:text-zinc-200"
                            aria-label={'Open this post from ' + post.groupName + ' on Facebook'}
                          >
                            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                          </a>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>
          </>
        )}
      </PageSection>

      <PageSection
        title="Watched groups"
        description={
          groups.length + (groups.length === 1 ? ' group' : ' groups')
          + '. Post counts here are for the window selected in the top bar.'
        }
      >
        <Panel title="Groups" bodyClassName="p-0">
          <GroupManager
            groups={groups.map((g) => ({
              id: g.id,
              name: g.name,
              area: g.area,
              url: g.url,
              active: g.active,
              postsInWindow: g.posts,
              lastCollectedAt: g.lastCollectedAt,
              outcome: g.outcome,
            }))}
            canManage={canManage}
          />
        </Panel>
      </PageSection>
    </div>
  );
}
