import 'server-only';
import { sql } from 'drizzle-orm';
import { decrypt, encrypt, encryptJson } from '@/lib/crypto';
import { PUBLISH_PLATFORMS, type PublishPlatform } from './platforms';
import { createBrandProfile, linkedAccounts, linkingUrl } from './providers/ayrshare-profiles';
import { insertTarget, listLinkableChannels, listTargets, q, updateTarget } from './store';
import type { PostingRule } from './slots';

/**
 * Brand onboarding. "Connect accounts" for a brand:
 *   1. creates (once) an Ayrshare profile for the brand and keeps its key,
 *   2. hands back Ayrshare's sign-in page for that profile,
 *   3. after the editor clicks Done there, reads which networks were linked
 *      and makes or updates a publishing account for each one.
 */

const DAILY_NEWS: PostingRule[] = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ weekday: d, startMinute: 6 * 60, endMinute: 23 * 60 }));
const WEEKDAY_BUSINESS: PostingRule[] = [1, 2, 3, 4, 5].map((d) => ({ weekday: d, startMinute: 7 * 60 + 30, endMinute: 18 * 60 }));

export interface BrandConnection {
  brand: string;
  connected: boolean;
  last_synced_at: string | null;
}

export async function listBrandConnections(orgId: string): Promise<BrandConnection[]> {
  return q<BrandConnection>(sql`SELECT brand, true AS connected,
      to_char(last_synced_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_synced_at
    FROM publish_brand_profiles WHERE org_id = ${orgId}::uuid ORDER BY brand`);
}

async function profileKeyFor(orgId: string, brand: string, create: boolean): Promise<string | null> {
  const rows = await q<{ profile_key_enc: string }>(sql`SELECT profile_key_enc FROM publish_brand_profiles
    WHERE org_id = ${orgId}::uuid AND brand = ${brand}`);
  if (rows[0]) return decrypt(rows[0].profile_key_enc);
  if (!create) return null;
  // Ayrshare titles must be unique across the account; the org id keeps two orgs' "Boston.com" apart.
  const created = await createBrandProfile(`${brand} (${orgId.slice(0, 8)})`);
  await q(sql`INSERT INTO publish_brand_profiles (org_id, brand, profile_key_enc, ref_id)
    VALUES (${orgId}::uuid, ${brand}, ${encrypt(created.profileKey)}, ${created.refId})
    ON CONFLICT (org_id, brand) DO NOTHING`);
  return created.profileKey;
}

export async function startConnect(orgId: string, brand: string, returnTo: string): Promise<string> {
  const profileKey = await profileKeyFor(orgId, brand, true);
  return linkingUrl(profileKey!, returnTo);
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().replace(/^@/, '').replace(/\.bsky\.social$/, '');

/** Read what the brand linked on Ayrshare and make a publishing account for each network. */
export async function syncBrand(orgId: string, brand: string) {
  const profileKey = await profileKeyFor(orgId, brand, false);
  if (!profileKey) return { added: [] as string[], updated: [] as string[], linked: 0 };
  const accounts = (await linkedAccounts(profileKey))
    .filter((a): a is typeof a & { platform: PublishPlatform } => (PUBLISH_PLATFORMS as readonly string[]).includes(a.platform));
  const [existing, channels] = await Promise.all([listTargets(orgId), listLinkableChannels(orgId)]);
  const added: string[] = [];
  const updated: string[] = [];

  for (const a of accounts) {
    const handle = a.username ? '@' + a.username.replace(/^@/, '') : null;
    // Learn best hours from the tracked channel with the same handle, else this brand's channel on that network.
    const channel =
      channels.find((c) => c.platform === a.platform && norm(c.handle) === norm(a.username)) ??
      channels.find((c) => c.platform === a.platform && norm(c.company) === norm(brand)) ??
      null;
    const current = existing.find((t) => t.brand === brand && t.platform === a.platform);
    const secretEnc = encryptJson({ profileKey });
    if (current) {
      // A Bluesky account already set up for direct posting (link cards) keeps its app password.
      const keepDirect = current.provider === 'bluesky' && current.has_secret;
      await updateTarget(orgId, current.id, {
        brand, platform: a.platform, label: a.displayName || current.label, handle: handle ?? current.handle,
        provider: keepDirect ? 'bluesky' : 'ayrshare', secretEnc: keepDirect ? undefined : secretEnc,
        channelId: current.channel_id ?? channel?.id ?? null, utm: current.utm, rules: current.rules,
        minGapMinutes: current.min_gap_minutes, maxPerDay: current.max_per_day, active: true,
      });
      updated.push(a.platform);
    } else {
      await insertTarget(orgId, {
        brand, platform: a.platform, label: a.displayName || 'Main', handle, provider: 'ayrshare', secretEnc,
        channelId: channel?.id ?? null, utm: {},
        rules: a.platform === 'linkedin' ? WEEKDAY_BUSINESS : DAILY_NEWS,
        minGapMinutes: a.platform === 'instagram' ? 120 : 30, maxPerDay: null, active: true,
      });
      added.push(a.platform);
    }
  }
  await q(sql`UPDATE publish_brand_profiles SET last_synced_at = now() WHERE org_id = ${orgId}::uuid AND brand = ${brand}`);
  return { added, updated, linked: accounts.length };
}
