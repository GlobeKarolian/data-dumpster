import type { Platform } from '@/lib/types';

/**
 * Deployment credentials that are safe for globally pooled collection and
 * profile resolution.
 *
 * This is deliberately an allowlist, not a filter over all configured keys.
 * Org credentials and owned/admin tokens can expose saves, reach, impressions,
 * or non-public posts. Landing any of that in shared rows would cross tenant
 * boundaries. Public vendor credentials are deployment-wide because their
 * response is the same regardless of which org requested the operation.
 */
export function publicSourceCredentials(
  platform: Platform,
  environment: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const pick = (out: Record<string, string>, key: string, value: string | undefined): void => {
    const trimmed = value?.trim();
    if (trimmed) out[key] = trimmed;
  };
  const out: Record<string, string> = {};
  const brightDataKey = environment.BRIGHTDATA_API_KEY?.trim();
  const ensembleToken = environment.ENSEMBLEDATA_TOKEN?.trim();

  const pickBrightDataOrEnsemble = (): void => {
    if (brightDataKey) {
      out.brightDataApiKey = brightDataKey;
      return;
    }
    if (ensembleToken) out.ensembleDataToken = ensembleToken;
  };

  switch (platform) {
    case 'youtube':
      pick(out, 'apiKey', environment.YOUTUBE_API_KEY);
      break;
    case 'facebook':
      pick(out, 'brightDataApiKey', brightDataKey);
      break;
    case 'instagram':
      pickBrightDataOrEnsemble();
      break;
    case 'twitter':
      // Collection uses Bright Data exclusively when it is configured. Keep
      // EnsembleData alongside it only because X onboarding still needs the
      // vendor's synchronous profile endpoint until Bright Data has a separate,
      // receipt-preserving profile mapper.
      pick(out, 'brightDataApiKey', brightDataKey);
      pick(out, 'ensembleDataToken', ensembleToken);
      break;
    case 'tiktok':
      pickBrightDataOrEnsemble();
      break;
    case 'threads':
      pickBrightDataOrEnsemble();
      break;
    case 'reddit':
      pick(out, 'ensembleDataToken', ensembleToken);
      break;
    case 'linkedin':
      pick(out, 'brightDataApiKey', brightDataKey);
      break;
    // Bluesky reads the public appview without authentication, so its account
    // identifier and app password are deliberately excluded.
    case 'bluesky':
    default:
      break;
  }
  return out;
}
