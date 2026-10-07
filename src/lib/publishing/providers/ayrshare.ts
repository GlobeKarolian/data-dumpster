/**
 * Ayrshare: the delivery truck for networks where we have not cleared the
 * platform's own app review (Meta, LinkedIn, TikTok).
 *
 * One Business-plan API key (AYRSHARE_API_KEY) and one Profile-Key per brand,
 * stored encrypted on the target. Since 31 March 2026 X posts through Ayrshare
 * also need our own X app keys (AYRSHARE_X_API_KEY / AYRSHARE_X_API_SECRET);
 * X bills us directly per post.
 *
 * Request and response shapes are from Ayrshare's /api/post reference (read
 * 7 Oct 2026). With a Profile-Key the reply is wrapped: { status, posts: [ { status,
 * postIds, errors, id, refId, profileTitle } ] }. Per AGENTS.md, confirm against a real response with the first
 * test key before trusting the mapper; `detail` keeps the raw body for that.
 */
import type { Publisher, SendRequest, SendResult } from './types';

const ENDPOINT = 'https://api.ayrshare.com/api/post';

interface AyrsharePostId { status?: string; id?: string; postUrl?: string; platform?: string }
interface AyrshareError { code?: number; message?: string; platform?: string }
interface AyrshareResult { status?: string; id?: string; postIds?: AyrsharePostId[]; errors?: AyrshareError[] }
/** With a Profile-Key header (every brand post) Ayrshare wraps the result in `posts`. */
interface AyrshareResponse extends AyrshareResult { posts?: AyrshareResult[] }

export function buildAyrshareBody(req: SendRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    post: req.text,
    platforms: [req.platform],
    idempotencyKey: req.idempotencyKey,
  };
  if (req.mediaUrls.length) body.mediaUrls = req.mediaUrls;
  if (req.platform === 'instagram' && req.instagramCollaborators.length) {
    body.instagramOptions = { collaborators: req.instagramCollaborators.slice(0, 3) };
  }
  return body;
}

export const ayrsharePublisher: Publisher = {
  name: 'ayrshare',
  idempotent: true,
  async send(req: SendRequest): Promise<SendResult> {
    const apiKey = process.env.AYRSHARE_API_KEY;
    if (!apiKey) return { ok: false, error: 'AYRSHARE_API_KEY is not configured.', retryable: false };
    const headers: Record<string, string> = {
      authorization: 'Bearer ' + apiKey,
      'content-type': 'application/json',
    };
    const profileKey = req.secret?.profileKey;
    if (profileKey) headers['Profile-Key'] = profileKey;
    if (req.platform === 'twitter') {
      const k = process.env.AYRSHARE_X_API_KEY;
      const s = process.env.AYRSHARE_X_API_SECRET;
      if (!k || !s) return { ok: false, error: 'X posting needs AYRSHARE_X_API_KEY and AYRSHARE_X_API_SECRET.', retryable: false };
      headers['X-Twitter-OAuth1-Api-Key'] = k;
      headers['X-Twitter-OAuth1-Api-Secret'] = s;
    }

    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST', headers, body: JSON.stringify(buildAyrshareBody(req)),
        signal: AbortSignal.timeout(45_000),
      });
    } catch (err) {
      return { ok: false, error: 'Network error reaching Ayrshare: ' + (err as Error).message, retryable: true };
    }
    let json: AyrshareResponse = {};
    try { json = (await res.json()) as AyrshareResponse; } catch { /* non-JSON error page */ }
    return mapAyrshareResponse(res.status, json);
  },
};

export function mapAyrshareResponse(status: number, json: AyrshareResponse): SendResult {
  const r: AyrshareResult = json.posts?.[0] ?? json;
  const hit = r.postIds?.find((p) => p.status === 'success') ?? r.postIds?.[0];
  if (status < 300 && r.status === 'success' && hit) {
    return { ok: true, providerPostId: hit.id ?? r.id ?? null, postUrl: hit.postUrl ?? null, detail: json };
  }
  const errors = [...(r.errors ?? []), ...(r === json ? [] : json.errors ?? [])];
  const message = errors.map((e) => e.message).filter(Boolean).join('; ') || `Ayrshare returned HTTP ${status}.`;
  // Ayrshare remembers every idempotency key forever, whatever happened to the post. Seeing one again
  // means an earlier try reached them, so it may already be live. A person must look before resending.
  if (/idempoten/i.test(message)) {
    return { ok: false, error: 'An earlier try of this post already reached Ayrshare, so it may be live. Check the account; if it is not there, use Find next good time to send it again.', retryable: false, detail: json };
  }
  // 429 and 5xx are worth another try; a 4xx is a content or account problem a person must fix.
  return { ok: false, error: message, retryable: status === 429 || status >= 500, detail: json };
}
