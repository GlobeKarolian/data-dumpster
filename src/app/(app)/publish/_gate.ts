import 'server-only';
import { notFound } from 'next/navigation';
import { requireOrg } from '@/lib/session';
import { canApprovePublishing, canUsePublishing, publishingLive } from '@/lib/publishing/access';

/** Named-user feature: everyone else sees the ordinary not-found page. */
export async function publishingPageContext() {
  const session = await requireOrg();
  if (!canUsePublishing(session.email)) notFound();
  return { me: session.email, canApprove: canApprovePublishing(session.role), live: publishingLive() };
}
