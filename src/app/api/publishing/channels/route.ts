/** GET: tracked channels a publishing account can learn its best hours from. */
import { apiHandler } from '@/lib/session';
import { requirePublishingUser } from '@/lib/publishing/guard';
import { listLinkableChannels } from '@/lib/publishing/store';
import { NO_STORE } from '../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = apiHandler(async () => {
  const s = await requirePublishingUser();
  return Response.json({ channels: await listLinkableChannels(s.orgId) }, NO_STORE);
});
