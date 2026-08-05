const OPERATOR_META_KEYS = ['disabledReason', 'disabledAt'] as const;

/** Public profile fields allowed to cross the pooled channel boundary. */
const PUBLIC_PROFILE_KEYS = new Set(['source', 'isVerified', 'verifiedType', 'category', 'mediaCount']);

export function sanitizePublicProfileMeta(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of PUBLIC_PROFILE_KEYS) {
    const value = meta[key];
    if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') out[key] = value;
  }
  return out;
}

/** Numeric audience extras are pooled facts; unknown vendor keys are dropped. */
const PUBLIC_AUDIENCE_KEYS = new Set([
  'posts', 'postCount', 'mediaCount', 'fanCount', 'subscriberCount', 'totalViews',
]);

export function sanitizePooledAudienceExtra(extra: Record<string, number> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of PUBLIC_AUDIENCE_KEYS) {
    const value = extra?.[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) out[key] = Math.round(value);
  }
  return out;
}

/** Merge refreshed public metadata without erasing global operator controls. */
export function mergePublicChannelMeta(
  existing: Record<string, unknown>,
  refreshedPublic: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...existing, ...refreshedPublic };
  for (const key of OPERATOR_META_KEYS) {
    if (Object.prototype.hasOwnProperty.call(existing, key)) merged[key] = existing[key];
  }
  return merged;
}
