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
 *  - **Comparable once the paperwork clears**: `facebook`. CrowdTangle was shut
 *    down on 14 August 2024, but Meta still ships Page Public Content Access,
 *    an App Review feature that lets a live app read public posts, comments and
 *    engagement for Pages it does not administer. Until an org is approved and
 *    says so in its credentials, Facebook behaves as owned-only; after that it
 *    is comparable, with the same engagement fields as an owned Page.
 *  - **Owned only, full stop**: `tiktok` (Display API reads only the token
 *    holder; the Research API is application-gated and bars commercial use),
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
 * Platforms that describe only channels the org holds a token for, *by default*.
 * The UI uses this to keep such a platform out of a competitor comparison
 * instead of charting it as zero.
 *
 * "By default" is load-bearing for Facebook and only Facebook. Two of these
 * three are permanent; the Facebook entry is a statement about paperwork, not
 * about the API, and `isOwnedOnly` lifts it once the org's credentials say Page
 * Public Content Access has been granted.
 */
export const OWNED_ONLY_PLATFORMS: Partial<Record<Platform, string>> = {
  facebook: 'Facebook competitor Pages need Page Public Content Access, a Meta App Review feature '
    + 'requiring business verification and a working demonstration. Until this org is approved and '
    + 'sets the ppcaApproved credential, only Pages you administer can be read. '
    + 'See docs/META-PPCA-APPLICATION.md.',
  tiktok: 'The TikTok Display API only reads the account that granted the token, and the Research API '
    + 'prohibits commercial use. Competitor TikTok is therefore purchased: set a Bright Data API key '
    + 'and competitor channels read normally, with full parity on views and engagement rate by view. '
    + 'Without that key, only accounts you own can be read. See docs/DATA-ACCESS.md.',
  linkedin: 'LinkedIn exposes no read endpoint for another organisation\'s page at any price.',
};

/** Credential values that count as "yes". Mirrors the Facebook adapter. */
const AFFIRMATIVE = new Set(['1', 'true', 'yes', 'y', 'on', 'approved', 'granted']);

/**
 * True when this platform can only report on channels the org owns.
 *
 * Pass the org's credentials for that platform where you have them. Without
 * them the answer is the conservative one, which is what every existing caller
 * wants: better to hide a Facebook competitor column that would have worked than
 * to show one that fails on every run.
 */
export function isOwnedOnly(platform: Platform, credentials?: Record<string, string>): boolean {
  if (OWNED_ONLY_PLATFORMS[platform] === undefined) return false;
  if (platform === 'facebook' && credentials) {
    const declared = credentials.ppcaApproved?.trim().toLowerCase();
    if (declared !== undefined && AFFIRMATIVE.has(declared)) return false;
  }
  return true;
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
