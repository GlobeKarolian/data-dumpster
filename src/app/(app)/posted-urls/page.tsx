import type { Metadata } from 'next';
import { NoLandscape } from '@/components/common/no-landscape';
import { UrlView } from '@/components/urls/url-view';
import { analyticsQuery, resolveContext } from '../_lib/context';
import { loadPostedUrls, type SearchParamsInput } from '../_lib/data';

export const metadata: Metadata = { title: 'Posted URLs' };

export default async function PostedUrlsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsInput>;
}) {
  const resolved = await searchParams;
  const ctx = await resolveContext(resolved);
  if (!ctx.landscape) return <NoLandscape reason={ctx.error} />;

  const groupBy = resolved.groupBy === 'url' ? 'url' : 'domain';
  const urls = await loadPostedUrls({ ...analyticsQuery(ctx), groupBy });

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
        Social posts are a distribution channel, and the link is the point of it. This screen answers
        where each brand is actually sending readers — their own site, a wire service, a rival, or a
        platform-native destination that sends no traffic at all.
      </p>
      <UrlView rows={urls.data} groupBy={groupBy} error={urls.error} />
    </div>
  );
}
