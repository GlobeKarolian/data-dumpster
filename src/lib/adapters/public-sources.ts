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
      // The app-only Bearer token is a deployment credential reading the same
      // public surface any API consumer sees, including impression_count,
      // which X made public (verified live 17 Aug 2026). It is therefore a
      // pooled public source exactly like a vendor key. What stays excluded is
      // any organization's user-context X token: those can reach non-public
      // metrics and would change the basis of shared rows.
      pick(out, 'bearerToken', environment.TWITTER_BEARER_TOKEN);
      pick(out, 'brightDataApiKey', brightDataKey);
      // EnsembleData remains for onboarding's synchronous profile lookup and
      // as the last-resort collection fallback.
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
    case 'truth_social':
      pick(out, 'apifyApiToken', environment.APIFY_API_TOKEN);
      break;
    // Bluesky reads the public appview without authentication, so its account
    // identifier and app password are deliberately excluded.
    case 'bluesky':
    default:
      break;
  }
  return out;
}
