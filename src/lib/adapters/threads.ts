/**
 * Threads.
 *
 * Meta's official Threads API reads only the account that granted the token,
 * exactly like the TikTok Display API, so it is useless for a competitive tool.
 * This adapter is vendor-backed from the start rather than having an owned path
 * that falls back to a purchased one.
 *
 * Threads is the one platform here where amplification is genuinely rich: the
 * payload separates reshares from off-platform shares. Both are summed into
 * amplification because the metric vocabulary treats them as one concept, and
 * both are preserved in the raw payload for anyone who later wants to split them.
 *
 * Handles match Instagram, because a Threads account is created from an
 * Instagram login.
 */
import { AdapterError } from './types';
import type {
  AdapterProfile, ChannelAdapter, FetchContext, FetchResult,
  NormalizedAudience,
} from './types';
import { DATASETS, scrapeSync, rowError, isErrorRow } from '@/lib/vendors/brightdata';
import { toDayString } from './util/normalize';
import type { Platform } from '@/lib/types';
import {
  clearBrightDataReceipt,
  pendingBrightDataStage,
  runBrightDataStage,
} from './brightdata-receipt';

const PLATFORM: Platform = 'threads';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function pick(row: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

function num(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.trunc(v));
  if (typeof v === 'string') {
    const n = Number(v.replace(/[, ]/g, ''));
    if (Number.isFinite(n)) return Math.max(0, Math.trunc(n));
  }
  return 0;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function profileUrl(handle: string): string {
  return 'https://www.threads.com/@' + handle;
}

type PublicProfileStatus = 'exists' | 'missing' | 'unknown';

/**
 * Bright Data occasionally returns a per-row "User not found!" response for
 * public Threads accounts that resolve normally a few minutes later. That is
 * a source failure, not evidence that an operator entered the wrong handle.
 *
 * Threads' public HTML exposes an account-specific Open Graph title even when
 * the rest of the page is client rendered. Use that only to distinguish a
 * vendor false negative from a genuinely missing profile; it is not a metric
 * source and it cannot replace Bright Data's stable profile id.
 */
async function publicProfileStatus(
  handle: string,
  signal?: AbortSignal,
  onApiCall?: () => void,
): Promise<PublicProfileStatus> {
  const timeout = new AbortController();
  const cancel = setTimeout(() => timeout.abort(), 10_000);
  const signals = signal ? [signal, timeout.signal] : [timeout.signal];

  try {
    onApiCall?.();
    const response = await fetch(profileUrl(handle), {
      cache: 'no-store',
      redirect: 'follow',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'DataDumpster/1.0 Threads profile verifier',
      },
      signal: signals.length > 1 ? AbortSignal.any(signals) : timeout.signal,
    });
    if (response.status === 404) return 'missing';
    if (!response.ok) return 'unknown';

    // Real profiles are currently about 500 KB. Bound the inspection because
    // this fallback exists only to read the small Open Graph header.
    const html = (await response.text()).slice(0, 1_000_000).toLowerCase();
    const normalizedHandle = handle.toLowerCase();
    if (
      html.includes('(@' + normalizedHandle + ')')
      || html.includes('&#064;' + normalizedHandle)
      || html.includes('&#x40;' + normalizedHandle)
    ) return 'exists';

    if (
      html.includes('property="og:title" content="threads &#x2022; log in')
      || html.includes('property="og:title" content="threads • log in')
    ) return 'missing';

    return 'unknown';
  } catch {
    return 'unknown';
  } finally {
    clearTimeout(cancel);
  }
}

function requireVendorKey(credentials: Record<string, string>): string {
  const key = credentials.brightDataApiKey?.trim() || '';
  if (!key) {
    throw new AdapterError(
      'Threads public collection requires a Bright Data API key or, when Bright Data is '
      + 'unconfigured, an EnsembleData token. The official Threads API only reads the account that '
      + 'granted the token, so it cannot supply competitor-comparable profiles. See '
      + 'docs/DATA-ACCESS.md.',
      { platform: PLATFORM, retryable: false },
    );
  }
  return key;
}

