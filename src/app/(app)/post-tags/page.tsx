import type { Metadata } from 'next';
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

export default async function PostTagsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsInput>;
}) {
  const ctx = await resolveContext(await searchParams);
  if (!ctx.landscape) return <NoLandscape reason={ctx.error} />;
  const canManageTags = roleAtLeast(ctx.role, 'editor');

  const [performance, tags] = await Promise.all([
    loadTagPerformance(analyticsQuery(ctx)),
    canManageTags
      ? query<TagRow>(({ sql }) => sql`
          SELECT id, name, color, rule, ai_prompt
            FROM post_tags
           WHERE org_id = ${ctx.orgId}::uuid
           ORDER BY name ASC
        `)
      : Promise.resolve({ data: [] as TagRow[], error: null }),
  ]);

  return (
    <div className="space-y-6">
      <CrossChannelTabs />
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
