import type { Platform } from '@/lib/types';
import type { FetchResult } from './types';

export const PUBLIC_SOURCE_KEYS = [
  'bluesky-public-appview',
  'brightdata',
  'ensembledata',
  'apify-truth-social',
  'youtube-data-api-v3',
  // The official X API under app-only authentication. Public-basis since X
  // made impression_count public (verified live 17 Aug 2026); adopted as the
  // primary X source the same day. The first fleet-wide run after the source
  // order flipped was refused HERE, by this registry, because the order and
  // the credential allowlist were updated and this list was not: seventeen
  // channels landed in operator review with zero observations written. That
  // is this module doing its job. A new pooled source exists only when all
  // three layers say so.
  'x-api-v2',
] as const;

export type PublicSourceKey = typeof PUBLIC_SOURCE_KEYS[number];

const VENDOR_SOURCES = new Set<PublicSourceKey>(['brightdata', 'ensembledata', 'apify-truth-social']);

/**
 * Truthful placeholder for an attempt that has not reached a source yet.
 *
 * A run row is created before network access. Multi-source adapters can select
 * a fallback only after the primary fails, so the exact source is deliberately
 * unresolved until a response arrives. Observation writes are forbidden while
 * a run still carries this value.
 */
export function unselectedPublicSourceKey(platform: Platform): string {
  return `unselected:${platform}`;
}

function claimedVendorSource(fetched: Pick<FetchResult, 'cursor' | 'profile'>): string | undefined {
  const cursorSource = fetched.cursor?.source;
  if (typeof cursorSource === 'string' && cursorSource.trim()) {
    return cursorSource.trim().toLowerCase();
  }

  const profileSource = fetched.profile?.meta?.source;
  return typeof profileSource === 'string' && profileSource.trim()
    ? profileSource.trim().toLowerCase()
    : undefined;
}

function requireVendor(
  platform: Platform,
  fetched: Pick<FetchResult, 'cursor' | 'profile'>,
  allowed: ReadonlySet<PublicSourceKey>,
): PublicSourceKey {
  const claimed = claimedVendorSource(fetched);
  if (!claimed) {
    throw new Error(
      `The ${platform} source response did not identify its vendor. `
        + 'No pooled observations may be written without exact public-source provenance.',
    );
  }
  if (!allowed.has(claimed as PublicSourceKey)) {
    throw new Error(
      `The ${platform} source response claimed unsupported public source "${claimed}". `
        + 'No pooled observations were written.',
    );
  }
  return claimed as PublicSourceKey;
}

/**
 * Resolve the exact public-comparable source that produced a response.
 *
 * Official open APIs have one deterministic deployment source. Vendor-backed
 * adapters must identify the actual winner, including fallback responses. The
 * function is default-deny so an adapter change cannot silently introduce a
 * new pooled source without an allowlist and tests.
 */
export function publicSourceKeyForFetch(
  platform: Platform,
  fetched: Pick<FetchResult, 'cursor' | 'profile'>,
): PublicSourceKey {
  switch (platform) {
    case 'bluesky': {
      const claimed = claimedVendorSource(fetched);
      if (claimed && claimed !== 'bluesky-public-appview' && claimed !== 'bluesky') {
        throw new Error(
          `The Bluesky response claimed unsupported public source "${claimed}". `
            + 'No pooled observations were written.',
        );
      }
      return 'bluesky-public-appview';
    }
    case 'youtube': {
      const claimed = claimedVendorSource(fetched);
      if (claimed && claimed !== 'youtube-data-api-v3' && claimed !== 'youtube') {
        throw new Error(
          `The YouTube response claimed unsupported public source "${claimed}". `
            + 'No pooled observations were written.',
        );
      }
      return 'youtube-data-api-v3';
    }
    case 'facebook':
      return requireVendor(platform, fetched, new Set<PublicSourceKey>(['brightdata']));
    case 'reddit':
      return requireVendor(platform, fetched, new Set<PublicSourceKey>(['ensembledata']));
    case 'instagram':
    case 'threads':
    case 'tiktok':
      return requireVendor(platform, fetched, VENDOR_SOURCES);
    case 'twitter':
      // Official API first, vendors as the degradation path.
      return requireVendor(platform, fetched,
        new Set<PublicSourceKey>(['x-api-v2', 'brightdata', 'ensembledata']));
    case 'linkedin':
      return requireVendor(platform, fetched, new Set<PublicSourceKey>(['brightdata']));
    case 'truth_social':
      return requireVendor(platform, fetched, new Set<PublicSourceKey>(['apify-truth-social']));
    case 'rss':
      throw new Error('RSS ingestion is retired. No pooled observations were written.');
  }
}
