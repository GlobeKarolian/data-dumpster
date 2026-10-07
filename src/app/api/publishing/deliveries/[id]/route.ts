/** PATCH: edit one account's text, move it to an exact time, send it now, or cancel it (admins). */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { apiHandler } from '@/lib/session';
import { requirePublishingApprover } from '@/lib/publishing/guard';
import { cancelDelivery, editDeliveryText, rescheduleDelivery, retryDelivery } from '@/lib/publishing/service';
import { NO_STORE } from '../../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('reschedule'), at: z.string().datetime() }),
  z.object({ action: z.literal('send_now') }),
  z.object({ action: z.literal('cancel') }),
  z.object({ action: z.literal('edit'), text: z.string().max(5000) }),
  z.object({ action: z.literal('retry') }),
]);

export const PATCH = apiHandler<{ id: string }>(async (req: NextRequest, ctx) => {
  const s = await requirePublishingApprover();
  const id = z.string().uuid().parse((await ctx.params).id);
  const b = body.parse(await req.json());
  if (b.action === 'cancel') await cancelDelivery(s.orgId, id);
  else if (b.action === 'edit') await editDeliveryText(s.orgId, id, b.text);
  else if (b.action === 'retry') return Response.json({ at: await retryDelivery(s.orgId, id) }, NO_STORE);
  else await rescheduleDelivery(s.orgId, id, b.action === 'send_now' ? 'now' : new Date(b.at));
  return Response.json({ ok: true }, NO_STORE);
});
