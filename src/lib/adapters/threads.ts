/**
 * Threads.
 *
 * Meta's official Threads API reads only the account that granted the token,
 * exactly like the TikTok Display API, so it is useless for a competitive tool.
 * This adapter is vendor-backed from the start rather than having an owned path
 * that falls back to a purchased one.
 *
 * Threads is the one platform here where amplification is genuinely rich: the
 * payload separates reshares from off-platform shares. Both are summed into
 * amplification because the metric vocabulary treats them as one concept, and
 * both are preserved in the raw payload for anyone who later wants to split them.
 *
 * Handles match Instagram, because a Threads account is created from an
 * Instagram login.
 */
import { AdapterError } from './types';
import type {
  AdapterProfile, ChannelAdapter, FetchContext, FetchResult,
  NormalizedAudience, NormalizedPost,
} from './types';
import { DATASETS, scrapeSync, rowError, isErrorRow } from '@/lib/vendors/brightdata';
import { extractHashtags, extractMentions, extractUrls, toDayString } from './util/normalize';
import type { Platform } from '@/lib/types';

const PLATFORM: Platform = 'threads';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function pick(row: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

function num(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.trunc(v));
  if (typeof v === 'string') {
    const n = Number(v.replace(/[, ]/g, ''));
    if (Number.isFinite(n)) return Math.max(0, Math.trunc(n));
  }
  return 0;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function toDate(v: unknown): Date | undefined {
  if (typeof v === 'number') {
    const d = new Date(v < 1e12 ? v * 1000 : v);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  if (typeof v === 'string') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  return undefined;
}

function profileUrl(handle: string): string {
  return 'https://www.threads.com/@' + handle;
}

function requireVendorKey(credentials: Record<string, string>): string {
  const key = credentials.brightDataApiKey ?? process.env.BRIGHTDATA_API_KEY ?? '';
  if (!key) {
    throw new AdapterError(
      'Threads needs a Bright Data API key. The official Threads API only reads the account that '
      + 'granted the token, so there is no sanctioned competitor path. See docs/DATA-ACCESS.md.',
      { platform: PLATFORM, retryable: false },
    );
  }
  return key;
}

async function readProfile(
  handle: string,
  apiKey: string,
  onApiCall?: () => void,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const rows = await scrapeSync(
    DATASETS.threadsProfile,
    [{ url: profileUrl(handle) }],
    { apiKey, platform: PLATFORM, onApiCall, signal },
  );
  const row = rows.find((r) => isRecord(r) && !isErrorRow(r));
  if (!isRecord(row)) {
    const why = rows.length > 0 ? rowError(rows[0]) : undefined;
    throw new AdapterError(
      'Bright Data returned no Threads profile for @' + handle + (why ? '. ' + why : ''),
      { platform: PLATFORM, retryable: false },
    );
  }
  return row;
}

function toProfile(row: Record<string, unknown>, handle: string): AdapterProfile {
  return {
    externalId: str(pick(row, ['profile_id', 'id'])) ?? handle,
    handle,
    displayName: str(pick(row, ['profile_name', 'full_name'])),
    avatarUrl: str(pick(row, ['profile_picture', 'profile_pic_url'])) ?? null,
    profileUrl: str(row.url) ?? profileUrl(handle),
    followers: num(pick(row, ['number_of_followers', 'followers'])),
    meta: {
      source: 'brightdata',
      isVerified: Boolean(row.verified),
      instagramProfileUrl: str(row.instagram_profile_url) ?? null,
    },
  };
}

export const threadsAdapter: ChannelAdapter = {
  platform: PLATFORM,
  displayName: 'Threads',
  accessNotes:
    'Purchased public data only. The official Threads API reads exclusively the account that granted '
    + 'the token, so there is no sanctioned route to a competitor and no owned-versus-competitor '
    + 'split to make here. With a Bright Data API key, any public Threads account returns followers, '
    + 'post text, likes, replies, reshares and shares. Threads publishes no view count to anyone, so '
    + 'views are always 0. Handles match the Instagram handle, because a Threads account is created '
    + 'from an Instagram login.',
  credentialFields: [
    { key: 'brightDataApiKey', label: 'Bright Data API key', secret: true, required: false,
      help: 'The only route to Threads data. Falls back to the BRIGHTDATA_API_KEY environment variable.' },
  ],
  // Vendor-paced rather than platform-paced: this is about not queueing work
  // faster than it drains, since each read takes tens of seconds.
  rateLimit: { callsPerWindow: 60, windowSeconds: 60 },
  worksUnauthenticated: false,

  parseHandle(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) throw new AdapterError('Empty Threads handle', { platform: PLATFORM, retryable: false });

    let candidate = trimmed;
    if (trimmed.includes('://')) {
      let url: URL;
      try {
        url = new URL(trimmed);
      } catch {
        throw new AdapterError('Unparseable Threads URL: ' + input, { platform: PLATFORM, retryable: false });
      }
      const host = url.hostname.toLowerCase();
      if (!host.endsWith('threads.com') && !host.endsWith('threads.net')) {
        throw new AdapterError('Not a Threads URL: ' + input, { platform: PLATFORM, retryable: false });
      }
      const found = url.pathname.split('/').filter(Boolean).find((s) => s.startsWith('@'));
      if (!found) throw new AdapterError('No account in URL: ' + input, { platform: PLATFORM, retryable: false });
      candidate = found;
    }

    candidate = candidate.replace(/^@/, '').toLowerCase();
    if (!/^[a-z0-9._]{1,30}$/.test(candidate)) {
      throw new AdapterError('Invalid Threads handle: ' + input, { platform: PLATFORM, retryable: false });
    }
    return candidate;
  },

  async resolveProfile(handle: string, credentials: Record<string, string>): Promise<AdapterProfile> {
    const row = await readProfile(handle, requireVendorKey(credentials));
    return toProfile(row, handle);
  },

  async fetch(ctx: FetchContext): Promise<FetchResult> {
    // Preferred vendor first. The profile id is cached on the cursor so only
    // the first run for a channel pays for the handle-to-id search.
    const token = ctx.credentials.ensembleDataToken ?? process.env.ENSEMBLEDATA_TOKEN ?? '';
    if (token) {
      const { resolveId, fetchPosts } = await import('./threads-ensemble');
      const { id, profile, audience } = await resolveId(
        ctx.handle, token, ctx.onApiCall, ctx.signal,
      );
      const { posts, warnings } = await fetchPosts(id, ctx.handle, token, {
        since: ctx.since,
        until: ctx.until,
        onApiCall: ctx.onApiCall,
        signal: ctx.signal,
      });
      return {
        posts,
        audience: audience ? [audience] : [],
        profile,
        cursor: { source: 'ensembledata', threadsId: id, lastRunAt: new Date().toISOString() },
        hasMore: false,
        warnings,
      };
    }

    const apiKey = requireVendorKey(ctx.credentials);
    const row = await readProfile(ctx.handle, apiKey, ctx.onApiCall, ctx.signal);
    const profile = toProfile(row, ctx.handle);
    const warnings: string[] = [];

    const followers = profile.followers ?? 0;
    const audience: NormalizedAudience[] = followers > 0
      ? [{ day: toDayString(new Date()), followers, extra: {} }]
      : [];

    const list = Array.isArray(row.threads) ? row.threads : [];
    const posts: NormalizedPost[] = [];
    let oldest: Date | null = null;

    for (const item of list) {
      if (!isRecord(item)) continue;
      const postedAt = toDate(pick(item, ['post_date', 'date_posted', 'timestamp']));
      if (!postedAt) continue;
      if (!oldest || postedAt < oldest) oldest = postedAt;
      if (postedAt < ctx.since || postedAt > ctx.until) continue;

      const text = str(pick(item, ['post_content_formatted', 'post_content'])) ?? '';

      // These rows carry no stable post id, so derive a deterministic one from
      // the account and timestamp. The upsert key depends on it being stable.
      const externalId = str(pick(item, ['post_id', 'id']))
        ?? profile.externalId + ':' + postedAt.toISOString();

      posts.push({
        externalId,
        postedAt,
        type: 'text',
        text,
        permalink: str(pick(item, ['url', 'post_url'])) ?? profile.profileUrl ?? null,
        mediaUrl: null,
        thumbnailUrl: null,
        durationSec: null,
        language: null,
        hashtags: extractHashtags(text),
        mentions: extractMentions(text),
        urls: extractUrls(text),
        applause: num(pick(item, ['likes', 'likes_amount'])),
        conversation: num(pick(item, ['comments_amount', 'replies'])),
        // Reshares and off-platform shares are distinct actions that both mean
        // amplification. Summed here, preserved separately in raw.
        amplification: num(pick(item, ['reshare_amount'])) + num(pick(item, ['share_amount'])),
        saves: 0,
        views: 0,
        raw: item,
      });
    }

    if (oldest && oldest > ctx.since) {
      warnings.push(
        'Threads for @' + ctx.handle + ': the vendor returned ' + list.length + ' recent posts reaching '
        + 'back to ' + toDayString(oldest) + ', which does not cover the requested window. Older posts '
        + 'are missing rather than absent.',
      );
    }

    return {
      posts,
      audience,
      profile,
      cursor: { source: 'brightdata', lastRunAt: new Date().toISOString() },
      hasMore: false,
      warnings,
    };
  },
};

export default threadsAdapter;
