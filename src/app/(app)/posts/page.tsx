import type { Metadata } from 'next';
import { Panel } from '@/components/common/panel';
import { NoLandscape } from '@/components/common/no-landscape';
import { PostsExplorer } from '@/components/posts/posts-explorer';
import {
  SocialPostsAnalysis,
  SocialPostsGlance,
} from '@/components/content/social-posts-analysis';
import { CrossChannelTabs } from '@/components/content/cross-channel-tabs';
import type { ContentAnalysis } from '@/lib/metrics/content-analysis';
import { effectiveFocusCompanyId } from '@/lib/analytics-scope';
import { resolveContext } from '../_lib/context';
import { query, tryQuery, type SearchParamsInput } from '../_lib/data';

export const metadata: Metadata = { title: 'Social Posts' };

type TagRecord = { id: string; name: string; color: string | null }

export default async function PostsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsInput>;
}) {
  const ctx = await resolveContext(await searchParams);
  if (!ctx.landscape) return <NoLandscape reason={ctx.error} />;

  const [tags, analysisResult] = await Promise.all([
    query<TagRecord>(({ sql }) => sql`
      SELECT id, name, color
        FROM post_tags
       WHERE org_id = ${ctx.orgId}::uuid
       ORDER BY name ASC
    `),
    tryQuery<ContentAnalysis | null>(async () => {
      const { getContentAnalysis } = await import('@/lib/metrics/content-analysis');
      return getContentAnalysis({
        landscapeId: ctx.landscape!.id,
        orgId: ctx.orgId,
        start: ctx.range.start,
        end: ctx.range.end,
        platforms: ctx.platforms.length > 0 ? ctx.platforms : undefined,
        companyIds: ctx.companyIds.length > 0 ? ctx.companyIds : undefined,
        postTypes: ctx.postTypes.length > 0 ? ctx.postTypes : undefined,
        tagIds: ctx.tagIds.length > 0 ? ctx.tagIds : undefined,
        search: ctx.search || undefined,
      });
    }, null),
  ]);

  const analysis = analysisResult.data;
  const filteredFocusId = effectiveFocusCompanyId(ctx.focusCompanyId, ctx.companyIds);
  const focusName =
    ctx.companies.find((company) => company.id === filteredFocusId)?.name
    ?? analysis?.focusCompanyName
    ?? null;
  const platform = ctx.platforms.length === 1 ? ctx.platforms[0] : undefined;

  return (
    <div className="space-y-4">
      <CrossChannelTabs />

      <PostsExplorer
        landscapeId={ctx.landscape.id}
        tags={tags.data}
        summary={
          analysis && analysis.totalPosts > 0 ? (
            <SocialPostsGlance analysis={analysis} focusName={focusName} platform={platform} />
          ) : null
        }
      />

      {analysis ? (
        <SocialPostsAnalysis
          analysis={analysis}
          focusName={focusName}
          platform={platform}
          searchParams={ctx.searchParams.toString()}
        />
      ) : (
        <Panel title="Could not load analysis" error={analysisResult.error}><span /></Panel>
      )}
    </div>
  );
}