async function readProfile(
  handle: string,
  apiKey: string,
  onApiCall?: () => void,
  signal?: AbortSignal,
  resumeSnapshotId?: string,
): Promise<Record<string, unknown>> {
  const rows = await scrapeSync(
    DATASETS.threadsProfile,
    [{ url: profileUrl(handle) }],
    { apiKey, platform: PLATFORM, onApiCall, signal, resumeSnapshotId },
  );
  const row = rows.find((r) => isRecord(r) && !isErrorRow(r));
  if (!isRecord(row)) {
    const why = rows.length > 0 ? rowError(rows[0]) : undefined;
    const publicStatus = await publicProfileStatus(handle, signal, onApiCall);
    const sourceDetail = why ? ' Vendor detail: ' + why : '';
    if (publicStatus === 'exists') {
      throw new AdapterError(
        'Bright Data temporarily returned no Threads profile for @' + handle
          + ', but Threads resolves that account publicly. The same source will be retried; '
          + 'no observations were accepted.' + sourceDetail,
        { platform: PLATFORM, retryable: true },
      );
    }
    if (publicStatus === 'unknown') {
      throw new AdapterError(
        'Bright Data temporarily returned no Threads profile for @' + handle
          + '. The public profile could not be checked well enough to prove that it is missing, '
          + 'so the same source will be retried; no observations were accepted.' + sourceDetail,
        { platform: PLATFORM, retryable: true },
      );
    }
    throw new AdapterError(
      'Bright Data returned no Threads profile for @' + handle
        + ', and Threads confirmed that the public profile is unavailable.' + sourceDetail,
      { platform: PLATFORM, retryable: false },
    );
  }
  return row;
}

function toProfile(row: Record<string, unknown>, handle: string): AdapterProfile {
  const externalId = str(pick(row, ['profile_id', 'id']));
  if (!externalId) {
    throw new AdapterError(
      'Bright Data returned a Threads profile for @' + handle
        + ' without a stable platform id. No observations were accepted.',
      { platform: PLATFORM, retryable: false },
    );
  }
  return {
    externalId,
    handle,
    displayName: str(pick(row, ['profile_name', 'full_name'])),
    avatarUrl: str(pick(row, ['profile_picture', 'profile_pic_url'])) ?? null,
    profileUrl: str(row.url) ?? profileUrl(handle),
    followers: num(pick(row, ['number_of_followers', 'followers'])),
    meta: {
      source: 'brightdata',
      isVerified: Boolean(row.verified),
      instagramProfileUrl: str(row.instagram_profile_url) ?? null,
    },
  };
}

async function resolveViaEnsemble(handle: string, token: string): Promise<AdapterProfile> {
  const { resolveId } = await import('./threads-ensemble');
  return (await resolveId(handle, token)).profile;
}

