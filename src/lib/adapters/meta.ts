/**
 * Meta — Facebook Pages and Instagram Business, Graph API v21.0.
 *
 * One file, two adapters, because they are one API with two nouns: the same
 * token, the same error envelope, the same throttling headers, the same paging
 * contract. Splitting them would duplicate all of that and let the two copies
 * drift.
 *
 * WHAT YOU CAN ACTUALLY SEE HERE — read this before trusting a Meta number:
 *
 *  - **Facebook competitor data is obtainable, through App Review.** CrowdTangle
 *    was shut down on 14 August 2024, but it was not the only sanctioned route.
 *    Meta still ships **Page Public Content Access** (PPCA), an App Review
 *    feature that lets a live app read public data for Pages it does not
 *    administer: business metadata, public posts and public comments, plus the
 *    Pages Search API. Meta's own Pages documentation names the allowed usage as
 *    "aggregated, anonymized public content for competitive analysis and
 *    benchmarking", which is exactly what this product does.
 *    https://developers.facebook.com/docs/features-reference/page-public-content-access/
 *    https://developers.facebook.com/docs/pages/overview/permissions-features
 *
 *    It is gated, not open. It needs App Review, business verification, and
 *    possibly additional signed contracts. Before approval an app can only read
 *    Pages whose admin also holds an admin, developer or tester role on the app,
 *    and once the app is Live it sees no Page public content at all without the
 *    feature. So the honest framing is "slow and conditional", not "impossible".
 *    This file implements it as a third read path, gated on an explicit
 *    ppcaApproved credential so nobody discovers the gate by 400.
 *
 *    The Meta Content Library, the research successor to CrowdTangle, remains
 *    closed to us: it is restricted to approved academic and non-profit
 *    researchers, read-only through Meta's own UI or Python SDK, and cannot back
 *    a product like this. It is a fallback we do not qualify for, not the only
 *    path.
 *
 *  - **Instagram has one narrow exception.** The Business Discovery edge
 *    (business_discovery.username(...)) returns a thin public subset — follower
 *    count, media count, and recent media with likes, comments, caption and
 *    permalink — for any Business or Creator account, queried through an IG
 *    account you own. It does not return saves, reach, impressions, story data,
 *    or anything at all for personal accounts, and Meta has never committed to
 *    keeping it. We use it, and we label what it cannot answer.
 *
 *  - **Saves and reach are owner-only.** They come from the media insights edge
 *    and require instagram_manage_insights on a token for that account. Where we
 *    do not have them the value is 0, which means "not exposed", not "nobody
 *    saved it". Facebook Page post impressions are the same story and are not
 *    requested here at all.
 *
 *  - **Reactions are summed, not split.** reactions.summary(true) gives one
 *    total. The per-type breakdown needs six extra sub-queries per post, which
 *    is not worth the quota for a metric nobody ranks on.
 *
 * Quota model: Meta does not publish a flat call ceiling, it publishes formulas
 * and a rolling percentage. Confirmed from
 * https://developers.facebook.com/docs/graph-api/overview/rate-limiting :
 *
 *   - Platform rate limit, for calls made with an app or user access token:
 *     "Calls within one hour = 200 * Number of Users", where Number of Users is
 *     unique daily active app users. An internal newsroom tool has a handful of
 *     users, so this is a genuinely small number, on the order of a few hundred
 *     calls an hour for the whole app.
 *   - Pages business-use-case rate limit, for calls made with a Page or system
 *     user access token: "Calls within 24 hours = 4800 * Number of Engaged
 *     Users", where Engaged Users is users who engaged with that Page per 24
 *     hours. For a competitor Page we do not own we drive none of that
 *     engagement, so the ceiling is whatever that Page's own audience gives us.
 *   - Meta's rate-limit page recommends a system user access token specifically
 *     to avoid rate limiting when using PPCA.
 *
 * Meta publishes no PPCA-specific quota. The x-app-usage and
 * x-business-use-case-usage headers report how much of the window you have
 * burned; at 100% you are cut off for the remainder. The rateLimit below is
 * therefore a deliberate under-estimate used only to pace the scheduler, not a
 * documented quota.
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

/**
 * Pinned deliberately. The current Graph API version is v25.0, released
 * 18 February 2026
 * (https://developers.facebook.com/docs/graph-api/changelog/version25.0/), and
 * this adapter should be moved to it and re-tested. Bumping the constant without
 * re-reading the changelog is how a field set silently stops returning a metric,
 * so it is a separate piece of work, not a one-character edit.
 */
const GRAPH_VERSION = 'v21.0';
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

/** Graph accepts up to 100 per page on both edges we use. */
const PAGE_SIZE = 100;
/** Hard stop on paging so a Page with a decade of history cannot burn an hour of quota. */
const MAX_PAGES = 20;
/**
 * A much harder stop on the PPCA path. Reading a Page we do not administer burns
 * quota we do not control the denominator of (see the header), and an over-eager
 * competitor backfill is the fastest way to take the owned-Page ingest down with
 * it, because the app-level window is shared.
 */
const PPCA_MAX_PAGES = 5;

/**
 * The exact field set documented for this integration. Kept as a constant so
 * the string in the code and the string in docs/DATA-ACCESS.md cannot diverge.
 */
const FACEBOOK_POST_FIELDS =
  'id,message,created_time,permalink_url,full_picture,shares,comments.summary(true),reactions.summary(true)';

/**
 * The same list plus `from`, used on the PPCA path.
 *
 * /{page-id}/feed can contain posts published by other actors on the Page, and a
 * visitor post charted as competitor output would be a real measurement error.
 * `from` is how we tell them apart, so it is requested rather than inferred.
 */
const FACEBOOK_FEED_FIELDS = `${FACEBOOK_POST_FIELDS},from`;

/**
 * media_product_type is appended to the documented list on purpose: without it
 * Instagram reports a Reel as media_type VIDEO, and "is this a Reel" is the
 * single most asked question about an Instagram account in 2026. It needs no
 * extra permission beyond the ones the rest of this field set already requires.
 */
const INSTAGRAM_MEDIA_FIELDS =
  'id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,'
  + 'like_count,comments_count,insights.metric(saved,reach)';

/** Same list minus insights, for accounts where the insights edge is refused. */
const INSTAGRAM_MEDIA_FIELDS_NO_INSIGHTS =
  'id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,'
  + 'like_count,comments_count';

/** Meta error codes that mean "slow down", not "you are wrong". */
const THROTTLE_CODES = new Set([4, 17, 32, 341, 613, 80001, 80002, 80003, 80004, 80006, 80014]);
/** Codes that mean a human has to re-authorise or fix a permission. */
const AUTH_CODES = new Set([10, 100, 102, 190, 200, 210, 230, 803]);

/* ------------------------------------------------------------- transport */

interface MetaErrorInfo {
  code?: number;
  subcode?: number;
  type?: string;
  message?: string;
}

function readMetaError(parsed: unknown): MetaErrorInfo {
  const err = asRecord(asRecord(parsed)?.error);
  if (!err) return {};
  const code = typeof err.code === 'number' ? err.code : undefined;
  const subcode = typeof err.error_subcode === 'number' ? err.error_subcode : undefined;
  return { code, subcode, type: asString(err.type), message: asString(err.message) };
}

