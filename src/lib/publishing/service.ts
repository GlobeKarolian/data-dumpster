import 'server-only';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { HttpError } from '@/lib/session';
import { PUBLISH_PLATFORMS, TEXT_LIMITS, chargedLength, finalText, linkModeFor, type PublishPlatform } from './platforms';
import { applyUtm } from './utm';
import { pickSlot, type HourWeights, type SlotPick } from './slots';
import { buildHourWeights } from './performance';
import { fetchLinkPreview } from './preview';
import {
  getPost, getTargets, q, rateSamples, takenTimes,
  type PostOptions, type PostStatus, type TargetRow, type Timing,
} from './store';

/* ------------------------------------------------------------- validation */

const iso = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'Not a valid date and time.');

export const timingSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('exact'), at: iso }),
  z.object({ mode: z.literal('window'), start: iso, end: iso, priority: z.enum(['must', 'can']).default('must') }),
]);

export const composeSchema = z.object({
  targetIds: z.array(z.string().uuid()).min(1, 'Pick at least one account.').max(40),
  baseCopy: z.string().max(5000).default(''),
  copyByTarget: z.record(z.string(), z.string().max(5000)).default({}),
  linkUrl: z.string().url().max(2000).nullable().default(null),
  linkTitle: z.string().max(300).nullable().default(null),
  mediaUrls: z.array(z.string().url().startsWith('https://')).max(10).default([]),
  instagramCollaborators: z.array(z.string().regex(/^@?[A-Za-z0-9._]{1,30}$/)).max(3).default([]),
  labels: z.array(z.string().trim().min(1).max(30)).max(5).default([]),
  timing: timingSchema,
  notes: z.string().max(1000).nullable().default(null),
  /** Editors always submit for approval; admins can choose. */
  submit: z.enum(['schedule', 'approval', 'draft']).default('schedule'),
});
export type ComposeInput = z.infer<typeof composeSchema>;

/* ------------------------------------------------------------------ slots */

const weightCache = new Map<string, { at: number; w: HourWeights }>();
async function weightsFor(orgId: string, t: TargetRow): Promise<HourWeights> {
  if (!t.channel_id) return null;
  const key = orgId + ':' + t.channel_id;
  const hit = weightCache.get(key);
  if (hit && Date.now() - hit.at < 30 * 60_000) return hit.w;
  const w = buildHourWeights(await rateSamples(orgId, t.channel_id));
  weightCache.set(key, { at: Date.now(), w });
  return w;
}

export async function slotFor(
  orgId: string, t: TargetRow, timing: Timing, extraTaken: Date[] = [], excludeDeliveryId?: string,
): Promise<{ ok: true; pick: SlotPick } | { ok: false; reason: string }> {
  if (timing.mode === 'exact') {
    const at = new Date(timing.at);
    if (at.getTime() < Date.now() - 60_000) return { ok: false, reason: 'That time has already passed.' };
    return { ok: true, pick: { at, reason: 'Exact time set by editor', weight: 1 } };
  }
  const start = new Date(timing.start);
  const end = new Date(timing.end);
  if (end <= start) return { ok: false, reason: 'The window ends before it starts.' };
  if (end.getTime() - start.getTime() > 14 * 86400_000) return { ok: false, reason: 'Windows are limited to 14 days.' };
  const policy = { rules: t.rules ?? [], minGapMinutes: t.min_gap_minutes, maxPerDay: t.max_per_day };
  const taken = [...(await takenTimes(t.id, start, end, excludeDeliveryId)), ...extraTaken];
  const inWindow = pickSlot({ windowStart: start, windowEnd: end, now: new Date(), policy, taken, weights: await weightsFor(orgId, t) });
  if (inWindow.ok || timing.priority === 'can') return inWindow;
  // Must send: a story that lands at 11:40pm, or in a burst, still goes out,
  // at the account's next open time after the window (within a day and a half).
  return nextOpenSlot(t, end, extraTaken, excludeDeliveryId);
}

