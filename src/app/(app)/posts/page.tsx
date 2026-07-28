import type { Metadata } from 'next';
import { PLATFORMS } from '@/lib/types';
import { Panel } from '@/components/common/panel';
import { NoLandscape } from '@/components/common/no-landscape';
import { ScatterPlot } from '@/components/charts/scatter-plot';
import { PostsExplorer } from '@/components/posts/posts-explorer';
import { analyticsQuery, resolveContext } from '../_lib/context';
import { loadPosts, query, type SearchParamsInput } from '../_lib/data';

export const metadata: Metadata = { title: 'Social Posts' };

type TagRecord = { id: string; name: string; color: string | null }

export default async function PostsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsInput>;
}) {
  const ctx = await resolveContext(await searchParams);
  if (!ctx.landscape) return <NoLandscape reason={ctx.error} />;

  const base = analyticsQuery(ctx);
  const [tags, scatter] = await Promise.all([
    query<TagRecord>(({ sql }) => sql`
      SELECT id, name, color
        FROM post_tags
       WHERE org_id = ${ctx.orgId}::uuid
       ORDER BY name ASC
    `),
    loadPosts({ ...base, sort: 'engagementTotal', direction: 'desc', page: 1, pageSize: 200 }),
  ]);

  return (
    <div className="space-y-4">
      <Panel
        title="Every post in the window"
        description="Time along the bottom, engagement up the side, bubble size is the audience the account had when it published. A large bubble low down is a big account that missed."
        error={scatter.error}
        note="Engagement is plotted on a log scale because social reaction is heavily skewed; a linear axis would flatten everything except the outliers."
      >
        <ScatterPlot posts={scatter.data.items} logScale />
      </Panel>

      <PostsExplorer
        landscapeId={ctx.landscape.id}
        companies={ctx.companies.map((c) => ({ id: c.id, name: c.name, color: c.color }))}
        tags={tags.data}
        availablePlatforms={[...PLATFORMS]}
      />
    </div>
  );
}
