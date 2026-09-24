import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LeakageTool } from '@/components/leakage/leakage-tool';
import { canUseLeakage } from '@/lib/leakage/access';
import { requireOrg } from '@/lib/session';

export const metadata: Metadata = { title: 'Article Leakage' };

export default async function LeakagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Named-user feature: everyone else sees the ordinary not-found page.
  const session = await requireOrg();
  if (!canUseLeakage(session.email)) notFound();
  const sp = await searchParams;
  const pick = (key: string) => (typeof sp[key] === 'string' ? (sp[key] as string) : '');
  return <LeakageTool initialUrl={pick('url')} initialTerms={pick('terms')} initialRun={pick('run') || undefined} />;
}