/** The first time an account may post at or after `from`, respecting its hours and spacing. */
export async function nextOpenSlot(t: TargetRow, from: Date, extraTaken: Date[] = [], excludeDeliveryId?: string) {
  const policy = { rules: t.rules ?? [], minGapMinutes: t.min_gap_minutes, maxPerDay: t.max_per_day };
  const until = new Date(Math.max(from.getTime(), Date.now()) + 36 * 3600_000);
  const taken = [...(await takenTimes(t.id, from, until, excludeDeliveryId)), ...extraTaken];
  return pickSlot({ windowStart: from, windowEnd: until, now: new Date(), policy, taken, weights: null, earliest: true });
}

/**
 * When a person puts a failed delivery back in the queue: a fresh attempt budget, and a new
 * Ayrshare idempotency key (the old one is spent even though the post failed). Evaluated against
 * the row's status before the update.
 */
const resend = (alias = '') => sql.raw(`attempts = CASE WHEN ${alias}status = 'failed' THEN 0 ELSE ${alias}attempts END,
      send_key_gen = ${alias}send_key_gen + CASE WHEN ${alias}status = 'failed' THEN 1 ELSE 0 END`);

/** Give a stuck post (no time found, or failed) a new time: the account's next open slot from now. */
export async function retryDelivery(orgId: string, deliveryId: string): Promise<string> {
  const rows = await q<{ target_id: string; status: string; post_status: string }>(sql`
    SELECT d.target_id, d.status, p.status AS post_status FROM publish_deliveries d JOIN publish_posts p ON p.id = d.post_id
     WHERE d.org_id = ${orgId}::uuid AND d.id = ${deliveryId}::uuid`);
  const r = rows[0];
  if (!r) throw new HttpError(404, 'Post not found.', 'not_found');
  if (r.post_status !== 'approved' || !['unschedulable', 'failed'].includes(r.status)) {
    throw new HttpError(409, 'Only posts that could not go out can be retried.', 'conflict');
  }
  const [t] = await getTargets(orgId, [r.target_id]);
  const slot = await nextOpenSlot(t, new Date(), [], deliveryId);
  if (!slot.ok) throw new HttpError(409, slot.reason, 'conflict');
  await q(sql`UPDATE publish_deliveries SET status = 'queued', scheduled_for = ${slot.pick.at.toISOString()}::timestamptz,
      slot_reason = ${slot.pick.reason}, last_error = NULL, lease_until = NULL, ${resend()}
    WHERE org_id = ${orgId}::uuid AND id = ${deliveryId}::uuid`);
  return slot.pick.at.toISOString();
}

function canExpire(t: Timing): boolean {
  return t.mode === 'window' && t.priority === 'can';
}

/* ---------------------------------------------------------------- compose */

export interface PlannedDelivery {
  targetId: string;
  platform: PublishPlatform;
  label: string;
  brand: string;
  copy: string;
  linkUrl: string | null;
  linkMode: ReturnType<typeof linkModeFor>;
  finalText: string;
  length: number;
  limit: number;
  problems: string[];
  slot: { at: string; reason: string } | null;
  slotError: string | null;
}

/**
 * Turn one composed post into one delivery per account: per-platform copy,
 * per-platform UTMs, the exact final text, and a picked slot. Used both for the
 * composer's live preview and for the real write, so they cannot disagree.
 */