/**
 * Meta returns rate-limit errors as HTTP 400, so the status-code default in
 * the shared status-code default classifies them as fatal. That is exactly backwards: a throttle
 * is the single most retryable thing Meta does. Codes are checked, not the
 * status.
 */
function classifyMetaError(ctx: { status: number; parsed: unknown }): boolean | undefined {
  const { code, subcode } = readMetaError(ctx.parsed);
  if (code === undefined) return undefined;
  if (THROTTLE_CODES.has(code)) return true;
  if (AUTH_CODES.has(code)) return false;
  // 1 = unknown/transient, 2 = service temporarily unavailable. Both are Meta
  // telling us it broke, not us.
  if (code === 1 || code === 2) return true;
  // 368 is a temporary block on the acting account; retrying makes it worse.
  if (code === 368 || subcode === 1349125) return false;
  return undefined;
}

function asPercent(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Turn Meta's usage headers into a backoff hint.
 *
 * x-app-usage and x-business-use-case-usage report percentages of a rolling
 * one-hour window. Crossing 100 is a one-hour outage for the whole app, which on
 * a shared token means every other channel's ingest fails too. Backing off at 95
 * costs one run; not backing off costs the night.
 */
function metaRetryAfter(headers: Headers): number | undefined {
  const appUsage = headers.get('x-app-usage');
  if (appUsage) {
    try {
      const parsed = asRecord(JSON.parse(appUsage) as unknown);
      const worst = Math.max(
        asPercent(parsed?.call_count),
        asPercent(parsed?.total_time),
        asPercent(parsed?.total_cputime),
      );
      if (worst >= 95) return 300;
    } catch {
      // A malformed usage header is not worth failing a request over.
    }
  }

  const bucUsage = headers.get('x-business-use-case-usage');
  if (bucUsage) {
    try {
      const parsed = asRecord(JSON.parse(bucUsage) as unknown);
      let maxMinutes = 0;
      for (const value of Object.values(parsed ?? {})) {
        const entry = asRecord(asArray(value)[0]);
        const minutes = entry?.estimated_time_to_regain_access;
        if (typeof minutes === 'number' && minutes > maxMinutes) maxMinutes = minutes;
      }
      if (maxMinutes > 0) return maxMinutes * 60;
    } catch {
      // Same.
    }
  }

  return undefined;
}

interface GraphCall {
  platform: Platform;
  token: string;
  query?: Record<string, string | number | undefined>;
  ctx?: Pick<FetchContext, 'onApiCall' | 'signal'>;
}

function graph<T>(pathOrUrl: string, opts: GraphCall): Promise<T> {
  const absolute = /^https?:\/\//i.test(pathOrUrl);
  return fetchJson<T>(absolute ? pathOrUrl : `${GRAPH}/${pathOrUrl.replace(/^\//, '')}`, {
    platform: opts.platform,
    // A paging URL from Meta already carries its own access_token and cursor;
    // re-appending ours would work but would also silently swap tokens mid-walk.
    query: absolute ? undefined : { ...opts.query, access_token: opts.token },
    onApiCall: opts.ctx?.onApiCall,
    signal: opts.ctx?.signal,
    classifyRetryable: classifyMetaError,
    retryAfterFromHeaders: metaRetryAfter,
    extractMessage: (parsed) => {
      const { code, subcode, message } = readMetaError(parsed);
      if (!message) return undefined;
      const suffix = code !== undefined ? ` (code ${code}${subcode !== undefined ? `/${subcode}` : ''})` : '';
      return `${message}${suffix}`;
    },
  });
}

/** `paging.next` is an absolute URL; absence of it is the only reliable end-of-feed signal. */
function nextPageUrl(body: unknown): string | undefined {
  return asString(asRecord(asRecord(body)?.paging)?.next);
}

function requireToken(credentials: Record<string, string>, platform: Platform): string {
  const token = credentials.accessToken?.trim();
  if (!token) {
    throw new AdapterError(
      'Meta requires a long-lived Page access token. Add one in Settings, Data Sources.',
      { platform, retryable: false },
    );
  }
  return token;
}

/* -------------------------------------------------------------- Facebook */

const FB: Platform = 'facebook';

/**
 * Pull a Page id out of anything a person might paste.
 *
 * Numeric ids pass through: they are the only identifier that survives a Page
 * renaming its vanity URL, and every Graph call ultimately wants one.
 */
function parseFacebookHandle(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new AdapterError('Empty Facebook page', { platform: FB, retryable: false });
  if (/^\d{5,}$/.test(trimmed)) return trimmed;

  let candidate = trimmed;
  if (/^https?:\/\//i.test(trimmed)) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      throw new AdapterError(`Unparseable Facebook URL: ${input}`, { platform: FB, retryable: false });
    }
    if (!/(^|\.)(facebook\.com|fb\.com|fb\.me)$/i.test(url.hostname)) {
      throw new AdapterError(`Not a Facebook URL: ${input}`, { platform: FB, retryable: false });
    }
    // /profile.php?id=123 is still in the wild for older Pages.
    const idParam = url.searchParams.get('id');
    if (idParam && /^\d+$/.test(idParam)) return idParam;
    const segments = url.pathname.split('/').filter(Boolean);
    // Meta's newer numeric-backed public-profile links use
    // /p/<display-slug>-<numeric-id>/. Treating the literal `p` as the handle
    // attached every one of those URLs to the same bogus pooled identity.
    const found = segments[0] === 'pg' || segments[0] === 'p'
      ? segments[1]
      : segments[0];
    if (!found) throw new AdapterError(`No page in URL: ${input}`, { platform: FB, retryable: false });
    candidate = found;
  }

  candidate = candidate.replace(/^@/, '');
  if (!/^[A-Za-z0-9.\-]{2,100}$/.test(candidate)) {
    throw new AdapterError(`Invalid Facebook page name: ${input}`, { platform: FB, retryable: false });
  }
  return candidate;
}

const FACEBOOK_PROFILE_FIELDS = 'id,name,username,link,followers_count,fan_count,picture.type(large),category';

interface ResolvedPage {
  profile: AdapterProfile;
  audience: NormalizedAudience;
}

function readPageProfile(body: unknown, handle: string): ResolvedPage {
  const rec = asRecord(body);
  const id = asString(rec?.id);
  if (!id) {
    throw new AdapterError(
      `Graph returned no Page for "${handle}". Either the token does not administer it, `
      + 'or the Page does not exist.',
      { platform: FB, retryable: false },
    );
  }

  // followers_count is the modern number and the one shown on the Page.
  // fan_count is legacy "likes" and is always the larger, staler figure; it is
  // kept in extra so a chart can explain a discontinuity rather than pretend.
  const followers = asCount(rec?.followers_count) || asCount(rec?.fan_count);
  const username = asString(rec?.username);

  return {
    profile: {
      externalId: id,
      handle: username ?? handle,
      displayName: asString(rec?.name),
      avatarUrl: asString(asRecord(asRecord(rec?.picture)?.data)?.url) ?? null,
      profileUrl: asString(rec?.link) ?? `https://www.facebook.com/${username ?? id}`,
      followers,
      meta: { category: asString(rec?.category) ?? null, fanCount: asCount(rec?.fan_count) },
    },
    audience: {
      day: toDayString(new Date()),
      followers,
      extra: { fanCount: asCount(rec?.fan_count) },
    },
  };
}

