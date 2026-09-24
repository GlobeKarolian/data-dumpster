import 'server-only';
import { HttpError, requireOrg } from '@/lib/session';
import { canUseLeakage } from './access';

/** Every Article Leakage endpoint answers 404 to anyone outside the allowlist. */
export async function requireLeakageUser() {
  const session = await requireOrg();
  if (!canUseLeakage(session.email)) throw new HttpError(404, 'Not found.', 'not_found');
  return session;
}
