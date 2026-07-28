import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PLATFORM_LABELS, type Platform } from '@/lib/types';
import { NAV_PLATFORMS } from '@/components/shell/nav';
import { resolveContext } from '../_lib/context';
import type { SearchParamsInput } from '../_lib/data';
import { OverviewScreen } from '../_components/overview-screen';

/** Only the platforms with a nav entry get a screen; the rest 404 rather than render an empty shell. */
const SUPPORTED = new Set<string>(NAV_PLATFORMS);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ platform: string }>;
}): Promise<Metadata> {
  const { platform } = await params;
  if (!SUPPORTED.has(platform)) return { title: 'Not found' };
  return { title: PLATFORM_LABELS[platform as Platform] };
}

export default async function PlatformPage({
  params,
  searchParams,
}: {
  params: Promise<{ platform: string }>;
  searchParams: Promise<SearchParamsInput>;
}) {
  const { platform } = await params;
  if (!SUPPORTED.has(platform)) notFound();

  const ctx = await resolveContext(await searchParams);
  return <OverviewScreen ctx={ctx} platform={platform as Platform} />;
}
