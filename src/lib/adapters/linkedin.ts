/**
 * LinkedIn — Bright Data public company pages, with the official Marketing API
 * retained only as an administrator-authorized fallback.
 *
 * LinkedIn's official API does not expose competitor organization pages. The
 * pooled competitive route therefore uses Bright Data's public company and
 * company-post datasets. Those rows expose public follower stock, posts, likes
 * and comments. They do not expose shares, saves, views, reach or impressions,
 * and a completed snapshot does not certify that the historical feed was
 * exhausted. The adapter preserves those limitations instead of inventing
 * zeros or claiming complete coverage.
 *
 * ACCESS BURDEN, stated because it is the real cost here rather than money:
 * the Community Management API and the Marketing Developer Platform both
 * require an application, a company page of your own, and review. Approval
 * takes weeks and can be refused. Once approved, tokens are member-scoped
 * 60-day OAuth tokens that must be refreshed, not long-lived app tokens.
 *
 * TRANSPORT NOTES:
 *  - Versioned REST at /rest/. Every request must carry a LinkedIn-Version
 *    header of the form YYYYMM, and LinkedIn retires versions on a rolling
 *    roughly-one-year schedule. When this adapter starts returning 426, the
 *    version constant below is what needs bumping; it is overridable per org so
 *    that is a settings change, not a deploy.
 *  - X-Restli-Protocol-Version 2.0.0 is mandatory. Without it the array
 *    parameter encoding used by the statistics endpoint is rejected.
 */
import type { Platform } from '@/lib/types';
import {
  AdapterError,
  type AdapterProfile,
  type ChannelAdapter,
  type FetchContext,
  type FetchResult,
  type NormalizedAudience,
  type NormalizedPost,
} from './types';
import { asArray, asCount, asDate, asRecord, asString, fetchJson } from './util/request';
import { classifyPostType, extractHashtags, extractMentions, extractUrls, toDayString } from './util/normalize';
import { DATASETS } from '@/lib/vendors/brightdata';
import {
  clearBrightDataReceipt,
  pendingBrightDataStage,
  profileFromBrightDataReceipt,
  runBrightDataStage,
} from './brightdata-receipt';
import {
  fetchLinkedInCompanyPosts,
  fetchLinkedInCompanyProfile,
} from './linkedin-brightdata';

const PLATFORM: Platform = 'linkedin';
const API = 'https://api.linkedin.com/rest';

/**
 * Default versioned-API month. LinkedIn accepts roughly the trailing year of
 * versions and answers 426 Upgrade Required for anything older, so this needs a
 * periodic bump. Overridable via the apiVersion credential field precisely so a
 * newsroom is never blocked on a deploy to fix it.
 */
const DEFAULT_API_VERSION = '202606';

/** The posts endpoint caps count at 100; 50 keeps responses small enough to parse fast. */
const POSTS_PAGE_SIZE = 50;
const MAX_PAGES = 10;
/**
 * Share statistics accepts an array of post URNs. LinkedIn does not document a
 * hard ceiling; 20 is comfortably inside what it accepts and keeps the URL under
 * every proxy's length limit.
 */
const STATS_BATCH = 20;

/* ------------------------------------------------------------- transport */

function requireToken(credentials: Record<string, string>): string {
  const token = credentials.accessToken?.trim();
  if (!token) {
    throw new AdapterError(
      'LinkedIn requires an OAuth access token from an administrator of the organization page, with '
      + 'r_organization_social and rw_organization_admin scopes.',
      { platform: PLATFORM, retryable: false },
    );
  }
  return token;
}

function apiVersion(credentials: Record<string, string>): string {
  const v = credentials.apiVersion?.trim();
  return v !== undefined && /^\d{6}$/.test(v) ? v : DEFAULT_API_VERSION;
}

/**
 * 426 means the LinkedIn-Version header is too old. Retrying is pointless and
 * the message has to name the fix, because the symptom, every LinkedIn channel
 * failing at once months after the code last changed, is otherwise baffling.
 */
function classifyLinkedInError(ctx: { status: number }): boolean | undefined {
  if (ctx.status === 426) return false;
  return undefined;
}

