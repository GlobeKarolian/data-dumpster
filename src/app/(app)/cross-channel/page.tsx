import type { Metadata } from 'next';
import { resolveContext } from '../_lib/context';
import type { SearchParamsInput } from '../_lib/data';
import { OverviewScreen } from '../_components/overview-screen';
import { CrossChannelTabs } from '@/components/content/cross-channel-tabs';

export const metadata: Metadata = { title: 'Cross-Channel' };

export default async function CrossChannelPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsInput>;
}) {
  const ctx = await resolveContext(await searchParams);
  return (
    <div className="min-w-0 max-w-full space-y-5">
      <CrossChannelTabs />
      <OverviewScreen ctx={ctx} />
    </div>
  );
}
