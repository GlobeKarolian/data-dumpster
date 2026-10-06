import type { Metadata } from 'next';
import { PublishShell } from '@/components/publishing/shell';
import { publishingPageContext } from './_gate';

export const metadata: Metadata = { title: { default: 'Publish', template: '%s · Publish' } };

export default async function PublishLayout({ children }: { children: React.ReactNode }) {
  const { me, canApprove, live } = await publishingPageContext();
  return <PublishShell live={live} canApprove={canApprove} me={me}>{children}</PublishShell>;
}
