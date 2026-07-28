import type { Metadata } from 'next';
import { resolveContext } from '../_lib/context';
import type { SearchParamsInput } from '../_lib/data';
import { OverviewScreen } from '../_components/overview-screen';

export const metadata: Metadata = { title: 'Cross-Channel' };

export default async function CrossChannelPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsInput>;
}) {
  const ctx = await resolveContext(await searchParams);
  return <OverviewScreen ctx={ctx} />;
}
