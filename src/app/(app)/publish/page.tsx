import type { Metadata } from 'next';
import { PublishWorkspace } from '@/components/publishing/workspace';
import { publishingPageContext } from './_gate';

export const metadata: Metadata = { title: 'Compose & Queue' };

export default async function PublishPage() {
  const { me, live } = await publishingPageContext();
  return <PublishWorkspace live={live} me={me} />;
}