export const threadsAdapter: ChannelAdapter = {
  platform: PLATFORM,
  displayName: 'Threads',
  accessNotes:
    'Purchased public data only. Bright Data is used exclusively when it is configured. '
    + 'EnsembleData is used only when Bright Data is not configured; a failed or cancelled paid '
    + 'Bright Data stage is never retried through EnsembleData. '
    + 'The official Threads API reads exclusively the account that granted the token, so there is no '
    + 'sanctioned route to a competitor and no owned-versus-competitor split to make here. Public '
    + 'vendor reads return followers, '
    + 'post text, likes, replies, reshares and shares. Threads publishes no view count to anyone, so '
    + 'views are always 0. Handles match the Instagram handle, because a Threads account is created '
    + 'from an Instagram login.',
  credentialFields: [
    { key: 'ensembleDataToken', label: 'EnsembleData token', secret: true, required: false,
      help: 'Secondary public source used only when Bright Data is not configured.' },
    { key: 'brightDataApiKey', label: 'Bright Data API key', secret: true, required: false,
      help: 'Primary pooled public Threads source.' },
  ],
  // Vendor-paced rather than platform-paced: this is about not queueing work
  // faster than it drains, since each read takes tens of seconds.
  rateLimit: { callsPerWindow: 60, windowSeconds: 60 },
  worksUnauthenticated: false,

  parseHandle(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) throw new AdapterError('Empty Threads handle', { platform: PLATFORM, retryable: false });

    let candidate = trimmed;
    if (trimmed.includes('://')) {
      let url: URL;
      try {
        url = new URL(trimmed);
      } catch {
        throw new AdapterError('Unparseable Threads URL: ' + input, { platform: PLATFORM, retryable: false });
      }
      const host = url.hostname.toLowerCase();
      if (!host.endsWith('threads.com') && !host.endsWith('threads.net')) {
        throw new AdapterError('Not a Threads URL: ' + input, { platform: PLATFORM, retryable: false });
      }
      const found = url.pathname.split('/').filter(Boolean).find((s) => s.startsWith('@'));
      if (!found) throw new AdapterError('No account in URL: ' + input, { platform: PLATFORM, retryable: false });
      candidate = found;
    }

    candidate = candidate.replace(/^@/, '').toLowerCase();
    if (!/^[a-z0-9._]{1,30}$/.test(candidate)) {
      throw new AdapterError('Invalid Threads handle: ' + input, { platform: PLATFORM, retryable: false });
    }
    return candidate;
  },

  async resolveProfile(handle: string, credentials: Record<string, string>): Promise<AdapterProfile> {
    // Callers supply the public-source allowlist. Do not reach around it to
    // deployment environment variables or change vendors after a paid failure.
    const token = credentials.ensembleDataToken?.trim() || '';
    const apiKey = credentials.brightDataApiKey?.trim() || '';

    if (apiKey) {
      return toProfile(await readProfile(handle, apiKey), handle);
    }
    if (token) return await resolveViaEnsemble(handle, token);

    throw new AdapterError(
      'Adding or verifying a Threads channel requires an EnsembleData token or a Bright Data API key.',
      { platform: PLATFORM, retryable: false },
    );
  },

  async fetch(ctx: FetchContext): Promise<FetchResult> {
    const pendingStage = pendingBrightDataStage(ctx.cursor, PLATFORM);
    if (
      pendingStage !== undefined
      && pendingStage !== 'threads-profile'
      && pendingStage !== 'threads-posts'
    ) {
      throw new AdapterError(
        'Threads has a Bright Data receipt for unknown stage "' + pendingStage
          + '". Reconcile the receipt before starting another paid snapshot.',
        { platform: PLATFORM, retryable: false },
      );
    }

    const token = ctx.credentials.ensembleDataToken?.trim() || '';
    const apiKey = ctx.credentials.brightDataApiKey?.trim() || '';
    if (pendingStage !== undefined && !apiKey) {
      throw new AdapterError(
        'Threads has a paid Bright Data snapshot waiting to resume, but the Bright Data API key is '
          + 'unavailable. Restore the key before collecting this account through another source.',
        { platform: PLATFORM, retryable: false },
      );
    }

    if (token && !apiKey && pendingStage === undefined) {
      const { resolveId, fetchPosts } = await import('./threads-ensemble');
      const { id, profile, audience } = await resolveId(
        ctx.handle, token, ctx.onApiCall, ctx.signal,
      );
      const result = await fetchPosts(id, ctx.handle, token, {
        since: ctx.since,
        until: ctx.until,
        onApiCall: ctx.onApiCall,
        signal: ctx.signal,
      });
      return {
        posts: result.posts,
        audience: audience ? [audience] : [],
        profile,
        cursor: { source: 'ensembledata', threadsId: id, lastRunAt: new Date().toISOString() },
        ...(result.exhaustive
          ? { hasMore: false as const, exhaustive: true as const }
          : {
              hasMore: false as const,
              exhaustive: false as const,
              incompleteReason: result.incompleteReason
                ?? 'EnsembleData did not certify the requested Threads window and exposed no continuation cursor.',
            }),
        warnings: result.warnings,
      };
    }

    if (!apiKey) requireVendorKey(ctx.credentials);

    {
      let profile: AdapterProfile | undefined;
      let audience: NormalizedAudience[] = [];
      const warnings: string[] = [];

      if (pendingStage !== 'threads-posts') {
        const profileStage = await runBrightDataStage(ctx, {
        platform: PLATFORM,
        stage: 'threads-profile',
        datasetId: DATASETS.threadsProfile,
      }, async (resumeSnapshotId) => await readProfile(
        ctx.handle,
        apiKey,
        ctx.onApiCall,
        ctx.signal,
        resumeSnapshotId,
        ));
        if (profileStage.kind === 'continuation') return profileStage.result;
        profile = toProfile(profileStage.value, ctx.handle);
        warnings.push(...profileStage.warnings);

        const followers = profile.followers ?? 0;
        audience = followers > 0
          ? [{ day: toDayString(new Date()), followers, extra: {} }]
          : [];
      } else if (!ctx.externalId?.trim()) {
        throw new AdapterError(
          'Threads post snapshot ' + String(ctx.cursor.pendingSnapshotId)
            + ' cannot resume because the pooled channel has no verified stable platform id. '
            + 'Reconcile the profile identity before retrying; no observations were written.',
          { platform: PLATFORM, retryable: false },
        );
      }

      const postsContext = pendingStage === 'threads-profile'
        ? { ...ctx, cursor: { ...ctx.cursor, ...clearBrightDataReceipt() } }
        : ctx;
      const { fetchThreadsPostsByProfile } = await import('./threads-brightdata');
      const postsStage = await runBrightDataStage(postsContext, {
        platform: PLATFORM,
        stage: 'threads-posts',
        datasetId: DATASETS.threadsPosts,
      }, async (resumeSnapshotId) => await fetchThreadsPostsByProfile(
        ctx.handle,
        apiKey,
        {
          since: ctx.since,
          until: ctx.until,
          limit: ctx.limit,
          onApiCall: ctx.onApiCall,
          signal: ctx.signal,
          resumeSnapshotId,
        },
      ), profile, audience);
      if (postsStage.kind === 'continuation') return postsStage.result;
      warnings.push(...postsStage.warnings, ...postsStage.value.warnings);

      return {
        posts: postsStage.value.posts,
        audience,
        ...(profile ? { profile } : {}),
        cursor: {
          source: 'brightdata',
          ...clearBrightDataReceipt(),
          lastRunAt: new Date().toISOString(),
        },
        hasMore: false,
        exhaustive: false,
        incompleteReason: postsStage.value.incompleteReason,
        warnings,
      };
    }
  },
};

export default threadsAdapter;
