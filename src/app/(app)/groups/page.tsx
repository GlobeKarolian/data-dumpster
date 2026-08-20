import type { Metadata } from 'next';
import { UsersRound } from 'lucide-react';
import { PageSection } from '@/components/shell/page-section';
import { Panel } from '@/components/common/panel';
import { EmptyState } from '@/components/ui/empty-state';
import { requireOrg } from '@/lib/session';
import { roleAtLeast } from '@/lib/roles';
import {
  watchedGroups, groupDiscussions, sharedDomains, groupIdentitiesVisible,
} from '@/lib/groups/queries';
import { GroupManager } from '@/components/groups/group-manager';
import { query, type SearchParamsInput } from '../_lib/data';

export const metadata: Metadata = { title: 'Group View' };
export const dynamic = 'force-dynamic';

function compact(n: number): string {
  return n >= 1000 ? (n / 1000).toFixed(n >= 10_000 ? 0 : 1) + 'k' : String(n);
}

export default async function GroupsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsInput>;
}) {
  void searchParams;
  const { orgId, role } = await requireOrg();
  const canManage = roleAtLeast(role, 'editor');

  // Our own domains, so the distribution table can mark which shared links are
  // ours. Derived from the org's own companies' posted URLs, not hard-coded.
  const owned = await query<{ domain: string }>(({ sql }) => sql`
    SELECT DISTINCT lower(u.domain) AS domain
      FROM posted_urls u JOIN posts p ON p.id = u.post_id
      JOIN companies c ON c.id = p.company_id AND c.org_id = ${orgId}::uuid
     WHERE u.domain IS NOT NULL LIMIT 200`);
  const ownedDomains = owned.data.map((r) => r.domain);

  const [groups, discussions, domains] = await Promise.all([
    watchedGroups(orgId),
    groupDiscussions(orgId, 14),
    sharedDomains(orgId, 14, ownedDomains),
  ]);

  const identitiesVisible = groupIdentitiesVisible(role);
  const totalPosts = groups.reduce((s, g) => s + g.posts30d, 0);

  return (
    <div className="space-y-6">
      <PageSection
        title="Group View"
        description="What Greater Boston's public Facebook groups are discussing, and whose links travel into them. Public groups only; a members-only group is marked ineligible rather than collected."
      >
        {groups.length === 0 ? (
          <Panel title="No groups yet">
            <EmptyState
              compact
              icon={UsersRound}
              title="Add a public group to start"
              description="Paste a public Facebook group URL below. The collector picks it up on the next run and its discussion and link-sharing show up here."
            />
          </Panel>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="What groups are discussing" description="Last 14 days, by tag.">
              {discussions.length === 0 ? (
                <p className="px-1 py-2 text-xs text-zinc-500">
                  Group posts are tagged by the same pipeline as everything else; discussion topics
                  appear here once tagging has read them.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {discussions.map((d) => (
                    <li key={d.tagName} className="flex items-center justify-between gap-3 px-1 py-1 text-sm">
                      <span className="inline-flex items-center gap-2">
                        <span aria-hidden className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: d.color ?? '#71717a' }} />
                        <span className="text-zinc-800 dark:text-zinc-200">{d.tagName}</span>
                      </span>
                      <span className="pb-num tabular-nums text-zinc-500">{compact(d.posts)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel
              title="Whose links travel"
              description="Domains shared into these groups, last 14 days. Yours are marked."
            >
              {domains.length === 0 ? (
                <p className="px-1 py-2 text-xs text-zinc-500">No links shared into watched groups yet.</p>
              ) : (
                <ul className="space-y-1.5">
                  {domains.slice(0, 14).map((d) => (
                    <li key={d.domain} className="flex items-center justify-between gap-3 px-1 py-1 text-sm">
                      <span className="truncate text-zinc-800 dark:text-zinc-200">
                        {d.domain}
                        {d.isOwned ? (
                          <span className="ml-2 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                            OURS
                          </span>
                        ) : null}
                      </span>
                      <span className="pb-num tabular-nums text-zinc-500">{compact(d.shares)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        )}
      </PageSection>

      <PageSection
        title="Watched groups"
        description={
          `${groups.length} group${groups.length === 1 ? '' : 's'}, ${compact(totalPosts)} posts collected in the last 30 days.`
          + (identitiesVisible
            ? ' Author identities are visible to you.'
            : ' Author identities are collected but not displayed.')
        }
      >
        <Panel title="Groups" bodyClassName="p-0">
          <GroupManager
            groups={groups.map((g) => ({
              id: g.id, name: g.name, area: g.area, url: g.url,
              active: g.active, posts30d: g.posts30d,
              lastCollectedAt: g.lastCollectedAt, outcome: g.outcome,
            }))}
            canManage={canManage}
          />
        </Panel>
      </PageSection>
    </div>
  );
}
