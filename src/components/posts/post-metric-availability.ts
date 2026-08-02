import type { Platform, PostType } from '@/lib/types';

export type PostComponentMetric =
  | 'applause'
  | 'conversation'
  | 'amplification'
  | 'saves'
  | 'views';

/**
 * Whether a stored post-component value is safe to present as reported.
 *
 * Adapters currently persist unsupported metrics as zero, so a zero is not
 * universally evidence of no reactions. Positive values are always reported;
 * platform rules below distinguish measured zeroes from unsupported fields.
 */
export function isPostMetricReported(
  platform: Platform,
  _type: PostType,
  metric: PostComponentMetric,
  value: number,
): boolean {
  if (value > 0) return true;

  switch (platform) {
    case 'bluesky':
    case 'threads':
      return metric === 'applause' || metric === 'conversation' || metric === 'amplification';
    case 'reddit':
      // Community rows from EnsembleData report crossposts, but Bright Data's
      // author feed does not guarantee that field. Until availability is stored
      // per post, a positive value is evidence and a zero is conservatively blank.
      return metric === 'applause' || metric === 'conversation';
    case 'facebook':
      return metric === 'applause' || metric === 'conversation' || metric === 'amplification';
    case 'instagram':
      return metric === 'applause' || metric === 'conversation';
    case 'tiktok':
      return true;
    case 'twitter':
      return metric === 'applause' || metric === 'conversation' || metric === 'amplification';
    case 'youtube':
      return metric === 'applause' || metric === 'conversation' || metric === 'views';
    case 'linkedin':
    case 'rss':
      return false;
  }
}
