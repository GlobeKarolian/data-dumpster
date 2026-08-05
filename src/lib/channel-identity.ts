import type { Platform } from '@/lib/types';

const YOUTUBE_CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;

/**
 * Stable, globally comparable fallback identity for a stored public account.
 *
 * Platform-native ids remain the primary identity whenever they are available.
 * This key closes the gap before resolution and prevents case or prefix
 * variants of the same handle from creating a second pooled channel.
 */
export function channelIdentityKey(platform: Platform, handle: string): string {
  const trimmed = handle.trim();

  if (platform === 'youtube' && YOUTUBE_CHANNEL_ID.test(trimmed.replace(/^@/, ''))) {
    // YouTube channel ids are case-sensitive. Handles are not.
    return 'channel:' + trimmed.replace(/^@/, '');
  }

  if (platform === 'reddit') {
    const candidate = trimmed.replace(/^\/+|\/+$/g, '').toLowerCase();
    const match = candidate.match(/^(r|u|user)\/(.+)$/);
    if (match) {
      return (match[1] === 'r' ? 'subreddit:' : 'user:') + match[2];
    }
    // Bare Reddit rows predate account-first collection and represent legacy
    // subreddits. New user accounts are always stored as u/<name>.
    return 'subreddit:' + candidate;
  }

  const did = platform === 'bluesky'
    ? trimmed.match(/^did:([^:]+):(.+)$/i)
    : null;
  if (did) {
    // A DID is already a stable identifier. Preserve its method-specific case.
    return 'did:' + did[1].toLowerCase() + ':' + did[2];
  }

  return 'handle:' + trimmed.replace(/^@/, '').toLowerCase();
}

/** Empty vendor ids are absence, not an account identity. */
export function channelExternalIdentity(externalId: string | null | undefined): string | null {
  const normalized = externalId?.trim() ?? '';
  return normalized.length > 0 ? normalized : null;
}
