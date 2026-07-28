/**
 * The adapter registry.
 *
 * This is the file that makes the "add a platform = add a file" promise real.
 * Nothing outside `lib/adapters` imports a specific adapter; the runner, the
 * settings UI and the channel-creation flow all go through `getAdapter` and
 * `listAdapters`.
 *
 * The map is deliberately `Partial<Record<Platform, …>>` rather than a complete
 * record. `Platform` enumerates every platform the *schema* can store, which is
 * intentionally ahead of what we can actually read — Instagram and TikTok rows
 * may exist from a CSV import long before there is an adapter for them. A
 * partial map lets the type system force every caller to handle "we can store
 * this but cannot fetch it", instead of pretending the gap does not exist.
 */
import type { Platform } from '@/lib/types';
import { PLATFORM_LABELS, PLATFORMS } from '@/lib/types';
import { AdapterError, type ChannelAdapter } from './types';
import { blueskyAdapter } from './bluesky';
import { rssAdapter } from './rss';
import { youtubeAdapter } from './youtube';
import { facebookAdapter, instagramAdapter } from './meta';
import { twitterAdapter } from './twitter';
import { tiktokAdapter } from './tiktok';
import { linkedinAdapter } from './linkedin';

export const ADAPTERS: Partial<Record<Platform, ChannelAdapter>> = {
  facebook: facebookAdapter,
  instagram: instagramAdapter,
  twitter: twitterAdapter,
  youtube: youtubeAdapter,
  tiktok: tiktokAdapter,
  linkedin: linkedinAdapter,
  bluesky: blueskyAdapter,
  rss: rssAdapter,
};

/**
 * IMPORTANT: an adapter existing does not mean competitor data exists.
 *
 * Five of the eight adapters above are owned-channel integrations wearing the
 * same interface as the open ones, and conflating the two is how a competitive
 * tool ends up quietly comparing a full picture of ourselves against an empty
 * one of everyone else. The honest split, as of 2026:
 *
 *  - **Comparable across competitors**: `bluesky` (open AT Protocol appview, no
 *    key at all), `youtube` (public Data API key), `rss` (open by definition),
 *    `twitter` (paid, but a Bearer token reads any public account).
 *  - **Owned only, with a thin competitor exception**: `instagram`, via the
 *    Graph Business Discovery edge — followers, media, likes and comments for
 *    public Business/Creator accounts, and nothing else.
 *  - **Owned only, full stop**: `facebook` (CrowdTangle was shut down on
 *    14 August 2024 and the Meta Content Library that replaced it is
 *    research-gated), `tiktok` (Display API reads only the token holder;
 *    the Research API is application-gated and bars commercial use),
 *    `linkedin` (no read path for another organisation's page at any price).
 *
 * Each adapter's `accessNotes` says this in the UI. `docs/DATA-ACCESS.md` has
 * the costs, the approval burden and the recommended acquisition strategy.
 */
export const UNIMPLEMENTED_REASONS: Partial<Record<Platform, string>> = {
  threads: 'The Threads API is limited to accounts you own, and there is no competitor read path.',
  reddit: 'Not built yet — Reddit\'s public JSON endpoints make this the next viable adapter.',
};

/**
 * Platforms where an adapter exists but can only ever describe channels the org
 * holds a token for. The UI uses this to keep an owned-only platform out of a
 * competitor comparison instead of charting it as zero.
 */
export const OWNED_ONLY_PLATFORMS: Partial<Record<Platform, string>> = {
  facebook: 'Facebook serves no competitor data since the CrowdTangle shutdown in August 2024. '
    + 'Only Pages you administer can be read.',
  tiktok: 'The TikTok Display API only reads the account that granted the token. Competitor data '
    + 'requires the application-gated Research API, which prohibits commercial use.',
  linkedin: 'LinkedIn exposes no read endpoint for another organisation\'s page at any price.',
};

/** True when this platform can only report on channels the org owns. */
export function isOwnedOnly(platform: Platform): boolean {
  return OWNED_ONLY_PLATFORMS[platform] !== undefined;
}

/**
 * Look up an adapter, or throw with something a support engineer can act on.
 *
 * Throwing rather than returning `undefined` is deliberate: every call site
 * reached here because a channel row already claims this platform, so a missing
 * adapter is a real configuration problem and should surface as a failed
 * ingestion run with a readable reason, not as a silent skip.
 */
export function getAdapter(platform: Platform): ChannelAdapter {
  const adapter = ADAPTERS[platform];
  if (adapter) return adapter;

  const known = (PLATFORMS as readonly string[]).includes(platform);
  const label = PLATFORM_LABELS[platform] ?? platform;
  const reason = UNIMPLEMENTED_REASONS[platform];

  const message = known
    ? `No adapter is implemented for ${label}.${reason ? ` ${reason}` : ''} `
      + `Implemented platforms: ${listAdapters().map((a) => a.displayName).join(', ')}.`
    : `"${String(platform)}" is not a platform this system knows about. `
      + `Valid platforms: ${PLATFORMS.join(', ')}.`;

  throw new AdapterError(message, { platform, retryable: false });
}

/** True when a platform can actually be fetched. Use this to decide whether to
 *  offer a platform in the "add channel" picker. */
export function hasAdapter(platform: Platform): boolean {
  return ADAPTERS[platform] !== undefined;
}

/**
 * Every implemented adapter, in a stable order that matches `PLATFORMS` so the
 * settings page does not reshuffle itself between renders.
 */
export function listAdapters(): ChannelAdapter[] {
  return PLATFORMS.map((p) => ADAPTERS[p]).filter((a): a is ChannelAdapter => a !== undefined);
}

/** Adapters an org can use without configuring anything. Surfaced first in the
 *  UI, because "works immediately" is the difference between a tool that gets
 *  adopted and one that stalls on an API application. */
export function listUnauthenticatedAdapters(): ChannelAdapter[] {
  return listAdapters().filter((a) => a.worksUnauthenticated);
}
