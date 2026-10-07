/**
 * Ayrshare account onboarding: one Ayrshare "User Profile" per brand, and
 * Ayrshare's hosted page where a brand's social admin signs in to each
 * network. Nobody copies keys: the profile key is created and stored by the
 * server, and the linked accounts are read back after the editor clicks Done.
 *
 * Shapes from Ayrshare's docs (read 6 Oct 2026): POST /profiles,
 * POST /profiles/generateJWT, GET /user. Raw responses are passed through in
 * errors so a mismatch is visible on first use.
 */
const BASE = 'https://api.ayrshare.com/api';

export class AyrshareSetupError extends Error {}

function key(): string {
  const k = process.env.AYRSHARE_API_KEY;
  if (!k) throw new AyrshareSetupError('Add AYRSHARE_API_KEY in Vercel to connect accounts.');
  return k;
}

function xHeaders(): Record<string, string> {
  const k = process.env.AYRSHARE_X_API_KEY;
  const s = process.env.AYRSHARE_X_API_SECRET;
  return k && s ? { 'X-Twitter-OAuth1-Api-Key': k, 'X-Twitter-OAuth1-Api-Secret': s } : {};
}

async function call<T>(path: string, init: { method: string; body?: unknown; profileKey?: string }): Promise<T> {
  const headers: Record<string, string> = { authorization: 'Bearer ' + key(), 'content-type': 'application/json', ...xHeaders() };
  if (init.profileKey) headers['Profile-Key'] = init.profileKey;
  const res = await fetch(BASE + path, {
    method: init.method, headers, body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => ({}))) as T & { status?: string; message?: string };
  if (!res.ok || json.status === 'error') {
    throw new AyrshareSetupError(`Ayrshare ${path} failed (${res.status}): ${json.message ?? JSON.stringify(json).slice(0, 300)}`);
  }
  return json;
}

export async function createBrandProfile(title: string): Promise<{ profileKey: string; refId: string | null }> {
  const r = await call<{ profileKey?: string; refId?: string }>('/profiles', { method: 'POST', body: { title } });
  if (!r.profileKey) throw new AyrshareSetupError('Ayrshare did not return a profile key.');
  return { profileKey: r.profileKey, refId: r.refId ?? null };
}

/** A short-lived link to Ayrshare's page where the brand's admin connects each network. */
export async function linkingUrl(profileKey: string, redirect: string): Promise<string> {
  const r = await call<{ url?: string }>('/profiles/generateJWT', {
    method: 'POST',
    body: {
      profileKey, redirect, expiresIn: 30,
      allowedSocial: ['facebook', 'instagram', 'threads', 'bluesky', 'twitter', 'linkedin', 'tiktok'],
    },
  });
  if (!r.url) throw new AyrshareSetupError('Ayrshare did not return a linking URL.');
  return r.url;
}

export interface LinkedAccount {
  platform: string;
  username: string | null;
  displayName: string | null;
  profileUrl: string | null;
}

export async function linkedAccounts(profileKey: string): Promise<LinkedAccount[]> {
  const r = await call<{ displayNames?: Array<{ platform?: string; username?: string; displayName?: string; profileUrl?: string }> }>(
    '/user', { method: 'GET', profileKey },
  );
  return (r.displayNames ?? []).filter((d) => d.platform).map((d) => ({
    platform: d.platform!, username: d.username ?? null, displayName: d.displayName ?? null, profileUrl: d.profileUrl ?? null,
  }));
}
