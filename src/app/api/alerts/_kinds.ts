/**
 * The alert kinds, mirrored from the alert_kind enum in the schema.
 *
 * Lives beside the routes rather than inside route.ts so both the collection and
 * the item endpoint import the same list, and so route files export nothing but
 * HTTP methods and segment config.
 */
export const ALERT_KINDS = [
  'competitor_outlier', 'audience_swing', 'volume_drop',
  'new_channel', 'keyword_hit', 'share_of_voice_shift', 'custom',
] as const;

export type AlertKind = (typeof ALERT_KINDS)[number];
