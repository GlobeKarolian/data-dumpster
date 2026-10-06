import type { Metadata } from 'next';
import { LinkInBioPage } from '@/components/publishing/link-in-bio';

export const metadata: Metadata = { title: 'Link in Bio' };

export default function PublishLinksPage() {
  return <LinkInBioPage />;
}
