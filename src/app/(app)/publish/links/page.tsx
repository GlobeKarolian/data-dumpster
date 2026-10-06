import type { Metadata } from 'next';
import { LinkInBio } from '@/components/publishing/link-in-bio';
import { publishingPageContext } from '../_gate';

export const metadata: Metadata = { title: 'Link in Bio' };

export default async function PublishLinksPage() {
  const { canApprove } = await publishingPageContext();
  return <LinkInBio canApprove={canApprove} />;
}