function linkedInMessage(parsed: unknown, body: string): string | undefined {
  const rec = asRecord(parsed);
  const message = asString(rec?.message);
  const code = rec?.serviceErrorCode;
  if (message) {
    return typeof code === 'number' ? message + ' [serviceErrorCode ' + String(code) + ']' : message;
  }
  return body.trim() ? body.slice(0, 300) : undefined;
}

interface LinkedInCall {
  path: string;
  token: string;
  version: string;
  query?: Record<string, string | number | undefined>;
  ctx?: Pick<FetchContext, 'onApiCall' | 'signal'>;
}

async function call(req: LinkedInCall): Promise<Record<string, unknown>> {
  try {
    const body = await fetchJson<unknown>(API + '/' + req.path, {
      platform: PLATFORM,
      query: req.query,
      headers: {
        authorization: 'Bearer ' + req.token,
        'linkedin-version': req.version,
        'x-restli-protocol-version': '2.0.0',
      },
      onApiCall: req.ctx?.onApiCall,
      signal: req.ctx?.signal,
      classifyRetryable: classifyLinkedInError,
      extractMessage: linkedInMessage,
    });
    return asRecord(body) ?? {};
  } catch (err) {
    if (err instanceof AdapterError && err.opts.status === 426) {
      throw new AdapterError(
        'LinkedIn rejected API version ' + req.version + ' as retired. Set a newer apiVersion, '
        + 'in YYYYMM form, in Settings, Data Sources. LinkedIn retires versions about a year '
        + 'after release.',
        { platform: PLATFORM, retryable: false, status: 426 },
      );
    }
    throw err;
  }
}

/* --------------------------------------------------------- organizations */

const ORG_URN_PREFIX = 'urn:li:organization:';

function organizationUrn(idOrUrn: string): string {
  return /^\d+$/.test(idOrUrn) ? ORG_URN_PREFIX + idOrUrn : idOrUrn;
}

function organizationIdFromUrn(urn: string | undefined): string | undefined {
  if (!urn) return undefined;
  return urn.startsWith(ORG_URN_PREFIX) ? urn.slice(ORG_URN_PREFIX.length) : undefined;
}

interface ResolvedOrg {
  id: string;
  name: string;
  vanityName: string;
}

/**
 * Resolve a vanity name to an organization id.
 *
 * This endpoint is not a directory lookup. It only answers for organizations
 * the token is authorised on, which is exactly why competitor pages cannot be
 * added: an unauthorised vanity name comes back 403, not a page.
 */
async function resolveOrganization(
  handleOrId: string,
  token: string,
  version: string,
  ctx?: Pick<FetchContext, 'onApiCall' | 'signal'>,
): Promise<ResolvedOrg> {
  if (/^\d+$/.test(handleOrId)) {
    const body = await call({ path: 'organizations/' + handleOrId, token, version, ctx });
    return {
      id: handleOrId,
      name: asString(body.localizedName) ?? asString(body.name) ?? handleOrId,
      vanityName: asString(body.vanityName) ?? handleOrId,
    };
  }

  const body = await call({
    path: 'organizations', token, version, ctx,
    query: { q: 'vanityName', vanityName: handleOrId },
  });
  const first = asRecord(asArray(body.elements)[0]);
  const id = first?.id !== undefined
    ? String(first.id)
    : organizationIdFromUrn(asString(first?.organization));

  if (!first || !id) {
    throw new AdapterError(
      'LinkedIn returned no organization for "' + handleOrId + '". This endpoint only answers for '
      + 'pages your token administers; competitor pages cannot be resolved at all.',
      { platform: PLATFORM, retryable: false },
    );
  }

  return {
    id,
    name: asString(first.localizedName) ?? asString(first.name) ?? handleOrId,
    vanityName: asString(first.vanityName) ?? handleOrId,
  };
}

/**
 * Follower count.
 *
 * networkSizes is the cheapest source and the one that matches the number a
 * human sees on the page. organizationalEntityFollowerStatistics is richer but
 * returns demographic buckets, and summing buckets produces a total that
 * disagrees with the page for reasons LinkedIn does not document. We use the
 * one that agrees with the page.
 */
