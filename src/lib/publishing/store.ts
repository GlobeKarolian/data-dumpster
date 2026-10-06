import 'server-only';
import { sql, type SQL } from 'drizzle-orm';
import { db } from '@/db';
import { PUBLISHING_DDL } from './schema-ddl';
import type { PostingRule } from './slots';
import type { UtmTemplate } from './utm';
import type { LinkMode, PublishPlatform, PublishProvider } from './platforms';

let ready: Promise<void> | null = null;
export function ensurePublishingSchema(): Promise<void> {
  ready ??= (async () => {
    for (const statement of PUBLISHING_DDL) await db.execute(sql.raw(statement));
  })().catch((error) => {
    ready = null;
    throw error;
  });
  return ready;
}

export async function q<T>(query: SQL): Promise<T[]> {
  await ensurePublishingSchema();
  const { rows } = await db.execute(query);
  return rows as T[];
}

const iso = (col: string) => sql.raw(`to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`);

/* ---------------------------------------------------------------- targets */

export interface TargetRow {
  id: string;
  brand: string;
  platform: PublishPlatform;
  label: string;
  handle: string | null;
  provider: PublishProvider;
  has_secret: boolean;
  channel_id: string | null;
  utm: UtmTemplate;
  rules: PostingRule[];
  min_gap_minutes: number;
  max_per_day: number | null;
  bio_page_id: string | null;
  active: boolean;
}

const TARGET_COLS = sql`id, brand, platform, label, handle, provider, (secret_enc IS NOT NULL) AS has_secret,
  channel_id, utm, rules, min_gap_minutes, max_per_day, bio_page_id, active`;

export function listTargets(orgId: string): Promise<TargetRow[]> {
  return q<TargetRow>(sql`SELECT ${TARGET_COLS} FROM publish_targets WHERE org_id = ${orgId}::uuid
    ORDER BY brand, platform, label`);
}

export async function getTargets(orgId: string, ids: string[]): Promise<TargetRow[]> {
  if (!ids.length) return [];
  return q<TargetRow>(sql`SELECT ${TARGET_COLS} FROM publish_targets
    WHERE org_id = ${orgId}::uuid AND id IN (SELECT jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)::uuid)`);
}

export async function getTargetSecret(orgId: string, id: string): Promise<string | null> {
  const rows = await q<{ secret_enc: string | null }>(sql`SELECT secret_enc FROM publish_targets
    WHERE org_id = ${orgId}::uuid AND id = ${id}::uuid`);
  return rows[0]?.secret_enc ?? null;
}

export interface TargetInput {
  brand: string;
  platform: PublishPlatform;
  label: string;
  handle: string | null;
  provider: PublishProvider;
  secretEnc?: string | null;
  channelId: string | null;
  utm: UtmTemplate;
  rules: PostingRule[];
  minGapMinutes: number;
  maxPerDay: number | null;
  bioPageId: string | null;
  active: boolean;
}

export async function insertTarget(orgId: string, t: TargetInput): Promise<string> {
  const rows = await q<{ id: string }>(sql`INSERT INTO publish_targets
    (org_id, brand, platform, label, handle, provider, secret_enc, channel_id, utm, rules, min_gap_minutes, max_per_day, bio_page_id, active)
    VALUES (${orgId}::uuid, ${t.brand}, ${t.platform}, ${t.label}, ${t.handle}, ${t.provider}, ${t.secretEnc ?? null},
      ${t.channelId}::uuid, ${JSON.stringify(t.utm)}::jsonb, ${JSON.stringify(t.rules)}::jsonb, ${t.minGapMinutes},
      ${t.maxPerDay}, ${t.bioPageId}::uuid, ${t.active})
    RETURNING id`);
  return rows[0].id;
}

export async function updateTarget(orgId: string, id: string, t: TargetInput): Promise<boolean> {
  const rows = await q<{ id: string }>(sql`UPDATE publish_targets SET
      brand = ${t.brand}, platform = ${t.platform}, label = ${t.label}, handle = ${t.handle}, provider = ${t.provider},
      secret_enc = CASE WHEN ${t.secretEnc === undefined} THEN secret_enc ELSE ${t.secretEnc ?? null} END,
      channel_id = ${t.channelId}::uuid, utm = ${JSON.stringify(t.utm)}::jsonb, rules = ${JSON.stringify(t.rules)}::jsonb,
      min_gap_minutes = ${t.minGapMinutes}, max_per_day = ${t.maxPerDay}, bio_page_id = ${t.bioPageId}::uuid, active = ${t.active}
    WHERE org_id = ${orgId}::uuid AND id = ${id}::uuid RETURNING id`);
  return rows.length > 0;
}

/** Tracked channels this org can link a target to, for learning posting hours. */
export function listLinkableChannels(orgId: string) {
  return q<{ id: string; platform: string; handle: string; company: string }>(sql`
    SELECT DISTINCT ch.id, ch.platform::text AS platform, ch.handle, c.name AS company
      FROM channels ch
      JOIN companies c ON c.id = ch.company_id
      JOIN landscape_companies lc ON lc.company_id = c.id
      JOIN landscapes l ON l.id = lc.landscape_id
     WHERE l.org_id = ${orgId}::uuid
     ORDER BY c.name, ch.platform::text, ch.handle`);
}