function readFacebookPost(raw: Record<string, unknown>): NormalizedPost | undefined {
  const externalId = asString(raw.id);
  const postedAt = asDate(raw.created_time);
  if (!externalId || !postedAt) return undefined;

  const message = asString(raw.message) ?? '';
  const picture = asString(raw.full_picture);
  const urls = extractUrls(message);

  // full_picture is also populated by the scraped thumbnail of a shared link, so
  // a link post would otherwise classify as a photo. Links win when both are
  // present, which for a newsroom Page is the overwhelmingly common case.
  const hasOutboundLink = urls.length > 0;

  const applause = asCount(asRecord(asRecord(raw.reactions)?.summary)?.total_count);
  const conversation = asCount(asRecord(asRecord(raw.comments)?.summary)?.total_count);
  const amplification = asCount(asRecord(raw.shares)?.count);

  return {
    externalId,
    postedAt,
    type: classifyPostType({
      platform: FB,
      hasLink: hasOutboundLink,
      hasImage: Boolean(picture) && !hasOutboundLink,
    }),
    text: message || null,
    permalink: asString(raw.permalink_url) ?? null,
    mediaUrl: null,
    thumbnailUrl: picture ?? null,
    durationSec: null,
    language: null,
    hashtags: extractHashtags(message),
    mentions: extractMentions(message),
    urls,
    applause,
    conversation,
    amplification,
    // Facebook exposes neither saves nor post impressions on this edge. Post
    // impressions exist on /{post-id}/insights for owned Pages only and are a
    // separate call per post, which is not worth the quota at ingest time.
    saves: 0,
    views: 0,
    raw: {
      fullPicture: picture ?? null,
      shares: amplification,
      reactionsTotal: applause,
      commentsTotal: conversation,
    },
  };
}

/* ------------------------------------------------- Facebook: which read path */

/**
 * Owned or competitor, same question the Instagram adapter answers and the same
 * order of evidence.
 *
 *  1. `cursor.__isOwned`, forced to false by the pooled runner and stripped
 *     again before the cursor is persisted. A future org-private owned runner
 *     may explicitly supply true.
 *  2. The credential-based fallback exists only for direct/legacy adapter
 *     callers that omit the flag; pooled collection never reaches it.
 */
function isOwnedFacebook(ctx: FetchContext): boolean {
  const flag = ctx.cursor.__isOwned;
  if (typeof flag === 'boolean') return flag;
  const configured = ctx.credentials.pageId?.trim();
  if (!configured) return true;
  return (ctx.externalId ?? ctx.handle) === configured;
}

/** Strings a human might type into a "yes we are approved" box. */
const AFFIRMATIVE = new Set(['1', 'true', 'yes', 'y', 'on', 'approved', 'granted']);

/**
 * PPCA is an App Review grant, and there is no Graph call that reliably answers
 * "am I approved" before you make a real request that fails. So the org declares
 * it, and we believe the declaration. Getting this wrong costs one clear error
 * message; guessing would cost a silent empty landscape.
 */
function isPpcaApproved(credentials: Record<string, string>): boolean {
  const raw = credentials.ppcaApproved?.trim().toLowerCase();
  return raw !== undefined && AFFIRMATIVE.has(raw);
}

const PPCA_DOCS = 'https://developers.facebook.com/docs/features-reference/page-public-content-access/';

/**
 * The token to read a Page we do not administer with.
 *
 * Meta's rate-limit documentation recommends a system user access token
 * specifically for PPCA, and a system user token is not the same object as the
 * long-lived Page token used for the owned path, so it gets its own field. If
 * the org has not set one we fall back to the main token rather than refusing:
 * the app-level feature grant is what unlocks the read, and some deployments
 * legitimately use one token for both.
 */
function requirePpcaToken(credentials: Record<string, string>): string {
  const token = credentials.ppcaAccessToken?.trim() || credentials.accessToken?.trim();
  if (!token) {
    throw new AdapterError(
      'Reading a Facebook Page you do not administer needs a token from an app approved for Page '
      + 'Public Content Access. Add one in Settings, Data Sources. ' + PPCA_DOCS,
      { platform: FB, retryable: false },
    );
  }
  return token;
}

/** The one place that says "you have not done the paperwork yet". */
function refusePpca(handle: string): never {
  throw new AdapterError(
    `Facebook competitor data for "${handle}" needs Page Public Content Access (PPCA), and this `
    + 'organisation has not declared it approved. PPCA is a Meta App Review feature that lets a live '
    + 'app read public posts, comments and engagement for Pages it does not administer. It requires a '
    + 'submitted App Review with a screencast, a verified Business, and possibly additional signed '
    + 'contracts; Meta lists "aggregated, anonymized public content for competitive analysis and '
    + 'benchmarking" as an allowed usage. Apply, then set the ppcaApproved credential to "true" and '
    + `supply ppcaAccessToken. See docs/META-PPCA-APPLICATION.md and ${PPCA_DOCS}`,
    { platform: FB, retryable: false },
  );
}

/**
 * Walk a Page's post edge newest-first until we cross `since`.
 *
 * The edge differs by read path and this is not cosmetic. Meta documents
 * /{page-id}/feed as a PPCA endpoint; it does not list /{page-id}/posts. The
 * owned path keeps /posts, which returns only the Page's own posts, and the PPCA
 * path uses /feed, which is what Meta says the feature unlocks. /feed can also
 * carry posts by others on the Page, so the PPCA caller filters on `from`.
 *
 * `since`/`until` are passed to Graph as unix seconds so the server does the
 * filtering; we still re-check locally because Meta applies them to
 * created_time on the *Page* timezone boundary in some edge cases and has been
 * known to return one extra page either side.
 */
async function fetchFacebookPosts(
  ctx: FetchContext,
  token: string,
  opts: { edge: 'posts' | 'feed'; maxPages: number; authorId?: string }
    = { edge: 'posts', maxPages: MAX_PAGES },
): Promise<{ posts: NormalizedPost[]; hasMore: boolean }> {
  const pageId = ctx.externalId ?? ctx.handle;
  const posts: NormalizedPost[] = [];
  let url: string | undefined;
  let pages = 0;
  let hasMore = false;

  while (pages < opts.maxPages) {
    pages++;
    const body: unknown = url
      ? await graph<unknown>(url, { platform: FB, token, ctx })
      : await graph<unknown>(`${pageId}/${opts.edge}`, {
        platform: FB,
        token,
        ctx,
        query: {
          fields: opts.edge === 'feed' ? FACEBOOK_FEED_FIELDS : FACEBOOK_POST_FIELDS,
          limit: Math.min(PAGE_SIZE, ctx.limit),
          since: Math.floor(ctx.since.getTime() / 1000),
          until: Math.floor(ctx.until.getTime() / 1000),
        },
      });

    const items = asArray(asRecord(body)?.data);
    for (const item of items) {
      const rec = asRecord(item);
      if (!rec) continue;
      // Only on /feed, and only when Graph actually returned `from`. A missing
      // `from` is treated as "the Page", because dropping every post on a field
      // Meta declined to serve would silently empty the channel.
      if (opts.authorId) {
        const fromId = asString(asRecord(rec.from)?.id);
        if (fromId && fromId !== opts.authorId) continue;
      }
      const post = readFacebookPost(rec);
      if (!post) continue;
      if (post.postedAt < ctx.since || post.postedAt > ctx.until) continue;
      posts.push(post);
    }

    if (posts.length >= ctx.limit) {
      posts.length = ctx.limit;
      hasMore = true;
      break;
    }

    url = nextPageUrl(body);
    if (!url) break;
    if (items.length === 0) {
      // An empty page with a next link is not a terminal signal. We do not
      // persist credential-bearing Graph URLs, so surface the limitation.
      hasMore = true;
      break;
    }
    if (pages >= opts.maxPages) hasMore = true;
  }

  return { posts, hasMore };
}