export async function planDeliveries(orgId: string, input: ComposeInput, postRef: string, origin = 'manual'): Promise<PlannedDelivery[]> {
  const targets = await getTargets(orgId, input.targetIds);
  if (targets.length !== new Set(input.targetIds).size) throw new HttpError(400, 'One of those accounts no longer exists.');
  const plans: PlannedDelivery[] = [];
  const claimed = new Map<string, Date[]>();
  for (const t of targets) {
    if (!PUBLISH_PLATFORMS.includes(t.platform)) throw new HttpError(400, `Unsupported platform ${t.platform}.`);
    const copy = (input.copyByTarget[t.id] ?? input.baseCopy).trim();
    const mode = linkModeFor(t.platform, t.provider);
    const link = input.linkUrl
      ? applyUtm(input.linkUrl, t.utm, { platform: t.platform, brand: t.brand, postRef, origin, date: new Date() })
      : null;
    const text = finalText(copy, link, mode);
    const length = chargedLength(t.platform, text);
    const limit = TEXT_LIMITS[t.platform];
    const problems: string[] = [];
    if (!t.active) problems.push('This account is paused.');
    if (length > limit) problems.push(`${length - limit} characters over the ${limit} limit.`);
    if ((t.platform === 'instagram' || t.platform === 'tiktok') && input.mediaUrls.length === 0) {
      problems.push(`${t.platform === 'instagram' ? 'Instagram' : 'TikTok'} needs an image or video.`);
    }
    if (!text && !input.mediaUrls.length && !(link && mode === 'card')) problems.push('Nothing to post.');

    const slot = await slotFor(orgId, t, input.timing, claimed.get(t.id) ?? []);
    if (slot.ok) claimed.set(t.id, [...(claimed.get(t.id) ?? []), slot.pick.at]);
    plans.push({
      targetId: t.id, platform: t.platform, label: t.label, brand: t.brand,
      copy, linkUrl: link, linkMode: mode, finalText: text, length, limit, problems,
      slot: slot.ok ? { at: slot.pick.at.toISOString(), reason: slot.pick.reason } : null,
      slotError: slot.ok ? null : slot.reason,
    });
  }
  return plans;
}

export async function createPost(
  ctx: { orgId: string; userId: string | null; email: string | null; canApprove: boolean },
  input: ComposeInput,
  origin: { kind: 'manual' } | { kind: 'rss'; feedId: string } = { kind: 'manual' },
): Promise<{ id: string; status: PostStatus; plans: PlannedDelivery[] }> {
  const status: PostStatus =
    input.submit === 'draft' ? 'draft'
      : input.submit === 'approval' || !ctx.canApprove ? 'pending_approval'
        : 'approved';
  // Best effort: the queue shows each story as a card. A slow or blocked page never blocks the post.
  const card = input.linkUrl
    ? await Promise.race([fetchLinkPreview(input.linkUrl), new Promise<null>((r) => setTimeout(() => r(null), 6000))]).catch(() => null)
    : null;
  const [{ id }] = await q<{ id: string }>(sql`INSERT INTO publish_posts
      (org_id, created_by, created_by_email, status, origin, feed_id, base_copy, link_url, link_title, media_urls, timing, options, notes,
       approved_by_email, approved_at)
    VALUES (${ctx.orgId}::uuid, ${ctx.userId}::uuid, ${ctx.email}, ${status}, ${origin.kind},
      ${origin.kind === 'rss' ? origin.feedId : null}::uuid, ${input.baseCopy}, ${input.linkUrl}, ${input.linkTitle},
      ${JSON.stringify(input.mediaUrls)}::jsonb, ${JSON.stringify(input.timing)}::jsonb,
      ${JSON.stringify({ instagramCollaborators: input.instagramCollaborators.map((c) => c.replace(/^@/, '')), copyByTarget: input.copyByTarget, labels: input.labels,
        card: card ? { title: card.title, description: card.description, image: card.image } : null } satisfies PostOptions)}::jsonb,
      ${input.notes}, ${status === 'approved' ? ctx.email : null}, ${status === 'approved' ? new Date().toISOString() : null}::timestamptz)
    RETURNING id`);

  const plans = await planDeliveries(ctx.orgId, input, id.slice(0, 8), origin.kind);
  if (status === 'approved') {
    // A Can Send post that finds no good slot simply expires; it is not a problem to fix.
    const blocking = plans.filter((p) => p.problems.length);
    if (blocking.length) {
      await q(sql`DELETE FROM publish_posts WHERE id = ${id}::uuid`);
      throw new HttpError(400, `${blocking[0].label}: ${blocking[0].problems[0]}`, 'invalid_post');
    }
  }
  for (const p of plans) {
    const dStatus = status !== 'approved' ? 'held' : p.slot ? 'queued' : canExpire(input.timing) ? 'canceled' : 'unschedulable';
    await q(sql`INSERT INTO publish_deliveries
        (org_id, post_id, target_id, copy, link_url, final_text, link_mode, status, scheduled_for, slot_reason, last_error)
      VALUES (${ctx.orgId}::uuid, ${id}::uuid, ${p.targetId}::uuid, ${p.copy}, ${p.linkUrl}, ${p.finalText}, ${p.linkMode},
        ${dStatus}, ${dStatus === 'queued' ? p.slot!.at : null}::timestamptz, ${p.slot?.reason ?? null},
        ${dStatus === 'unschedulable' ? p.slotError : dStatus === 'canceled' ? 'Expired: ' + p.slotError : null})`);
  }
  return { id, status, plans };
}

