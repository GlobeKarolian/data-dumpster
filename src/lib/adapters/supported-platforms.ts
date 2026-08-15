import type { Platform } from '@/lib/types';

/**
 * Platforms with a real ChannelAdapter.
 *
 * This file is intentionally data-only so client pickers can share the
 * registry's source of truth without pulling vendor clients into the browser.
 */
export const ADAPTER_SUPPORTED_PLATFORMS = [
  'facebook',
  'instagram',
  'twitter',
  'threads',
  'youtube',
  'tiktok',
  'linkedin',
  'bluesky',
  'reddit',
  'truth_social',
] as const satisfies readonly Platform[];

export type AdapterSupportedPlatform = (typeof ADAPTER_SUPPORTED_PLATFORMS)[number];

/**
 * User-facing source policy for globally pooled collection.
 *
 * Keep this data-only so the Settings client can explain the operative routes
 * without importing adapters, vendor clients, or deployment configuration.
 */
export const POOLED_SOURCE_DISCLOSURE = {
  vendors: 'Bright Data is the primary purchased public source for Facebook, Instagram, TikTok, X, Threads and LinkedIn. Truth Social uses the approved Apify actor. YouTube and Bluesky keep their sanctioned public interfaces; Reddit keeps its existing publisher-account source until a like-for-like Bright Data feed is verified.',
  facebook: 'Existing Facebook profiles use Bright Data only. New Facebook profile onboarding remains unavailable while verification would purchase the same crawl twice.',
  meta: 'Meta / PPCA is not connected to pooled collection. Meta verification does not activate it in Settings or change the source route.',
} as const;

/**
 * Platforms a user may add to the globally pooled public benchmark with a
 * separate public profile-resolution endpoint.
 *
 * Facebook is temporarily absent because its current Bright Data contract
 * exposes identity only as part of the paid posts crawl. Verification followed
 * by collection would purchase that crawl twice.
 */
export const ADDABLE_PUBLIC_PROFILE_PLATFORMS = [
  'instagram',
  'twitter',
  'threads',
  'youtube',
  'tiktok',
  'linkedin',
  'bluesky',
  'reddit',
  'truth_social',
] as const satisfies readonly AdapterSupportedPlatform[];

export function nextAddablePublicPlatform(
  existing: readonly Platform[],
): (typeof ADDABLE_PUBLIC_PROFILE_PLATFORMS)[number] | null {
  return ADDABLE_PUBLIC_PROFILE_PLATFORMS.find((platform) => !existing.includes(platform)) ?? null;
}

/** Clear server-side reasons for public profile types that cannot be onboarded. */
export function publicProfileOnboardingUnavailableReason(platform: Platform): string | null {
  if (platform === 'facebook') {
    return 'New Facebook profiles are temporarily unavailable. The configured public source returns '
      + 'identity only inside its paid posts crawl, and verification cannot purchase that crawl twice. '
      + 'Existing Facebook profiles continue collecting public data.';
  }
  return null;
}