export const facebookAdapter: ChannelAdapter = {
  platform: FB,
  displayName: 'Facebook',
  accessNotes:
    'CURRENT POOLED COLLECTION: existing Facebook profiles use Bright Data only. New Facebook '
    + 'profile onboarding remains unavailable while verification would purchase the same crawl twice. '
    + 'Meta / PPCA is not connected to pooled collection, and Meta verification does not activate it '
    + 'in Settings or change the source route. The Graph implementation remains dormant for isolated '
    + 'future work after confirmed approval, provenance, and owned-data-isolation release gates pass.',
  // Pooled sources are deployment-managed. Keeping this empty prevents a
  // Settings renderer from presenting dormant Meta/PPCA controls as usable.
  credentialFields: [],
  // Meta publishes formulas, not a flat ceiling, and none of them are specific to
  // PPCA. The binding one for an internal tool is the platform limit for app and
  // user tokens, "200 * Number of Users" per rolling hour, where Number of Users
  // is unique daily active app users. A newsroom tool has single-digit daily
  // users, so the real ceiling is a few hundred calls an hour for the whole app,
  // shared between owned and competitor reads. 100 is a deliberate under-estimate
  // that leaves headroom for the owned-Page ingest to finish.
  rateLimit: { callsPerWindow: 100, windowSeconds: 3_600 },
  worksUnauthenticated: false,

  parseHandle: parseFacebookHandle,

  /**
   * Resolution happens before a channel row exists, so there is no ownership
   * flag to read here. We try the ordinary token first and, only if that fails
   * for a non-retryable reason and PPCA is configured with its own token, try
   * again with the PPCA token. Same shape as the Instagram insights fallback:
   * degrade to the other credential rather than fail a lookup we can serve.
   */
  async resolveProfile(handle: string, credentials: Record<string, string>): Promise<AdapterProfile> {
    const token = requireToken(credentials, FB);
    const read = async (withToken: string): Promise<AdapterProfile> => {
      const body = await graph<unknown>(handle, {
        platform: FB, token: withToken, query: { fields: FACEBOOK_PROFILE_FIELDS },
      });
      return readPageProfile(body, handle).profile;
    };

    try {
      return await read(token);
    } catch (err) {
      const ppca = credentials.ppcaAccessToken?.trim();
      const worthRetrying = err instanceof AdapterError && !err.opts.retryable
        && isPpcaApproved(credentials) && Boolean(ppca) && ppca !== token;
      if (!worthRetrying) throw err;
      return read(ppca as string);
    }
  },

  async fetch(ctx: FetchContext): Promise<FetchResult> {
    const owned = isOwnedFacebook(ctx);

    // A competitor Page with no Page Public Content Access approval used to be
    // a hard refusal. It still is when nothing else is configured, but a
    // purchased source is a legitimate answer to the same question and most
    // orgs will have one long before App Review clears.
    const vendorKey = ctx.credentials.brightDataApiKey ?? process.env.BRIGHTDATA_API_KEY ?? '';
    const pendingStage = pendingBrightDataStage(ctx.cursor, FB, 'facebook-page-posts');
    if (pendingStage && !vendorKey) {
      throw new AdapterError(
        'Facebook has a paid Bright Data snapshot waiting to resume, but the Bright Data API key '
          + 'is unavailable. Restore the key before collecting this Page through another source.',
        { platform: FB, retryable: false },
      );
    }
    if (!owned && vendorKey && (pendingStage !== undefined || !isPpcaApproved(ctx.credentials))) {
      const { fetchPagePosts } = await import('./facebook-brightdata');
      const stage = await runBrightDataStage(ctx, {
        platform: FB,
        stage: 'facebook-page-posts',
        datasetId: DATASETS.facebookPagePosts,
        legacyStage: 'facebook-page-posts',
        legacyDatasetId: DATASETS.facebookPagePosts,
      }, async (resumeSnapshotId) => await fetchPagePosts(ctx.handle, vendorKey, {
          since: ctx.since,
          until: ctx.until,
          limit: ctx.limit,
          onApiCall: ctx.onApiCall,
          signal: ctx.signal,
          resumeSnapshotId,
      }));
      if (stage.kind === 'continuation') return stage.result;

      const result = stage.value;
      return {
        posts: result.posts,
        audience: result.audience ? [result.audience] : [],
        profile: result.profile,
        cursor: {
          source: 'brightdata',
          ...clearBrightDataReceipt(),
          lastRunAt: new Date().toISOString(),
        },
        ...(result.exhaustive
          ? { hasMore: false as const, exhaustive: true as const }
          : {
              hasMore: false as const,
              exhaustive: false as const,
              incompleteReason: result.incompleteReason
                ?? 'Bright Data did not certify the requested Facebook window and exposed no continuation cursor.',
            }),
        warnings: [...result.warnings, ...stage.warnings],
      };
    }

    // Refuse loudly before spending a call. A competitor Page without PPCA and
    // without a purchased source is a configuration problem, and returning an
    // empty result would quietly draw a flat line where the honest answer is
    // "you have not applied yet".
    if (!owned && !isPpcaApproved(ctx.credentials)) refusePpca(ctx.handle);

    const token = owned ? requireToken(ctx.credentials, FB) : requirePpcaToken(ctx.credentials);
    const target = ctx.externalId ?? (owned ? ctx.credentials.pageId ?? ctx.handle : ctx.handle);
    const warnings: string[] = [];

    const profileBody = await graph<unknown>(target, {
      platform: FB, token, ctx, query: { fields: FACEBOOK_PROFILE_FIELDS },
    });
    const { profile, audience } = readPageProfile(profileBody, ctx.handle);

    const { posts, hasMore } = await fetchFacebookPosts(
      { ...ctx, externalId: profile.externalId },
      token,
      owned
        ? { edge: 'posts', maxPages: MAX_PAGES }
        // PPCA is documented against /{page-id}/feed, not /posts, so the
        // competitor path uses feed and filters to the Page's own posts.
        : { edge: 'feed', maxPages: PPCA_MAX_PAGES, authorId: profile.externalId },
    );

    if (audience.followers === 0) {
      warnings.push(owned
        ? 'Graph returned no follower count. The token may lack pages_read_engagement on this Page.'
        : 'Graph returned no follower count for this Page. Public follower and fan counts are not '
          + 'guaranteed under Page Public Content Access; treat 0 as unknown.');
    }

    if (!owned) {
      warnings.push(
        'Read through Page Public Content Access. Reactions, comments and shares are the same fields '
        + 'as an owned Page and are directly comparable. Impressions, reach and saves are not exposed '
        + 'for a Page you do not administer and are reported as 0. Paging is capped at '
        + `${PPCA_MAX_PAGES} pages per run to stay inside Meta's shared app-level rate limit.`,
      );
    }

    return {
      posts,
      audience: [audience],
      profile,
      cursor: {
        pageId: profile.externalId,
        mode: owned ? 'owned' : 'ppca',
        lastRunAt: new Date().toISOString(),
        graphVersion: GRAPH_VERSION,
      },
      ...(hasMore
        ? {
            // Graph returned another page, but paging URLs contain credentials
            // and are intentionally not persisted in the channel cursor.
            hasMore: false as const,
            exhaustive: false as const,
            incompleteReason: 'Facebook reached the per-run post or page limit without a safe persisted Graph cursor. Increase the run limit or add token-free cursor persistence before certifying this window.',
          }
        : { hasMore: false as const, exhaustive: true as const }),
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  },

  async healthCheck(credentials: Record<string, string>): Promise<{ ok: boolean; message: string }> {
    try {
      const token = requireToken(credentials, FB);
      // /me on a Page token returns the Page; on a User token it returns the
      // user, which is itself a useful diagnostic ("you pasted the wrong token").
      const body = await graph<unknown>('me', { platform: FB, token, query: { fields: 'id,name' } });
      const name = asString(asRecord(body)?.name) ?? asString(asRecord(body)?.id) ?? 'unknown';
      // The health check cannot prove PPCA: Meta exposes no endpoint that says
      // "this app holds this feature", and the only real test is reading a Page
      // you do not administer, which would fail for a dozen other reasons too.
      // So we report what was declared and leave the proof to the first run.
      const ppca = isPpcaApproved(credentials)
        ? 'Page Public Content Access is declared approved, so competitor Pages will be attempted. '
          + 'That declaration is not verified here; the first competitor run is the real test.'
        : 'Page Public Content Access is not declared, so only Pages you administer can be read. '
          + 'See docs/META-PPCA-APPLICATION.md to apply.';
      return { ok: true, message: `Token valid, acting as ${name}. ${ppca}` };
    } catch (err) {
      if (err instanceof AdapterError) return { ok: false, message: err.message };
      return { ok: false, message: err instanceof Error ? err.message : 'Unknown error' };
    }
  },
};

/* ------------------------------------------------------------- Instagram */

const IG: Platform = 'instagram';

const INSTAGRAM_PROFILE_FIELDS =
  'id,username,name,biography,followers_count,follows_count,media_count,profile_picture_url';

function parseInstagramHandle(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new AdapterError('Empty Instagram handle', { platform: IG, retryable: false });
  // A 17-digit IGSID is a resolved account id, not a handle. Pass it through.
  if (/^\d{10,}$/.test(trimmed)) return trimmed;

  let candidate = trimmed;
  if (/^https?:\/\//i.test(trimmed)) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      throw new AdapterError(`Unparseable Instagram URL: ${input}`, { platform: IG, retryable: false });
    }
    if (!/(^|\.)instagram\.com$/i.test(url.hostname)) {
      throw new AdapterError(`Not an Instagram URL: ${input}`, { platform: IG, retryable: false });
    }
    const found = url.pathname.split('/').filter(Boolean)[0];
    if (!found) throw new AdapterError(`No account in URL: ${input}`, { platform: IG, retryable: false });
    candidate = found;
  }

  candidate = candidate.replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(candidate)) {
    throw new AdapterError(`Invalid Instagram handle: ${input}`, { platform: IG, retryable: false });
  }
  return candidate;
}