/* ------------------------------------------------------ approve / cancel */

export async function approvePost(orgId: string, postId: string, approverEmail: string | null) {
  const post = await getPost(orgId, postId);
  if (!post) throw new HttpError(404, 'Post not found.', 'not_found');
  if (post.status !== 'pending_approval' && post.status !== 'draft') {
    throw new HttpError(409, 'This post is not waiting for approval.', 'conflict');
  }
  await q(sql`UPDATE publish_posts SET status = 'approved', approved_by_email = ${approverEmail}, approved_at = now()
    WHERE org_id = ${orgId}::uuid AND id = ${postId}::uuid`);
  // Slots are picked at approval time, against the queue as it is now.
  const targets = await getTargets(orgId, post.deliveries.map((d) => d.target_id));
  const claimed = new Map<string, Date[]>();
  for (const d of post.deliveries.filter((x) => x.status === 'held')) {
    const t = targets.find((x) => x.id === d.target_id);
    if (!t) continue;
    const slot = await slotFor(orgId, t, post.timing, claimed.get(t.id) ?? []);
    if (slot.ok) {
      claimed.set(t.id, [...(claimed.get(t.id) ?? []), slot.pick.at]);
      await q(sql`UPDATE publish_deliveries SET status = 'queued', scheduled_for = ${slot.pick.at.toISOString()}::timestamptz,
        slot_reason = ${slot.pick.reason}, last_error = NULL WHERE id = ${d.id}::uuid AND org_id = ${orgId}::uuid`);
    } else {
      const expire = canExpire(post.timing);
      await q(sql`UPDATE publish_deliveries SET status = ${expire ? 'canceled' : 'unschedulable'},
          last_error = ${expire ? 'Expired: ' + slot.reason : slot.reason}
        WHERE id = ${d.id}::uuid AND org_id = ${orgId}::uuid`);
    }
  }
}

export async function cancelPost(orgId: string, postId: string) {
  await q(sql`UPDATE publish_posts SET status = 'canceled' WHERE org_id = ${orgId}::uuid AND id = ${postId}::uuid`);
  await q(sql`UPDATE publish_deliveries SET status = 'canceled', lease_until = NULL
    WHERE org_id = ${orgId}::uuid AND post_id = ${postId}::uuid AND status IN ('held', 'queued', 'unschedulable', 'failed')`);
}

export async function cancelDelivery(orgId: string, deliveryId: string) {
  const rows = await q<{ id: string }>(sql`UPDATE publish_deliveries SET status = 'canceled', lease_until = NULL
    WHERE org_id = ${orgId}::uuid AND id = ${deliveryId}::uuid AND status IN ('held', 'queued', 'unschedulable', 'failed')
    RETURNING id`);
  if (!rows.length) throw new HttpError(409, 'That post is already sending or sent.', 'conflict');
}

