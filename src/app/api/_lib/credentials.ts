/**
 * Decrypted platform credentials for an org, in the shape adapters expect.
 *
 * Two sources, in priority order:
 *   1. platform_credentials rows for the org, AES-GCM encrypted at rest.
 *   2. process.env, as a deployment-wide fallback.
 *
 * The env fallback exists so a single-tenant deployment can be useful before
 * anyone has opened Settings, and the per-org row wins so a shared deployment
 * never leaks one newsroom's quota into another's ingestion.
 *
 * A credential that fails to decrypt is dropped rather than thrown on. A
 * rotated ENCRYPTION_KEY should degrade an integration to "unauthenticated",
 * which the adapters handle, not take down the whole endpoint.
 */
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { platformCredentials } from '@/db/schema';
import { decryptJson } from '@/lib/crypto';
import type { Platform } from '@/lib/types';

/** Env vars that stand in for a stored credential, keyed by adapter field name. */
const ENV_FALLBACKS: Partial<Record<Platform, Record<string, string | undefined>>> = {
  youtube: { apiKey: process.env.YOUTUBE_API_KEY },
  bluesky: {
    identifier: process.env.BLUESKY_IDENTIFIER,
    appPassword: process.env.BLUESKY_APP_PASSWORD,
  },
  twitter: {
    bearerToken: process.env.TWITTER_BEARER_TOKEN,
    ensembleDataToken: process.env.ENSEMBLEDATA_TOKEN,
    brightDataApiKey: process.env.BRIGHTDATA_API_KEY,
  },
  facebook: { accessToken: process.env.META_ACCESS_TOKEN },
  instagram: { accessToken: process.env.META_ACCESS_TOKEN },
  threads: { accessToken: process.env.META_ACCESS_TOKEN },
  linkedin: { accessToken: process.env.LINKEDIN_ACCESS_TOKEN },
  tiktok: {
    clientKey: process.env.TIKTOK_CLIENT_KEY,
    clientSecret: process.env.TIKTOK_CLIENT_SECRET,
  },
  reddit: {
    ensembleDataToken: process.env.ENSEMBLEDATA_TOKEN,
  },
};

function fromEnv(platform: Platform): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(ENV_FALLBACKS[platform] ?? {})) {
    if (value) out[key] = value;
  }
  return out;
}

export async function loadCredentials(
  orgId: string,
  platform: Platform,
): Promise<Record<string, string>> {
  const credentials = fromEnv(platform);

  const rows = await db
    .select({ encrypted: platformCredentials.encrypted })
    .from(platformCredentials)
    .where(and(
      eq(platformCredentials.orgId, orgId),
      eq(platformCredentials.platform, platform),
    ));

  for (const row of rows) {
    try {
      const decoded = decryptJson<Record<string, unknown>>(row.encrypted);
      for (const [key, value] of Object.entries(decoded)) {
        if (typeof value === 'string' && value.length > 0) credentials[key] = value;
      }
    } catch {
      // Undecryptable row: treated as absent. See the note at the top.
    }
  }

  return credentials;
}