/**
 * Insights arrive as a nested edge: insights.data[] of {name, values[{value}]}.
 * Missing metrics are normal — reach is not returned for some older media and
 * saved is not returned for anything Meta classifies as an ad.
 */
function readInsightMetric(insights: unknown, metric: string): number {
  for (const entry of asArray(asRecord(insights)?.data)) {
    const rec = asRecord(entry);
    if (asString(rec?.name) !== metric) continue;
    const first = asRecord(asArray(rec?.values)[0]);
    return asCount(first?.value);
  }
  return 0;
}

function readInstagramMedia(raw: Record<string, unknown>): NormalizedPost | undefined {
  const externalId = asString(raw.id);
  const postedAt = asDate(raw.timestamp);
  if (!externalId || !postedAt) return undefined;

  const caption = asString(raw.caption) ?? '';
  const mediaType = asString(raw.media_type)?.toUpperCase();
  const productType = asString(raw.media_product_type)?.toUpperCase();

  // media_product_type is authoritative for Reels; media_type only says VIDEO.
  const nativeType = productType === 'REELS'
    ? 'reel'
    : productType === 'STORY'
      ? 'story'
      : mediaType === 'CAROUSEL_ALBUM'
        ? 'carousel'
        : mediaType === 'VIDEO'
          ? 'video'
          : mediaType === 'IMAGE'
            ? 'photo'
            : null;

  return {
    externalId,
    postedAt,
    type: classifyPostType({ platform: IG, nativeType, hasVideo: mediaType === 'VIDEO' }),
    text: caption || null,
    permalink: asString(raw.permalink) ?? null,
    mediaUrl: asString(raw.media_url) ?? null,
    thumbnailUrl: asString(raw.thumbnail_url) ?? asString(raw.media_url) ?? null,
    durationSec: null,
    language: null,
    hashtags: extractHashtags(caption),
    mentions: extractMentions(caption),
    // Instagram strips links out of captions in the UI but people still write
    // them, and they are the only URL signal the API gives us. The bio link and
    // link stickers are not exposed at all.
    urls: extractUrls(caption),
    applause: asCount(raw.like_count),
    conversation: asCount(raw.comments_count),
    // Instagram has no share count on this edge for anyone. Story shares and
    // DM sends exist in Insights only, per-media, and only for owned accounts.
    amplification: 0,
    saves: readInsightMetric(raw.insights, 'saved'),
    // "reach" is unique accounts, not impressions. It is the closest honest
    // analogue to views and is only ever populated for owned accounts.
    views: readInsightMetric(raw.insights, 'reach'),
    raw: {
      mediaType: mediaType ?? null,
      mediaProductType: productType ?? null,
      hasInsights: asRecord(raw.insights) !== undefined,
    },
  };
}

interface IgProfileParts {
  profile: AdapterProfile;
  audience: NormalizedAudience;
}

function readIgProfile(body: unknown, handle: string, source: 'owned' | 'discovery'): IgProfileParts {
  const rec = asRecord(body);
  const id = asString(rec?.id) ?? handle;
  const followers = asCount(rec?.followers_count);
  const username = asString(rec?.username) ?? handle;

  return {
    profile: {
      externalId: id,
      handle: username,
      displayName: asString(rec?.name) ?? username,
      avatarUrl: asString(rec?.profile_picture_url) ?? null,
      profileUrl: `https://www.instagram.com/${username}/`,
      followers,
      meta: { source, mediaCount: asCount(rec?.media_count) },
    },
    audience: {
      day: toDayString(new Date()),
      followers,
      following: source === 'owned' ? asCount(rec?.follows_count) : null,
      extra: { mediaCount: asCount(rec?.media_count) },
    },
  };
}