/** Move one delivery to an exact time, or send it at the next dispatcher tick. */
export async function rescheduleDelivery(orgId: string, deliveryId: string, at: Date | 'now') {
  const when = at === 'now' ? new Date() : at;
  if (at !== 'now' && when.getTime() < Date.now() - 60_000) throw new HttpError(400, 'That time has already passed.');
  const rows = await q<{ id: string }>(sql`UPDATE publish_deliveries d SET status = 'queued', scheduled_for = ${when.toISOString()}::timestamptz,
      slot_reason = ${at === 'now' ? 'Sent now by editor' : 'Moved by editor'}, last_error = NULL, ${resend('d.')}
    FROM publish_posts p
    WHERE d.org_id = ${orgId}::uuid AND d.id = ${deliveryId}::uuid AND p.id = d.post_id AND p.status = 'approved'
      AND d.status IN ('queued', 'unschedulable', 'failed')
    RETURNING d.id`);
  if (!rows.length) throw new HttpError(409, 'Only approved posts that have not been sent can be moved.', 'conflict');
}

/* ------------------------------------------------------------ edit copy */

/** Change the exact text one account will send. Only before it sends. */
export async function editDeliveryText(orgId: string, deliveryId: string, text: string) {
  const rows = await q<{ platform: PublishPlatform; status: string }>(sql`SELECT t.platform, d.status
    FROM publish_deliveries d JOIN publish_targets t ON t.id = d.target_id
    WHERE d.org_id = ${orgId}::uuid AND d.id = ${deliveryId}::uuid`);
  const r = rows[0];
  if (!r) throw new HttpError(404, 'Post not found.', 'not_found');
  if (!['held', 'queued', 'unschedulable', 'failed'].includes(r.status)) {
    throw new HttpError(409, 'That post is already sending or sent.', 'conflict');
  }
  const length = chargedLength(r.platform, text);
  if (length > TEXT_LIMITS[r.platform]) {
    throw new HttpError(400, `${length - TEXT_LIMITS[r.platform]} characters over the ${TEXT_LIMITS[r.platform]} limit.`);
  }
  await q(sql`UPDATE publish_deliveries SET final_text = ${text}, copy = ${text}
    WHERE org_id = ${orgId}::uuid AND id = ${deliveryId}::uuid`);
}

/* ---------------------------------------------------------------- pause */

/**
 * The breaking-news brake. While paused, nothing sends for this org; RSS keeps
 * queueing so nothing is lost. On resume, posts that came due during the pause
 * are not all fired at once: each account's overdue posts are re-spaced from
 * now by that account's minimum gap, and Can Send posts whose window closed
 * expire.
 */
export async function setPaused(orgId: string, paused: boolean, by: string | null) {
  await q(sql`INSERT INTO publish_settings (org_id, paused, paused_by, paused_at)
    VALUES (${orgId}::uuid, ${paused}, ${by}, now())
    ON CONFLICT (org_id) DO UPDATE SET paused = EXCLUDED.paused, paused_by = EXCLUDED.paused_by, paused_at = EXCLUDED.paused_at`);
  if (paused) return { respaced: 0, expired: 0 };

  const overdue = await q<{ id: string; target_id: string; min_gap_minutes: number; timing: Timing }>(sql`
    SELECT d.id, d.target_id, t.min_gap_minutes, p.timing
      FROM publish_deliveries d
      JOIN publish_targets t ON t.id = d.target_id
      JOIN publish_posts p ON p.id = d.post_id
     WHERE d.org_id = ${orgId}::uuid AND d.status = 'queued' AND d.scheduled_for < now()
     ORDER BY d.scheduled_for`);
  let respaced = 0, expired = 0;
  const nextFree = new Map<string, number>();
  for (const d of overdue) {
    if (d.timing.mode === 'window' && d.timing.priority === 'can' && new Date(d.timing.end).getTime() < Date.now()) {
      await q(sql`UPDATE publish_deliveries SET status = 'canceled', last_error = 'Expired during pause' WHERE id = ${d.id}::uuid`);
      expired++;
      continue;
    }
    const at = nextFree.get(d.target_id) ?? Date.now() + 2 * 60_000;
    nextFree.set(d.target_id, at + Math.max(d.min_gap_minutes, 5) * 60_000);
    await q(sql`UPDATE publish_deliveries SET scheduled_for = ${new Date(at).toISOString()}::timestamptz,
        slot_reason = 'Re-spaced after pause' WHERE id = ${d.id}::uuid`);
    respaced++;
  }
  return { respaced, expired };
}
