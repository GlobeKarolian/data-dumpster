import type { Metadata } from 'next';
import { LeakageTool } from '@/components/leakage/leakage-tool';

export const metadata: Metadata = { title: 'Article Leakage' };

export default async function LeakagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const pick = (key: string) => (typeof sp[key] === 'string' ? (sp[key] as string) : '');
  return <LeakageTool initialUrl={pick('url')} initialTerms={pick('terms')} />;
}