/** Media edge for an account we hold a token for. Insights included when allowed. */
async function fetchOwnedInstagramMedia(
  ctx: FetchContext,
  token: string,
  igUserId: string,
): Promise<{ posts: NormalizedPost[]; hasMore: boolean; warnings: string[] }> {
  const posts: NormalizedPost[] = [];
  const warnings: string[] = [];
  let withInsights = true;
  let url: string | undefined;
  let pages = 0;
  let hasMore = false;

  while (pages < MAX_PAGES) {
    pages++;
    let body: unknown;
    try {
      body = url
        ? await graph<unknown>(url, { platform: IG, token, ctx })
        : await graph<unknown>(`${igUserId}/media`, {
          platform: IG,
          token,
          ctx,
          query: {
            fields: withInsights ? INSTAGRAM_MEDIA_FIELDS : INSTAGRAM_MEDIA_FIELDS_NO_INSIGHTS,
            limit: Math.min(PAGE_SIZE, ctx.limit),
            since: Math.floor(ctx.since.getTime() / 1000),
            until: Math.floor(ctx.until.getTime() / 1000),
          },
        });
    } catch (err) {
      // A field-level failure inside insights fails the whole request, and it
      // fails for entirely ordinary reasons: the token lacks
      // instagram_manage_insights, or the account was converted from Personal
      // recently, or one item in the page is an ad. Losing saves and reach is
      // far better than losing the posts, so we drop the metric and continue.
      const fatalInsights = err instanceof AdapterError && !err.opts.retryable && withInsights && !url;
      if (!fatalInsights) throw err;
      withInsights = false;
      warnings.push(
        'Instagram insights (saved, reach) were refused for this account, so saves and views read 0. '
        + 'This usually means the token lacks instagram_manage_insights.',
      );
      pages--;
      continue;
    }

    for (const item of asArray(asRecord(body)?.data)) {
      const rec = asRecord(item);
      if (!rec) continue;
      const post = readInstagramMedia(rec);
      if (!post) continue;
      if (post.postedAt < ctx.since || post.postedAt > ctx.until) continue;
      posts.push(post);
    }

    if (posts.length >= ctx.limit) {
      posts.length = ctx.limit;
      hasMore = true;
      break;
    }

    url = nextPageUrl(body);
    if (!url) break;
    if (pages >= MAX_PAGES) hasMore = true;
  }

  return { posts, hasMore, warnings };
}

/** Business Discovery caps nested media at 50 per hop. */
const DISCOVERY_MEDIA_PAGE = 50;

/**
 * The only competitor read path Meta still offers, and it is Instagram-only.
 *
 * Shape: you query an IG account you own, and ask it about someone else by
 * username. The target must be a Business or Creator account; Personal accounts
 * return error 110 and there is nothing to be done about it. Nested paging uses
 * media.after(cursor) rather than a paging.next URL, because the cursor belongs
 * to a sub-edge of a single node.
 */
function discoveryFields(target: string, after?: string): string {
  const mediaArgs = after
    ? `.limit(${DISCOVERY_MEDIA_PAGE}).after(${after})`
    : `.limit(${DISCOVERY_MEDIA_PAGE})`;
  return `business_discovery.username(${target}){`
    + 'followers_count,media_count,username,name,profile_picture_url,'
    + `media${mediaArgs}{id,caption,media_type,media_product_type,permalink,timestamp,`
    + 'like_count,comments_count,media_url,thumbnail_url}}';
}

async function fetchDiscoveredInstagram(
  ctx: FetchContext,
  token: string,
  ownerIgUserId: string,
  target: string,
): Promise<{ posts: NormalizedPost[]; hasMore: boolean; profile: AdapterProfile; audience: NormalizedAudience }> {
  const posts: NormalizedPost[] = [];
  let after: string | undefined;
  let pages = 0;
  let hasMore = false;
  let node: unknown;

  while (pages < MAX_PAGES) {
    pages++;
    const body = await graph<unknown>(ownerIgUserId, {
      platform: IG, token, ctx, query: { fields: discoveryFields(target, after) },
    });
    node = asRecord(asRecord(body)?.business_discovery);
    if (!node) {
      throw new AdapterError(
        `Business Discovery returned nothing for "${target}". The account must be a public `
        + 'Instagram Business or Creator account; Personal accounts cannot be read at all.',
        { platform: IG, retryable: false },
      );
    }

    const media = asRecord(asRecord(node)?.media);
    const items = asArray(media?.data);
    // Discovery has no since/until arguments, so the window filter is entirely
    // client-side and we stop as soon as a page is fully older than `since`.
    let sawInWindow = false;
    let oldestOnPage: Date | undefined;

    for (const item of items) {
      const rec = asRecord(item);
      if (!rec) continue;
      const post = readInstagramMedia(rec);
      if (!post) continue;
      if (!oldestOnPage || post.postedAt < oldestOnPage) oldestOnPage = post.postedAt;
      if (post.postedAt < ctx.since || post.postedAt > ctx.until) continue;
      sawInWindow = true;
      posts.push(post);
    }

    if (posts.length >= ctx.limit) {
      posts.length = ctx.limit;
      hasMore = true;
      break;
    }

    after = asString(asRecord(asRecord(media?.paging)?.cursors)?.after);
    if (!after) break;
    if (items.length === 0) {
      // A cursor after an empty nested page still advertises more source data.
      // This adapter does not persist that cursor yet.
      hasMore = true;
      break;
    }
    if (oldestOnPage && oldestOnPage < ctx.since && !sawInWindow) break;
    if (pages >= MAX_PAGES) hasMore = true;
  }

  const parts = readIgProfile(node, target, 'discovery');
  return { posts, hasMore, profile: parts.profile, audience: parts.audience };
}

/**
 * Owned or competitor? The adapter has to decide, because FetchContext has no
 * ownership flag by design (it is a property of the channel row, not the fetch).
 *
 * Order of evidence:
 *  1. `cursor.__isOwned`, forced to false by the pooled runner. Keys prefixed
 *     with a double underscore are stripped before persistence. A future
 *     org-private owned runner may explicitly supply true.
 *  2. The configured-owner fallback exists only for direct/legacy adapter
 *     callers that omit the flag; pooled collection never reaches it.
 */
function isOwnedInstagram(ctx: FetchContext, ownerId: string | undefined): boolean {
  const flag = ctx.cursor.__isOwned;
  if (typeof flag === 'boolean') return flag;
  if (!ownerId) return true;
  const target = ctx.externalId ?? ctx.handle;
  return target === ownerId;
}

