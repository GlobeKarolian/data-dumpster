import 'server-only';
import { sql } from 'drizzle-orm';
import { parseFeed, renderTemplate, type FeedItem } from './rss';
import { getTargets, q, type FeedRow } from './store';
import { createPost } from './service';
import { TEXT_LIMITS, linkModeFor } from './platforms';
import { safePreviewUrl } from './preview';

/**
 * RSS autopublishing for our own feeds (Boston.com WordPress categories, Globe
 * sections). Each feed rule names the accounts it posts to, a copy template per
 * platform, and a window: a new story is queued into that window and the slot
 * picker spaces it against everything else on each account.
 *
 * The first poll of a new feed only records what is already there. Turning a
 * feed on must never dump its backlog onto the brand's accounts.
 */
const POLL_EVERY_MINUTES = 5;
const MAX_NEW_PER_POLL = 5;
const DEFAULT_TEMPLATE = '{title}';

export async function pollFeeds(): Promise<{ feeds: number; queued: number; errors: number }> {
  const feeds = await q<FeedRow & { org_id: string; created_by_email: string | null }>(sql`
    SELECT id, org_id, label, url, target_ids, templates, include_categories, exclude_keywords,
           window_minutes, require_approval, active,
           last_polled_at::text AS last_polled_at, last_error, NULL::text AS created_by_email
      FROM publish_feeds
     WHERE active AND (last_polled_at IS NULL OR last_polled_at < now() - make_interval(mins => ${POLL_EVERY_MINUTES}))
     ORDER BY last_polled_at NULLS FIRST
     LIMIT 20`);
  let queued = 0, errors = 0;
  for (const f of feeds) {
    try {
      queued += await pollOne(f);
      await q(sql`UPDATE publish_feeds SET last_polled_at = now(), last_error = NULL WHERE id = ${f.id}::uuid`);
    } catch (err) {
      errors++;
      await q(sql`UPDATE publish_feeds SET last_polled_at = now(), last_error = ${(err as Error).message.slice(0, 500)}
        WHERE id = ${f.id}::uuid`);
    }
  }
  return { feeds: feeds.length, queued, errors };
}

async function pollOne(f: FeedRow & { org_id: string }): Promise<number> {
  const url = safePreviewUrl(f.url);
  if (!url) throw new Error('Feed URL is not a public http(s) address.');
  const res = await fetch(url, {
    headers: { 'user-agent': 'DataDumpsterBot/1.0 (+https://www.datadumpster.boston)', accept: 'application/rss+xml, application/atom+xml, text/xml' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Feed returned HTTP ${res.status}.`);
  const items = parseFeed(await res.text());
  if (!items.length) return 0;

  const known = await q<{ guid: string }>(sql`SELECT guid FROM publish_feed_items WHERE feed_id = ${f.id}::uuid
    AND guid IN (SELECT jsonb_array_elements_text(${JSON.stringify(items.map((i) => i.guid))}::jsonb))`);
  const seen = new Set(known.map((k) => k.guid));
  let fresh = items.filter((i) => !seen.has(i.guid));
  const firstPoll = f.last_polled_at == null;

  if (firstPoll || !fresh.length) {
    await markSeen(f.id, fresh.map((i) => i.guid), null);
    return 0;
  }

  const targets = await getTargets(f.org_id, f.target_ids);
  // Newsroom rules: only these sections, and never stories matching these words.
  const skipped = fresh.filter((i) => !passesFilters(f, i));
  await markSeen(f.id, skipped.map((i) => i.guid), null);
  fresh = fresh.filter((i) => passesFilters(f, i));
  let queued = 0;
  // Oldest first, so the queue keeps publication order.
  const batch = fresh.sort((a, b) => (a.published?.getTime() ?? 0) - (b.published?.getTime() ?? 0));
  for (const item of batch.slice(-MAX_NEW_PER_POLL)) {
    const postId = await queueItem(f, targets, item);
    await markSeen(f.id, [item.guid], postId);
    queued++;
  }
  // Anything beyond the per-poll cap is recorded as seen, not posted.
  await markSeen(f.id, batch.slice(0, -MAX_NEW_PER_POLL).map((i) => i.guid), null);
  return queued;
}

async function queueItem(f: FeedRow & { org_id: string }, targets: Awaited<ReturnType<typeof getTargets>>, item: FeedItem) {
  const copyByTarget: Record<string, string> = {};
  for (const t of targets) {
    const template = f.templates[t.id] ?? f.templates[t.platform] ?? f.templates.default ?? DEFAULT_TEMPLATE;
    // Leave room for the link when it travels in the text (X charges 23).
    const mode = linkModeFor(t.platform, t.provider);
    const reserve = mode === 'text' ? (t.platform === 'twitter' ? 25 : item.link.length + 80) : mode === 'bio' ? 14 : 0;
    copyByTarget[t.id] = renderTemplate(template, item, TEXT_LIMITS[t.platform] - reserve);
  }
  const now = new Date();
  const { id } = await createPost(
    { orgId: f.org_id, userId: null, email: 'rss:' + f.label, canApprove: !f.require_approval },
    {
      targetIds: targets.filter((t) => t.active).map((t) => t.id),
      baseCopy: item.title,
      copyByTarget,
      linkUrl: item.link,
      linkTitle: item.title,
      mediaUrls: item.image?.startsWith('https://') ? [item.image] : [],
      instagramCollaborators: [],
      timing: { mode: 'window', start: now.toISOString(), end: new Date(now.getTime() + f.window_minutes * 60_000).toISOString(), priority: 'must' },
      labels: ['autopilot'],
      notes: `From feed: ${f.label}`,
      submit: f.require_approval ? 'approval' : 'schedule',
    },
    { kind: 'rss', feedId: f.id },
  ).catch(async (err) => {
    // A story that cannot post everywhere (say, Instagram with no image) waits for a person instead of vanishing.
    const fallback = await createPost(
      { orgId: f.org_id, userId: null, email: 'rss:' + f.label, canApprove: false },
      {
        targetIds: targets.filter((t) => t.active).map((t) => t.id), baseCopy: item.title, copyByTarget,
        linkUrl: item.link, linkTitle: item.title, mediaUrls: [], instagramCollaborators: [],
        timing: { mode: 'window', start: now.toISOString(), end: new Date(now.getTime() + f.window_minutes * 60_000).toISOString(), priority: 'must' },
      labels: ['autopilot'],
        notes: `From feed: ${f.label}. Held for review: ${(err as Error).message}`, submit: 'approval',
      },
      { kind: 'rss', feedId: f.id },
    );
    return fallback;
  });
  return id;
}

async function markSeen(feedId: string, guids: string[], postId: string | null) {
  if (!guids.length) return;
  await q(sql`INSERT INTO publish_feed_items (feed_id, guid, post_id)
    SELECT ${feedId}::uuid, g, ${postId}::uuid FROM jsonb_array_elements_text(${JSON.stringify(guids)}::jsonb) g
    ON CONFLICT (feed_id, guid) DO NOTHING`);
}

export function passesFilters(f: Pick<FeedRow, 'include_categories' | 'exclude_keywords'>, item: FeedItem): boolean {
  const include = (f.include_categories ?? []).map((c) => c.toLowerCase().trim()).filter(Boolean);
  if (include.length && !item.categories.some((c) => include.includes(c.toLowerCase().trim()))) return false;
  const hay = (item.title + ' ' + item.description).toLowerCase();
  return !(f.exclude_keywords ?? []).some((k) => k.trim() && hay.includes(k.toLowerCase().trim()));
}
