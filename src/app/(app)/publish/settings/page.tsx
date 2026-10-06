import type { Metadata } from 'next';
import { PublishingSettings } from '@/components/publishing/settings';
import { publishingPageContext } from '../_gate';

export const metadata: Metadata = { title: 'Publishing Accounts & Feeds' };

export default async function PublishSettingsPage() {
  const { live, canApprove } = await publishingPageContext();
  return <PublishingSettings live={live} canApprove={canApprove} />;
}