export const instagramAdapter: ChannelAdapter = {
  platform: IG,
  displayName: 'Instagram',
  accessNotes:
    'Pooled public collection uses Bright Data exclusively when it is configured. EnsembleData '
    + 'is used only when Bright Data is not configured; a failed or cancelled paid Bright Data '
    + 'stage is never retried through EnsembleData. '
    + 'Instagram Business or Creator accounts can also use the Meta Graph API v21.0 with an '
    + 'instagram_basic, instagram_manage_insights and pages_read_engagement token. '
    + 'OWNED accounts return posts, likes, comments, saves and reach. '
    + 'COMPETITOR data is severely limited. CrowdTangle, which used to serve competitor Instagram and '
    + 'Facebook content, was shut down on 14 August 2024, and the Meta Content Library that replaced it '
    + 'is gated to approved researchers and cannot be queried from a product like this. Page Public '
    + 'Content Access does not help here either: it is a Pages feature and grants nothing on Instagram. '
    + 'The one route for Instagram is the Business Discovery edge, which returns follower count, media count and '
    + 'recent media with likes and comments for public Business or Creator accounts only, queried '
    + 'through an Instagram account you own. It returns no saves, no reach, no impressions, no Stories '
    + 'and nothing at all for Personal accounts, and Meta has never committed to keeping it. '
    + 'Instagram exposes no share count to anyone, so amplification is always 0.',
  credentialFields: [
    { key: 'accessToken', label: 'Meta access token', secret: true, required: false,
      help: 'Owned accounts. Long-lived token for the Facebook Page linked to your Instagram Business account.' },
    { key: 'igUserId', label: 'Your Instagram Business account id', required: false,
      help: 'The IG user id the token belongs to. Also the querying account for competitor Business Discovery lookups.' },
    { key: 'brightDataApiKey', label: 'Bright Data API key', secret: true, required: false,
      help: 'Competitor accounts, when no Meta app is approved. Read docs/DATA-ACCESS.md first.' },
  ],
  rateLimit: { callsPerWindow: 200, windowSeconds: 3_600 },
  worksUnauthenticated: false,

  parseHandle: parseInstagramHandle,

  async resolveProfile(handle: string, credentials: Record<string, string>): Promise<AdapterProfile> {
    // Callers supply the public-source allowlist. Do not reach around it to
    // deployment environment variables or change vendors after a paid failure.
    const ensembleToken = credentials.ensembleDataToken?.trim() || '';
    const vendorKey = credentials.brightDataApiKey?.trim() || '';
    if (!credentials.accessToken && vendorKey) {
      const { fetchProfile } = await import('./instagram-brightdata');
      const { profile } = await fetchProfile(handle, vendorKey);
      return profile;
    }

    if (!credentials.accessToken && ensembleToken) {
      const { fetchProfile } = await import('./instagram-ensemble');
      const { profile } = await fetchProfile(handle, ensembleToken);
      return profile;
    }

    const token = requireToken(credentials, IG);
    const ownerId = credentials.igUserId?.trim();

    // Resolving our own account is a direct node read; resolving anyone else's
    // has to go through Business Discovery, which is also the cheapest possible
    // check that the target is reachable at all before we create the channel.
    if (!ownerId || handle === ownerId) {
      const body = await graph<unknown>(handle, {
        platform: IG, token, query: { fields: INSTAGRAM_PROFILE_FIELDS },
      });
      return readIgProfile(body, handle, 'owned').profile;
    }

    const body = await graph<unknown>(ownerId, {
      platform: IG,
      token,
      query: {
        fields: `business_discovery.username(${handle}){`
          + 'id,followers_count,media_count,username,name,profile_picture_url}',
      },
    });
    const node = asRecord(asRecord(body)?.business_discovery);
    if (!node) {
      throw new AdapterError(
        `Instagram could not resolve "${handle}". Business Discovery only works for public `
        + 'Business and Creator accounts.',
        { platform: IG, retryable: false },
      );
    }
    return readIgProfile(node, handle, 'discovery').profile;
  },

  async fetch(ctx: FetchContext): Promise<FetchResult> {
    // Purchased source first when there is no Meta token. One vendor call
    // returns the profile and a page of recent posts together.
    // Preferred competitor path. Reels are a separate call because only the
    // reels endpoint carries a play count, which is why every Instagram post
    // collected before this existed has zero views.
    const pendingStage = pendingBrightDataStage(ctx.cursor, IG);
    if (
      pendingStage !== undefined
      && pendingStage !== 'instagram-profile'
      && pendingStage !== 'instagram-posts'
    ) {
      throw new AdapterError(
        'Instagram has a Bright Data receipt for unknown stage "' + pendingStage
          + '". Reconcile the receipt before starting another paid snapshot.',
        { platform: IG, retryable: false },
      );
    }

    const ensembleToken = ctx.credentials.ensembleDataToken?.trim() || '';
    const vendorKey = ctx.credentials.brightDataApiKey?.trim() || '';

    if (pendingStage !== undefined && !vendorKey) {
      throw new AdapterError(
        'Instagram has a paid Bright Data snapshot waiting to resume, but the Bright Data API '
          + 'key is unavailable. Restore the key before collecting this profile through another source.',
        { platform: IG, retryable: false },
      );
    }
    if (vendorKey && (pendingStage !== undefined || !ctx.credentials.accessToken)) {
      const { fetchProfile, postsFromProfile, fetchPostsByProfile } =
        await import('./instagram-brightdata');

      let profile: AdapterProfile | undefined = pendingStage === 'instagram-posts'
        ? profileFromBrightDataReceipt(ctx.cursor)
        : undefined;
      let audience: NormalizedAudience | undefined;
      let raw: Record<string, unknown> | undefined;
      const warnings: string[] = [];

      if (pendingStage === 'instagram-posts' && !profile) {
        throw new AdapterError(
          'Instagram post snapshot ' + String(ctx.cursor.pendingSnapshotId)
            + ' has no bound profile identity. Refusing to apply paid rows to a pooled profile; '
            + 'operator reconciliation is required.',
          { platform: IG, retryable: false },
        );
      }

      if (pendingStage !== 'instagram-posts') {
        const profileStage = await runBrightDataStage(ctx, {
          platform: IG,
          stage: 'instagram-profile',
          datasetId: DATASETS.instagramProfile,
        }, async (resumeSnapshotId) => await fetchProfile(
          ctx.handle,
          vendorKey,
          ctx.onApiCall,
          ctx.signal,
          resumeSnapshotId,
        ));
        if (profileStage.kind === 'continuation') return profileStage.result;
        ({ profile, audience, raw } = profileStage.value);
        warnings.push(...profileStage.warnings);
      } else if (!ctx.externalId?.trim()) {
        throw new AdapterError(
          'Instagram post snapshot ' + String(ctx.cursor.pendingSnapshotId)
            + ' cannot resume because the pooled channel has no verified stable platform id. '
            + 'Reconcile the profile identity before retrying; no observations were written.',
          { platform: IG, retryable: false },
        );
      }

      // The profile payload carries twelve recent posts. That is enough for a
      // daily poll and nowhere near enough for a 28-day window, so ask the
      // discovery endpoint for real history and fall back to the twelve if it
      // fails. Losing depth is much better than losing the channel.
      let posts = raw
        ? postsFromProfile(raw, ctx.handle, ctx.since, ctx.until)
        : {
            posts: [],
            warnings: [] as string[],
            exhaustive: false,
            incompleteReason: 'The Instagram profile stage was already completed; post history '
              + 'must come from the resumed date-ranged snapshot.',
          };

      const windowDays = (ctx.until.getTime() - ctx.since.getTime()) / 864e5;
      if (pendingStage === 'instagram-posts' && windowDays <= 3) {
        throw new AdapterError(
          'Instagram has a date-ranged post receipt for a window that no longer requires the '
            + 'post stage. Refusing to discard or replace the paid snapshot.',
          { platform: IG, retryable: false },
        );
      }
      if (windowDays > 3) {
        try {
          const deepContext = pendingStage === 'instagram-profile'
            ? { ...ctx, cursor: { ...ctx.cursor, ...clearBrightDataReceipt() } }
            : ctx;
          const deepStage = await runBrightDataStage(deepContext, {
            platform: IG,
            stage: 'instagram-posts',
            datasetId: DATASETS.instagramPost,
          }, async (resumeSnapshotId) => await fetchPostsByProfile(ctx.handle, vendorKey, {
            since: ctx.since,
            until: ctx.until,
            limit: ctx.limit,
            onApiCall: ctx.onApiCall,
            signal: ctx.signal,
            resumeSnapshotId,
          }), profile, audience ? [audience] : []);
          if (deepStage.kind === 'continuation') return deepStage.result;
          const deep = deepStage.value;
          warnings.push(...deepStage.warnings);
          if (profile && deep.profileExternalId) {
            const profileEndpointId = profile.externalId;
            profile = {
              ...profile,
              externalId: deep.profileExternalId,
              meta: {
                ...profile.meta,
                // The profile dataset exposes Meta's graph id; the post
                // dataset exposes Instagram's private user id, which matches
                // EnsembleData and is therefore our cross-vendor canonical id.
                profileEndpointId,
              },
            };
          }
          if (!raw || deep.posts.length > posts.posts.length) {
            posts = deep;
          } else {
            warnings.push(...deep.warnings);
            // The date-ranged dataset, not the twelve-post profile sample, is
            // the authority on whether this window was exhausted.
            posts = {
              ...posts,
              exhaustive: deep.exhaustive,
              incompleteReason: deep.incompleteReason,
            };
          }
        } catch (err) {
          if (ctx.signal?.aborted) throw err;
          // Once a paid post receipt exists, falling back to the profile sample
          // would clear that receipt and forfeit resumable work.
          if (pendingStage === 'instagram-posts') throw err;
          warnings.push(
            'Instagram deep history for @' + ctx.handle + ' failed, using the twelve posts from the '
            + 'profile call instead: ' + (err instanceof Error ? err.message : String(err)),
          );
        }
      }

      return {
        posts: posts.posts,
        audience: audience ? [audience] : [],
        ...(profile ? { profile } : {}),
        cursor: {
          source: 'brightdata',
          mode: 'vendor',
          ...clearBrightDataReceipt(),
          lastRunAt: new Date().toISOString(),
        },
        ...(posts.exhaustive
          ? { hasMore: false as const, exhaustive: true as const }
          : {
              hasMore: false as const,
              exhaustive: false as const,
              incompleteReason: posts.incompleteReason
                ?? 'Bright Data did not certify the requested Instagram window and exposed no continuation cursor.',
            }),
        warnings: [...posts.warnings, ...warnings],
      };
    }

    if (!ctx.credentials.accessToken && ensembleToken) {
      const { fetchProfile: edProfile, fetchAllPosts } = await import('./instagram-ensemble');
      const { userId, profile, audience } = await edProfile(
        ctx.handle, ensembleToken, ctx.onApiCall, ctx.signal,
      );
      const result = await fetchAllPosts(userId, ctx.handle, ensembleToken, {
        since: ctx.since,
        until: ctx.until,
        limit: ctx.limit,
        onApiCall: ctx.onApiCall,
        signal: ctx.signal,
      });
      return {
        posts: result.posts,
        audience: audience ? [audience] : [],
        profile,
        cursor: { source: 'ensembledata', igUserId: userId, lastRunAt: new Date().toISOString() },
        ...(result.exhaustive
          ? { hasMore: false as const, exhaustive: true as const }
          : {
              hasMore: false as const,
              exhaustive: false as const,
              incompleteReason: result.incompleteReason
                ?? 'EnsembleData did not certify the requested Instagram window and exposed no continuation cursor.',
            }),
        warnings: result.warnings,
      };
    }

    const token = requireToken(ctx.credentials, IG);
    const ownerId = ctx.credentials.igUserId?.trim();
    const warnings: string[] = [];

    if (isOwnedInstagram(ctx, ownerId)) {
      const igUserId = ctx.externalId ?? ownerId ?? ctx.handle;
      const profileBody = await graph<unknown>(igUserId, {
        platform: IG, token, ctx, query: { fields: INSTAGRAM_PROFILE_FIELDS },
      });
      const { profile, audience } = readIgProfile(profileBody, ctx.handle, 'owned');
      const media = await fetchOwnedInstagramMedia(ctx, token, profile.externalId);
      warnings.push(...media.warnings);

      return {
        posts: media.posts,
        audience: [audience],
        profile,
        cursor: { igUserId: profile.externalId, mode: 'owned', lastRunAt: new Date().toISOString() },
        ...(media.hasMore
          ? {
              hasMore: false as const,
              exhaustive: false as const,
              incompleteReason: 'Instagram Graph reached the per-run post or page limit without a safely persisted paging cursor. Increase the run limit or add cursor persistence before certifying this window.',
            }
          : { hasMore: false as const, exhaustive: true as const }),
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    }

    if (!ownerId) {
      throw new AdapterError(
        'Reading a competitor Instagram account needs your own Instagram Business account id '
        + '(igUserId) to query through. Add it in Settings, Data Sources.',
        { platform: IG, retryable: false },
      );
    }

    const discovered = await fetchDiscoveredInstagram(ctx, token, ownerId, ctx.handle);
    warnings.push(
      'Competitor Instagram data comes from Business Discovery: saves, reach and Stories are not '
      + 'available and are reported as 0.',
    );

    return {
      posts: discovered.posts,
      audience: [discovered.audience],
      profile: discovered.profile,
      cursor: { mode: 'discovery', queriedVia: ownerId, lastRunAt: new Date().toISOString() },
      ...(discovered.hasMore
        ? {
            hasMore: false as const,
            exhaustive: false as const,
            incompleteReason: 'Instagram Business Discovery reached the per-run post or page limit without a persisted nested-media cursor. Narrow the window or add cursor persistence before certifying it.',
          }
        : { hasMore: false as const, exhaustive: true as const }),
      warnings,
    };
  },

  async healthCheck(credentials: Record<string, string>): Promise<{ ok: boolean; message: string }> {
    try {
      const token = requireToken(credentials, IG);
      const ownerId = credentials.igUserId?.trim();
      if (!ownerId) {
        return { ok: false, message: 'Set your Instagram Business account id (igUserId) to enable competitor lookups.' };
      }
      const body = await graph<unknown>(ownerId, { platform: IG, token, query: { fields: 'id,username' } });
      const username = asString(asRecord(body)?.username) ?? ownerId;
      return { ok: true, message: `Token valid for @${username}.` };
    } catch (err) {
      if (err instanceof AdapterError) return { ok: false, message: err.message };
      return { ok: false, message: err instanceof Error ? err.message : 'Unknown error' };
    }
  },
};
