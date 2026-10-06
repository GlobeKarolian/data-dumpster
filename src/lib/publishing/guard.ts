import 'server-only';
import { HttpError, requireOrg } from '@/lib/session';
import { canApprovePublishing, canUsePublishing } from './access';

/** Every publishing endpoint answers 404 to anyone outside the allowlist. */
export async function requirePublishingUser() {
  const session = await requireOrg();
  if (!canUsePublishing(session.email)) throw new HttpError(404, 'Not found.', 'not_found');
  return { ...session, canApprove: canApprovePublishing(session.role) };
}

export async function requirePublishingApprover() {
  const session = await requirePublishingUser();
  if (!session.canApprove) {
    throw new HttpError(403, 'Only admins can approve or change publishing settings.', 'forbidden');
  }
  return session;
}