/**
 * Engagement-rate samples for one channel over 120 days, in Boston time. The
 * channel must be in one of this org's landscapes; posts without a follower
 * count at posting are excluded rather than counted as zero.
 */
export function rateSamples(orgId: string, channelId: string) {
  return q<{ weekday: number; hour: number; rate: number }>(sql`
    SELECT extract(dow FROM p.posted_at AT TIME ZONE 'America/New_York')::int AS weekday,
           extract(hour FROM p.posted_at AT TIME ZONE 'America/New_York')::int AS hour,
           (p.engagement_total::float / p.followers_at_post) AS rate
      FROM posts p
     WHERE p.channel_id = ${channelId}::uuid
       AND p.posted_at > now() - interval '120 days'
       AND p.followers_at_post > 0
       AND EXISTS (
         SELECT 1 FROM channels ch
           JOIN landscape_companies lc ON lc.company_id = ch.company_id
           JOIN landscapes l ON l.id = lc.landscape_id
          WHERE ch.id = p.channel_id AND l.org_id = ${orgId}::uuid)`);
}

/** Times already claimed on a target near a window, so spacing can be enforced. */
export async function takenTimes(targetId: string, from: Date, to: Date, excludeDeliveryId?: string): Promise<Date[]> {
  const rows = await q<{ t: string }>(sql`
    SELECT ${iso('coalesce(sent_at, scheduled_for)')} AS t FROM publish_deliveries
     WHERE target_id = ${targetId}::uuid
       AND status IN ('queued', 'sending', 'sent')
       AND coalesce(sent_at, scheduled_for) BETWEEN ${from.toISOString()}::timestamptz - interval '1 day'
                                               AND ${to.toISOString()}::timestamptz + interval '1 day'
       AND (${excludeDeliveryId ?? null}::uuid IS NULL OR id <> ${excludeDeliveryId ?? null}::uuid)`);
  return rows.map((r) => new Date(r.t));
}

/* ------------------------------------------------------------ posts/queue */

export type PostStatus = 'draft' | 'pending_approval' | 'approved' | 'canceled';
export type DeliveryStatus = 'held' | 'queued' | 'sending' | 'sent' | 'failed' | 'canceled' | 'unschedulable';

/**
 * exact: a set time ("Schedule"; "Publish now" is exact at now).
 * window: "Optimize". priority must = always send inside the window;
 * can = send only if a good slot exists, otherwise expire (SocialFlow's
 * Must Send / Can Send).
 */
export type Timing =
  | { mode: 'exact'; at: string }
  | { mode: 'window'; start: string; end: string; priority?: 'must' | 'can' };

export interface PostOptions {
  instagramCollaborators?: string[];
  /** Per-platform copy overrides keyed by target id. */
  copyByTarget?: Record<string, string>;
  /** Free-form labels for sorting the queue, e.g. "breaking", "sports". */
  labels?: string[];
}

export interface DeliveryView {
  id: string;
  post_id: string;
  target_id: string;
  brand: string;
  platform: PublishPlatform;
  label: string;
  copy: string;
  final_text: string;
  link_url: string | null;
  link_mode: LinkMode;
  status: DeliveryStatus;
  scheduled_for: string | null;
  slot_reason: string | null;
  attempts: number;
  provider: string | null;
  post_url: string | null;
  last_error: string | null;
  sent_at: string | null;
}

export interface PostView {
  id: string;
  status: PostStatus;
  origin: string;
  base_copy: string;
  link_url: string | null;
  link_title: string | null;
  media_urls: string[];
  timing: Timing;
  options: PostOptions;
  notes: string | null;
  created_by_email: string | null;
  approved_by_email: string | null;
  created_at: string;
  deliveries: DeliveryView[];
}