async function fetchFollowerCount(
  orgUrn: string,
  token: string,
  version: string,
  ctx?: Pick<FetchContext, 'onApiCall' | 'signal'>,
): Promise<number> {
  const body = await call({
    path: 'networkSizes/' + encodeURIComponent(orgUrn),
    token, version, ctx,
    query: { edgeType: 'CompanyFollowedByMember' },
  });
  return asCount(body.firstDegreeSize);
}

/* ---------------------------------------------------------------- posts */

interface RawPost {
  urn: string;
  postedAt: Date;
  commentary: string;
  contentType: string | null;
  thumbnailUrl: string | null;
  articleUrl: string | null;
}

/**
 * Read one element of /rest/posts.
 *
 * The shape is deeply nested and every branch is optional: content may hold
 * media, an article, a poll, a carousel, or nothing at all for a plain text
 * post. Everything here degrades to null rather than throwing, because one
 * unfamiliar post type must not fail an org's whole run.
 */
function readPost(raw: Record<string, unknown>): RawPost | undefined {
  const urn = asString(raw.id);
  if (!urn) return undefined;

  // createdAt and firstPublishedAt are epoch milliseconds, not ISO strings.
  const createdMs = asCount(raw.firstPublishedAt) || asCount(raw.createdAt);
  const postedAt = createdMs > 0 ? new Date(createdMs) : asDate(raw.publishedAt);
  if (!postedAt) return undefined;

  // Reshares and scheduled drafts both appear on this edge; only published
  // originals count as this page's output.
  const lifecycle = asString(raw.lifecycleState);
  if (lifecycle !== undefined && lifecycle !== 'PUBLISHED') return undefined;

  const content = asRecord(raw.content);
  const article = asRecord(content?.article);
  const media = asRecord(content?.media);
  const multiImage = asRecord(content?.multiImage);
  const poll = asRecord(content?.poll);

  let contentType: string | null = null;
  if (poll) contentType = 'poll';
  else if (multiImage) contentType = 'carousel';
  else if (article) contentType = 'article';
  else if (media) {
    // media.id is a URN whose type says what it is: urn:li:video, urn:li:image,
    // urn:li:document. There is no separate type field to read.
    const mediaUrn = asString(media.id) ?? '';
    contentType = mediaUrn.includes(':video:') ? 'video' : mediaUrn.includes(':image:') ? 'photo' : 'link';
  }

  return {
    urn,
    postedAt,
    commentary: asString(raw.commentary) ?? '',
    contentType,
    thumbnailUrl: asString(article?.thumbnail) ?? asString(media?.thumbnail) ?? null,
    articleUrl: asString(article?.source) ?? null,
  };
}

/** Walk /rest/posts?q=author until the LAST_MODIFIED edge is exhausted. */
async function fetchPosts(
  orgUrn: string,
  token: string,
  version: string,
  ctx: FetchContext,
): Promise<{ raw: RawPost[]; hasMore: boolean }> {
  const collected: RawPost[] = [];
  let start = 0;
  let pages = 0;
  let hasMore = false;

  while (pages < MAX_PAGES && collected.length < ctx.limit) {
    pages++;
    const body = await call({
      path: 'posts', token, version, ctx,
      query: {
        q: 'author',
        author: orgUrn,
        count: POSTS_PAGE_SIZE,
        start,
        // LAST_MODIFIED is the only sort this edge offers. For a page that does
        // not edit old posts it is publication order; for one that does, an
        // edited old post can surface here, which the window filter drops.
        sortBy: 'LAST_MODIFIED',
      },
    });

    const elements = asArray(body.elements);
    for (const element of elements) {
      const rec = asRecord(element);
      if (!rec) continue;
      const post = readPost(rec);
      if (!post) continue;
      if (post.postedAt < ctx.since || post.postedAt > ctx.until) continue;
      collected.push(post);
    }

    if (collected.length >= ctx.limit) {
      collected.length = ctx.limit;
      hasMore = true;
      break;
    }

    if (elements.length < POSTS_PAGE_SIZE) break;
    // Do not stop on publication time. This endpoint is ordered by
    // LAST_MODIFIED, so an old post edited today can precede a newer post that
    // has not been edited. Only exhausting the edge certifies the window.
    start += elements.length;
    if (pages >= MAX_PAGES) hasMore = true;
  }

  return { raw: collected, hasMore };
}

