import type { Metadata } from 'next';
import { PublishingSettings } from '@/components/publishing/settings';

export const metadata: Metadata = { title: 'Accounts' };

export default function PublishAccountsPage() {
  return <PublishingSettings section="accounts" />;
}
