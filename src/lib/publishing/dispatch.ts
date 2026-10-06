import 'server-only';
import { sql } from 'drizzle-orm';
import { decryptJson } from '@/lib/crypto';
import { publisherFor, type LinkPreview } from './providers';
import { fetchLinkPreview } from './preview';
import { q } from './store';
import type { LinkMode, PublishPlatform, PublishProvider } from './platforms';

/**
 * The send loop, run every minute by /api/cron/publish.
 *
 * Claims due deliveries in one statement with FOR UPDATE SKIP LOCKED and a
 * five-minute lease, so two overlapping ticks can never send the same post.
 *
 * A lease that expired while "sending" means the outcome is unknown. For an
 * idempotent provider (Ayrshare, keyed by delivery id) it is safe to send again.
 * For Bluesky it is not, so the delivery fails with "check the account" rather
 * than risking a duplicate on a newsroom account.
 */
const MAX_ATTEMPTS = 4;
const BATCH = 25;

interface Claimed {
  id: string;
  org_id: string;
  target_id: string;
  post_id: string;
  platform: PublishPlatform;
  provider: PublishProvider;
  final_text: string;
  link_url: string | null;
  link_mode: LinkMode;
  link_title: string | null;
  media_urls: string[];
  collaborators: string[] | null;
  secret_enc: string | null;
  attempts: number;
  was_stale: boolean;
}

export async function dispatchDue(): Promise<{ claimed: number; sent: number; failed: number; retried: number }> {
  const claimed = await q<Claimed>(sql`
    WITH due AS (
      SELECT d.id, (d.status = 'sending') AS was_stale
        FROM publish_deliveries d
        JOIN publish_posts p ON p.id = d.post_id AND p.status = 'approved'
        JOIN publish_targets t ON t.id = d.target_id AND t.active
       WHERE ((d.status = 'queued' AND d.scheduled_for <= now())
          OR (d.status = 'sending' AND d.lease_until < now()))
         AND NOT EXISTS (SELECT 1 FROM publish_settings s WHERE s.org_id = d.org_id AND s.paused)
       ORDER BY d.scheduled_for
       LIMIT ${BATCH}
       FOR UPDATE OF d SKIP LOCKED
    )
    UPDATE publish_deliveries d
       SET status = 'sending', lease_until = now() + interval '5 minutes', attempts = d.attempts + 1
      FROM due, publish_targets t, publish_posts p
     WHERE d.id = due.id AND t.id = d.target_id AND p.id = d.post_id
    RETURNING d.id, d.org_id, d.target_id, d.post_id, t.platform, t.provider, d.final_text, d.link_url, d.link_mode,
              p.link_title, p.media_urls, (p.options->'instagramCollaborators') AS collaborators, t.secret_enc,
              d.attempts, due.was_stale`);

  let sent = 0, failed = 0, retried = 0;
  const previews = new Map<string, LinkPreview | null>();

  for (const c of claimed) {
    const publisher = publisherFor(c.provider);
    if (c.was_stale && !publisher.idempotent) {
      await finish(c, publisher.name, false, 'Outcome unknown: the last send timed out. Check the account before resending.', null);
      failed++;
      continue;
    }
    let secret: Record<string, string> | null = null;
    if (c.secret_enc) {
      try { secret = decryptJson<Record<string, string>>(c.secret_enc); } catch { secret = null; }
    }
    let preview: LinkPreview | null = null;
    if (c.link_url && c.link_mode === 'card') {
      if (!previews.has(c.link_url)) previews.set(c.link_url, await fetchLinkPreview(c.link_url));
      preview = previews.get(c.link_url) ?? null;
      if (preview && c.link_title) preview = { ...preview, title: c.link_title };
    }
    const result = await publisher.send({
      platform: c.platform, text: c.final_text, link: c.link_url, linkMode: c.link_mode, preview,
      mediaUrls: c.media_urls ?? [], instagramCollaborators: c.collaborators ?? [],
      idempotencyKey: c.id, secret,
    });
    if (result.ok) {
      await finish(c, publisher.name, true, null, result.detail ?? null, result.providerPostId, result.postUrl);
      sent++;
    } else if (result.retryable && c.attempts < MAX_ATTEMPTS) {
      const backoffMin = 2 ** c.attempts;
      await q(sql`UPDATE publish_deliveries SET status = 'queued', lease_until = NULL, last_error = ${result.error},
          scheduled_for = now() + make_interval(mins => ${backoffMin})
        WHERE id = ${c.id}::uuid`);
      await logAttempt(c, publisher.name, false, { error: result.error, detail: result.detail ?? null, retryInMinutes: backoffMin });
      retried++;
    } else {
      await finish(c, publisher.name, false, result.error, result.detail ?? null);
      failed++;
    }
  }
  return { claimed: claimed.length, sent, failed, retried };
}

async function finish(
  c: Claimed, provider: string, ok: boolean, error: string | null, detail: unknown,
  providerPostId: string | null = null, postUrl: string | null = null,
) {
  await q(sql`UPDATE publish_deliveries SET status = ${ok ? 'sent' : 'failed'}, lease_until = NULL,
      provider = ${provider}, provider_post_id = ${providerPostId}, post_url = ${postUrl}, last_error = ${error},
      sent_at = CASE WHEN ${ok} THEN now() ELSE sent_at END
    WHERE id = ${c.id}::uuid`);
  if (ok) {
    // The bio link goes live with the post, even if the send ran a little late.
    await q(sql`UPDATE publish_bio_links SET starts_at = least(starts_at, now()) WHERE delivery_id = ${c.id}::uuid`);
  }
  await logAttempt(c, provider, ok, ok ? { detail } : { error, detail });
}

async function logAttempt(c: Claimed, provider: string, ok: boolean, detail: unknown) {
  await q(sql`INSERT INTO publish_attempts (org_id, delivery_id, ok, provider, detail)
    VALUES (${c.org_id}::uuid, ${c.id}::uuid, ${ok}, ${provider}, ${JSON.stringify(detail)}::jsonb)`);
}