export async function listPosts(orgId: string, from: Date, to: Date): Promise<PostView[]> {
  const posts = await q<Omit<PostView, 'deliveries'>>(sql`
    SELECT id, status, origin, base_copy, link_url, link_title, media_urls, timing, options, notes,
           created_by_email, approved_by_email, ${iso('created_at')} AS created_at
      FROM publish_posts p
     WHERE org_id = ${orgId}::uuid
       AND (
         status IN ('pending_approval', 'draft')
         OR EXISTS (SELECT 1 FROM publish_deliveries d WHERE d.post_id = p.id
                     AND (coalesce(d.sent_at, d.scheduled_for) BETWEEN ${from.toISOString()}::timestamptz AND ${to.toISOString()}::timestamptz
                          OR d.status IN ('failed', 'unschedulable', 'held')))
         OR (created_at BETWEEN ${from.toISOString()}::timestamptz AND ${to.toISOString()}::timestamptz)
       )
     ORDER BY created_at DESC
     LIMIT 500`);
  if (!posts.length) return [];
  const deliveries = await q<DeliveryView>(sql`
    SELECT d.id, d.post_id, d.target_id, t.brand, t.platform, t.label, d.copy, d.final_text, d.link_url, d.link_mode,
           d.status, ${iso('d.scheduled_for')} AS scheduled_for, d.slot_reason, d.attempts, d.provider, d.post_url,
           d.last_error, ${iso('d.sent_at')} AS sent_at
      FROM publish_deliveries d JOIN publish_targets t ON t.id = d.target_id
     WHERE d.org_id = ${orgId}::uuid
       AND d.post_id IN (SELECT jsonb_array_elements_text(${JSON.stringify(posts.map((p) => p.id))}::jsonb)::uuid)
     ORDER BY d.scheduled_for NULLS LAST`);
  const byPost = new Map<string, DeliveryView[]>();
  for (const d of deliveries) byPost.set(d.post_id, [...(byPost.get(d.post_id) ?? []), d]);
  return posts.map((p) => ({ ...p, deliveries: byPost.get(p.id) ?? [] }));
}

export async function getPost(orgId: string, id: string): Promise<PostView | null> {
  const rows = await q<Omit<PostView, 'deliveries'>>(sql`
    SELECT id, status, origin, base_copy, link_url, link_title, media_urls, timing, options, notes,
           created_by_email, approved_by_email, ${iso('created_at')} AS created_at
      FROM publish_posts WHERE org_id = ${orgId}::uuid AND id = ${id}::uuid`);
  if (!rows[0]) return null;
  const deliveries = await q<DeliveryView>(sql`
    SELECT d.id, d.post_id, d.target_id, t.brand, t.platform, t.label, d.copy, d.final_text, d.link_url, d.link_mode,
           d.status, ${iso('d.scheduled_for')} AS scheduled_for, d.slot_reason, d.attempts, d.provider, d.post_url,
           d.last_error, ${iso('d.sent_at')} AS sent_at
      FROM publish_deliveries d JOIN publish_targets t ON t.id = d.target_id
     WHERE d.org_id = ${orgId}::uuid AND d.post_id = ${id}::uuid`);
  return { ...rows[0], deliveries };
}

/* ------------------------------------------------------------- link in bio */

export interface BioPageRow { id: string; slug: string; title: string; brand: string; avatar_url: string | null }
export interface BioLinkRow {
  id: string; page_id: string; title: string; url: string; image_url: string | null;
  starts_at: string; ends_at: string | null; pinned: boolean; delivery_id: string | null;
}

export function listBioPages(orgId: string) {
  return q<BioPageRow>(sql`SELECT id, slug, title, brand, avatar_url FROM publish_bio_pages
    WHERE org_id = ${orgId}::uuid ORDER BY brand, title`);
}

export function listBioLinks(orgId: string, pageId: string) {
  return q<BioLinkRow>(sql`SELECT id, page_id, title, url, image_url, ${iso('starts_at')} AS starts_at,
      ${iso('ends_at')} AS ends_at, pinned, delivery_id
    FROM publish_bio_links WHERE org_id = ${orgId}::uuid AND page_id = ${pageId}::uuid
    ORDER BY pinned DESC, starts_at DESC LIMIT 300`);
}

/** Public read: only links that are live right now. No org id: the slug is the address. */
export async function publicBioPage(slug: string) {
  const pages = await q<BioPageRow>(sql`SELECT id, slug, title, brand, avatar_url FROM publish_bio_pages WHERE slug = ${slug}`);
  const page = pages[0];
  if (!page) return null;
  const links = await q<{ id: string; title: string; url: string; image_url: string | null; pinned: boolean }>(sql`
    SELECT id, title, url, image_url, pinned FROM publish_bio_links
     WHERE page_id = ${page.id}::uuid AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now())
     ORDER BY pinned DESC, starts_at DESC LIMIT 40`);
  return { page, links };
}

/* ------------------------------------------------------------------ feeds */

export interface FeedRow {
  id: string; label: string; url: string; target_ids: string[]; templates: Record<string, string>;
  include_categories: string[]; exclude_keywords: string[];
  window_minutes: number; require_approval: boolean; active: boolean;
  last_polled_at: string | null; last_error: string | null; org_id?: string;
}

export function listFeeds(orgId: string) {
  return q<FeedRow>(sql`SELECT id, label, url, target_ids, templates, include_categories, exclude_keywords,
      window_minutes, require_approval, active,
      ${iso('last_polled_at')} AS last_polled_at, last_error
    FROM publish_feeds WHERE org_id = ${orgId}::uuid ORDER BY label`);
}

/* ----------------------------------------------------------------- pause */

export async function getPause(orgId: string) {
  const rows = await q<{ paused: boolean; paused_by: string | null; paused_at: string | null }>(sql`
    SELECT paused, paused_by, ${iso('paused_at')} AS paused_at FROM publish_settings WHERE org_id = ${orgId}::uuid`);
  return rows[0] ?? { paused: false, paused_by: null, paused_at: null };
}