/* ----------------------------------------------------------- statistics */

interface ShareStats {
  applause: number;
  conversation: number;
  amplification: number;
  views: number;
  clicks: number;
  engagementRate: number | null;
}

function readShareStats(node: Record<string, unknown>): ShareStats {
  const s = asRecord(node.totalShareStatistics) ?? node;
  const rate = s.engagement;
  return {
    applause: asCount(s.likeCount),
    conversation: asCount(s.commentCount),
    amplification: asCount(s.shareCount),
    // LinkedIn's impressionCount is the closest analogue to views and is the
    // only impression number in this product that is genuinely available,
    // because it only exists for pages we own in the first place.
    views: asCount(s.impressionCount),
    clicks: asCount(s.clickCount),
    engagementRate: typeof rate === 'number' && Number.isFinite(rate) ? rate : null,
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Per-post statistics, batched.
 *
 * The statistics edge takes an array of post URNs encoded as shares[0], ugcPosts[0]
 * and so on, and which key it wants depends on the URN type: urn:li:share for
 * classic shares and urn:li:ugcPost for everything created through the newer
 * posts API. Mixing them in one request is rejected, so they are split.
 */
async function fetchShareStatistics(
  orgUrn: string,
  urns: string[],
  token: string,
  version: string,
  ctx: FetchContext,
): Promise<Map<string, ShareStats>> {
  const stats = new Map<string, ShareStats>();
  const shares = urns.filter((u) => u.includes(':share:'));
  const ugcPosts = urns.filter((u) => !u.includes(':share:'));

  for (const [paramName, group] of [['shares', shares], ['ugcPosts', ugcPosts]] as const) {
    for (const batch of chunk(group, STATS_BATCH)) {
      if (batch.length === 0) continue;
      const query: Record<string, string | number | undefined> = {
        q: 'organizationalEntity',
        organizationalEntity: orgUrn,
      };
      batch.forEach((urn, i) => { query[paramName + '[' + String(i) + ']'] = urn; });

      const body = await call({ path: 'organizationalEntityShareStatistics', token, version, ctx, query });
      for (const element of asArray(body.elements)) {
        const rec = asRecord(element);
        if (!rec) continue;
        const key = asString(rec.share) ?? asString(rec.ugcPost);
        if (!key) continue;
        stats.set(key, readShareStats(rec));
      }
    }
  }

  return stats;
}

function toNormalizedPost(raw: RawPost, stats: ShareStats | undefined, orgId: string): NormalizedPost {
  const text = raw.commentary;
  const urls = raw.articleUrl
    ? Array.from(new Set([raw.articleUrl, ...extractUrls(text)]))
    : extractUrls(text);

  // Post ids in the permalink are the numeric activity id embedded in the URN.
  const activityId = raw.urn.split(':').pop() ?? raw.urn;

  return {
    externalId: raw.urn,
    postedAt: raw.postedAt,
    type: classifyPostType({
      platform: PLATFORM,
      nativeType: raw.contentType,
      hasLink: Boolean(raw.articleUrl),
    }),
    text: text || null,
    permalink: 'https://www.linkedin.com/feed/update/' + raw.urn,
    mediaUrl: raw.articleUrl,
    thumbnailUrl: raw.thumbnailUrl,
    durationSec: null,
    language: null,
    hashtags: extractHashtags(text),
    mentions: extractMentions(text),
    urls,
    applause: stats?.applause ?? 0,
    conversation: stats?.conversation ?? 0,
    amplification: stats?.amplification ?? 0,
    // LinkedIn has no save or bookmark metric in the API.
    saves: 0,
    views: stats?.views ?? 0,
    raw: {
      organizationId: orgId,
      activityId,
      clickCount: stats?.clicks ?? 0,
      linkedinEngagementRate: stats?.engagementRate ?? null,
      contentType: raw.contentType,
      hadStatistics: stats !== undefined,
    },
  };
}

function requireBrightDataKey(credentials: Record<string, string>): string {
  const key = credentials.brightDataApiKey?.trim();
  if (!key) {
    throw new AdapterError(
      'Public LinkedIn collection requires the deployment Bright Data API key.',
      { platform: PLATFORM, retryable: false },
    );
  }
  return key;
}

async function fetchPublicLinkedIn(
  ctx: FetchContext,
  apiKey: string,
): Promise<FetchResult> {
  const pendingStage = pendingBrightDataStage(ctx.cursor, PLATFORM);
  if (
    pendingStage !== undefined
    && pendingStage !== 'linkedin-profile'
    && pendingStage !== 'linkedin-posts'
  ) {
    throw new AdapterError(
      'LinkedIn has a Bright Data receipt for unknown stage "' + pendingStage
        + '". Reconcile the receipt before starting another paid snapshot.',
      { platform: PLATFORM, retryable: false },
    );
  }

  let profile: AdapterProfile | undefined = pendingStage === 'linkedin-posts'
    ? profileFromBrightDataReceipt(ctx.cursor)
    : undefined;
  let audience: NormalizedAudience | undefined;
  const warnings: string[] = [];

  if (pendingStage === 'linkedin-posts' && !profile) {
    throw new AdapterError(
      'LinkedIn post snapshot ' + String(ctx.cursor.pendingSnapshotId)
        + ' has no bound profile identity. Refusing to apply paid rows to a pooled profile; '
        + 'operator reconciliation is required.',
      { platform: PLATFORM, retryable: false },
    );
  }

  if (pendingStage !== 'linkedin-posts') {
    const profileStage = await runBrightDataStage(ctx, {
      platform: PLATFORM,
      stage: 'linkedin-profile',
      datasetId: DATASETS.linkedinCompany,
    }, async (resumeSnapshotId) => await fetchLinkedInCompanyProfile(ctx.handle, apiKey, {
      onApiCall: ctx.onApiCall,
      signal: ctx.signal,
      resumeSnapshotId,
    }));
    if (profileStage.kind === 'continuation') return profileStage.result;
    ({ profile, audience } = profileStage.value);
    warnings.push(...profileStage.value.warnings, ...profileStage.warnings);
  } else if (!ctx.externalId?.trim()) {
    throw new AdapterError(
      'LinkedIn post snapshot ' + String(ctx.cursor.pendingSnapshotId)
        + ' cannot resume because the pooled channel has no verified stable platform id. '
        + 'Reconcile the profile identity before retrying; no observations were written.',
      { platform: PLATFORM, retryable: false },
    );
  }

  const postsContext = pendingStage === 'linkedin-profile'
    ? { ...ctx, cursor: { ...ctx.cursor, ...clearBrightDataReceipt() } }
    : ctx;
  const postsStage = await runBrightDataStage(postsContext, {
    platform: PLATFORM,
    stage: 'linkedin-posts',
    datasetId: DATASETS.linkedinCompanyPosts,
  }, async (resumeSnapshotId) => await fetchLinkedInCompanyPosts(ctx.handle, apiKey, {
    since: ctx.since,
    until: ctx.until,
    limit: ctx.limit,
    expectedCompanyHandle: profile?.handle ?? ctx.handle,
    onApiCall: ctx.onApiCall,
    signal: ctx.signal,
    resumeSnapshotId,
  }), profile, audience ? [audience] : []);
  if (postsStage.kind === 'continuation') return postsStage.result;

  const result = postsStage.value;
  warnings.push(...result.warnings, ...postsStage.warnings);
  return {
    posts: result.posts,
    audience: audience ? [audience] : [],
    ...(profile ? { profile } : {}),
    cursor: {
      source: 'brightdata',
      ...clearBrightDataReceipt(),
      lastVendorReadAt: new Date().toISOString(),
    },
    hasMore: false,
    exhaustive: false,
    incompleteReason: result.incompleteReason,
    warnings,
  };
}

/* ------------------------------------------------------------- adapter */

export const linkedinAdapter: ChannelAdapter = {
  platform: PLATFORM,
  displayName: 'LinkedIn',
  accessNotes:
    'Pooled public company pages use Bright Data. Public competitor coverage includes follower '
    + 'stock, post content, likes and comments. The dataset does not expose public shares, saves, '
    + 'views, reach or impressions, and it does not certify historical exhaustion, so LinkedIn '
    + 'windows remain visibly source-limited rather than being presented as complete. '
    + 'The official API remains an optional administrator-authorized path for a future org-private '
    + 'owned-insights store. It requires Marketing Developer Platform or Community Management API '
    + 'approval, which takes an '
    + 'application and weeks of review, plus a member OAuth token with r_organization_social and '
    + 'rw_organization_admin. Tokens last 60 days and must be refreshed. '
    + 'What you do get for your own pages is unusually good: impressions, clicks, likes, comments, '
    + 'shares and LinkedIn\'s own engagement rate per post. Saves are not exposed. '
    + 'Every request carries a LinkedIn-Version header in YYYYMM form and LinkedIn retires versions '
    + 'after about a year, so expect to bump apiVersion in Settings roughly annually.',
  // The pooled source is deployment-managed. Do not invite an organization to
  // paste an administrator token into Settings while owned observations have
  // no organization-private destination.
  credentialFields: [],
  // Bright Data is asynchronous and the client separately polls each saved
  // receipt. This local gate only prevents one worker wave from stampeding the
  // trigger endpoint; vendor spend and concurrency remain the binding limits.
  rateLimit: { callsPerWindow: 100, windowSeconds: 60 },
  worksUnauthenticated: false,

  /**
   * Accepts a numeric organization id, a vanity name, or a company URL. The
   * /showcase/ and /school/ paths are accepted too: they are organizations with
   * a different presentation, and the statistics edge treats them identically.
   */
  parseHandle(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) throw new AdapterError('Empty LinkedIn page', { platform: PLATFORM, retryable: false });
    if (trimmed.startsWith(ORG_URN_PREFIX)) return trimmed.slice(ORG_URN_PREFIX.length);
    if (/^\d+$/.test(trimmed)) return trimmed;

    let candidate = trimmed;
    if (/^https?:\/\//i.test(trimmed)) {
      let url: URL;
      try {
        url = new URL(trimmed);
      } catch {
        throw new AdapterError('Unparseable LinkedIn URL: ' + input, { platform: PLATFORM, retryable: false });
      }
      if (!/(^|\.)linkedin\.com$/i.test(url.hostname)) {
        throw new AdapterError('Not a LinkedIn URL: ' + input, { platform: PLATFORM, retryable: false });
      }
      const segments = url.pathname.split('/').filter(Boolean);
      const kinds = new Set(['company', 'showcase', 'school']);
      const idx = segments.findIndex((s) => kinds.has(s));
      const found = idx >= 0 ? segments[idx + 1] : undefined;
      if (!found) {
        throw new AdapterError(
          'No company page in URL: ' + input + '. Expected a /company/ URL.',
          { platform: PLATFORM, retryable: false },
        );
      }
      candidate = found;
    }

    candidate = candidate.toLowerCase();
    if (!/^[a-z0-9-]{2,100}$/.test(candidate)) {
      throw new AdapterError('Invalid LinkedIn page name: ' + input, { platform: PLATFORM, retryable: false });
    }
    return candidate;
  },

  async resolveProfile(handle: string, credentials: Record<string, string>): Promise<AdapterProfile> {
    const brightDataKey = credentials.brightDataApiKey?.trim();
    if (brightDataKey) {
      const { profile } = await fetchLinkedInCompanyProfile(handle, brightDataKey);
      return profile;
    }

    const token = requireToken(credentials);
    const version = apiVersion(credentials);
    const org = await resolveOrganization(handle, token, version);
    const followers = await fetchFollowerCount(organizationUrn(org.id), token, version);

    return {
      externalId: org.id,
      handle: org.vanityName,
      displayName: org.name,
      avatarUrl: null,
      profileUrl: 'https://www.linkedin.com/company/' + org.vanityName,
      followers,
      meta: { organizationUrn: organizationUrn(org.id) },
    };
  },

  async fetch(ctx: FetchContext): Promise<FetchResult> {
    const brightDataKey = ctx.credentials.brightDataApiKey?.trim();
    if (brightDataKey) return await fetchPublicLinkedIn(ctx, brightDataKey);

    if (ctx.cursor.__isOwned === false) {
      requireBrightDataKey(ctx.credentials);
    }

    const token = requireToken(ctx.credentials);
    const version = apiVersion(ctx.credentials);
    const warnings: string[] = [];

    const org = await resolveOrganization(ctx.externalId ?? ctx.handle, token, version, ctx);
    const orgUrn = organizationUrn(org.id);
    const followers = await fetchFollowerCount(orgUrn, token, version, ctx);

    const audience: NormalizedAudience = {
      day: toDayString(new Date()),
      followers,
      extra: {},
    };

    const { raw, hasMore } = await fetchPosts(orgUrn, token, version, ctx);

    let stats = new Map<string, ShareStats>();
    if (raw.length > 0) {
      try {
        stats = await fetchShareStatistics(orgUrn, raw.map((p) => p.urn), token, version, ctx);
      } catch (err) {
        // Losing engagement for a window is bad; losing the posts as well is
        // worse, because post cadence and posted-URL analysis still work
        // without it and the next run will backfill the numbers.
        const message = err instanceof Error ? err.message : String(err);
        warnings.push('Share statistics could not be read, so engagement reads 0 for this run: ' + message);
      }
    }

    const missing = raw.filter((p) => !stats.has(p.urn)).length;
    if (missing > 0 && stats.size > 0) {
      warnings.push(String(missing) + ' post(s) had no statistics row yet. LinkedIn lags by up to a few hours.');
    }

    const posts: NormalizedPost[] = raw.map((p) => toNormalizedPost(p, stats.get(p.urn), org.id));

    return {
      posts,
      audience: [audience],
      profile: {
        externalId: org.id,
        handle: org.vanityName,
        displayName: org.name,
        profileUrl: 'https://www.linkedin.com/company/' + org.vanityName,
        followers,
        meta: { organizationUrn: orgUrn },
      },
      cursor: {
        organizationId: org.id,
        organizationUrn: orgUrn,
        apiVersion: version,
        lastRunAt: new Date().toISOString(),
      },
      ...(hasMore
        ? {
            // /rest/posts exposes an offset, but this adapter does not yet
            // persist it. Calling the same window again would restart at zero,
            // so this is a terminal limitation rather than a continuation.
            hasMore: false as const,
            exhaustive: false as const,
            incompleteReason: 'LinkedIn reached the per-run post or page limit without a persisted offset. Add resumable offset paging before treating this requested window as complete.',
          }
        : { hasMore: false as const, exhaustive: true as const }),
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  },

  /**
   * There is no cheap "who am I" call on the versioned org API, so the health
   * check asks for the pages this token administers. An empty list is itself
   * the answer to the most common problem: the token authenticated a person who
   * does not administer any page.
   */
  async healthCheck(credentials: Record<string, string>): Promise<{ ok: boolean; message: string }> {
    try {
      const token = requireToken(credentials);
      const version = apiVersion(credentials);
      const body = await call({
        path: 'organizationAcls', token, version,
        query: { q: 'roleAssignee', role: 'ADMINISTRATOR', state: 'APPROVED' },
      });
      const count = asArray(body.elements).length;
      if (count === 0) {
        return { ok: false, message: 'Token valid but it administers no organization pages.' };
      }
      return { ok: true, message: 'Token administers ' + String(count) + ' organization page(s).' };
    } catch (err) {
      if (err instanceof AdapterError) return { ok: false, message: err.message };
      return { ok: false, message: err instanceof Error ? err.message : 'Unknown error' };
    }
  },
};

export default linkedinAdapter;
