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
] as const satisfies readonly Platform[];

export type AdapterSupportedPlatform = (typeof ADAPTER_SUPPORTED_PLATFORMS)[number];
