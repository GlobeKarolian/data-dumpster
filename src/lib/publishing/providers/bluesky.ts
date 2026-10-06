/**
 * Direct Bluesky publishing over AT Protocol, no vendor.
 *
 * Why direct: it is free, needs no platform approval, and it is the only way to
 * get what the social team asked for, a link card WITHOUT the URL in the post
 * text. Ayrshare only builds a card from a URL in the text, which spends
 * characters out of Bluesky's 300.
 *
 * Auth is an app password per account (Settings > Privacy and security > App
 * passwords in Bluesky), stored encrypted on the target as
 * {"identifier": "...", "appPassword": "..."}. Never the account password.
 *
 * Not idempotent: AT Protocol has no idempotency key, so the dispatcher never
 * blindly retries a Bluesky send whose outcome is unknown.
 */
import type { LinkPreview, Publisher, SendRequest, SendResult } from './types';

const PDS = process.env.BLUESKY_PDS_URL ?? 'https://bsky.social';

interface Facet {
  index: { byteStart: number; byteEnd: number };
  features: Array<{ $type: string; uri?: string; tag?: string }>;
}

/** Make URLs and hashtags in the text clickable; Bluesky does not infer them. */
export function detectFacets(text: string): Facet[] {
  const enc = new TextEncoder();
  const byteAt = (i: number) => enc.encode(text.slice(0, i)).length;
  const facets: Facet[] = [];
  for (const m of text.matchAll(/https?:\/\/[^\s)]+[^\s).,!?;:'"]/g)) {
    const i = m.index ?? 0;
    facets.push({
      index: { byteStart: byteAt(i), byteEnd: byteAt(i + m[0].length) },
      features: [{ $type: 'app.bsky.richtext.facet#link', uri: m[0] }],
    });
  }
  for (const m of text.matchAll(/(^|\s)#([\p{L}\p{N}_]{1,64})/gu)) {
    const i = (m.index ?? 0) + m[1].length;
    const len = m[2].length + 1;
    facets.push({
      index: { byteStart: byteAt(i), byteEnd: byteAt(i + len) },
      features: [{ $type: 'app.bsky.richtext.facet#tag', tag: m[2] }],
    });
  }
  return facets;
}

async function xrpc<T>(method: string, init: RequestInit & { token?: string }): Promise<{ status: number; json: T }> {
  const headers = new Headers(init.headers);
  if (init.token) headers.set('authorization', 'Bearer ' + init.token);
  const res = await fetch(`${PDS}/xrpc/${method}`, { ...init, headers, signal: AbortSignal.timeout(30_000) });
  let json = {} as T;
  try { json = (await res.json()) as T; } catch { /* empty */ }
  return { status: res.status, json };
}

async function uploadThumb(token: string, preview: LinkPreview): Promise<unknown | null> {
  if (!preview.image) return null;
  try {
    const img = await fetch(preview.image, { signal: AbortSignal.timeout(15_000) });
    if (!img.ok) return null;
    const type = img.headers.get('content-type') ?? 'image/jpeg';
    const bytes = new Uint8Array(await img.arrayBuffer());
    if (bytes.byteLength > 976_000) return null; // Bluesky's blob limit for thumbs
    const up = await xrpc<{ blob?: unknown }>('com.atproto.repo.uploadBlob', {
      method: 'POST', token, headers: { 'content-type': type }, body: bytes,
    });
    return up.json.blob ?? null;
  } catch {
    return null; // A card without a thumbnail beats no post.
  }
}

export const blueskyPublisher: Publisher = {
  name: 'bluesky',
  idempotent: false,
  async send(req: SendRequest): Promise<SendResult> {
    const identifier = req.secret?.identifier;
    const password = req.secret?.appPassword;
    if (!identifier || !password) {
      return { ok: false, error: 'This Bluesky target has no app password saved.', retryable: false };
    }
    let session;
    try {
      session = await xrpc<{ accessJwt?: string; did?: string; handle?: string; message?: string }>(
        'com.atproto.server.createSession',
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier, password }) },
      );
    } catch (err) {
      return { ok: false, error: 'Network error reaching Bluesky: ' + (err as Error).message, retryable: true };
    }
    if (!session.json.accessJwt || !session.json.did) {
      return { ok: false, error: 'Bluesky sign-in failed: ' + (session.json.message ?? 'HTTP ' + session.status), retryable: session.status >= 500 };
    }
    const token = session.json.accessJwt;
    const record: Record<string, unknown> = {
      $type: 'app.bsky.feed.post',
      text: req.text,
      createdAt: new Date().toISOString(),
      langs: ['en'],
    };
    const facets = detectFacets(req.text);
    if (facets.length) record.facets = facets;
    if (req.link && req.linkMode === 'card') {
      const preview = req.preview ?? { url: req.link, title: req.link, description: '', image: null };
      const thumb = await uploadThumb(token, preview);
      record.embed = {
        $type: 'app.bsky.embed.external',
        external: {
          uri: req.link,
          title: preview.title.slice(0, 300),
          description: preview.description.slice(0, 1000),
          ...(thumb ? { thumb } : {}),
        },
      };
    }
    let created;
    try {
      created = await xrpc<{ uri?: string; cid?: string; message?: string }>('com.atproto.repo.createRecord', {
        method: 'POST', token, headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repo: session.json.did, collection: 'app.bsky.feed.post', record }),
      });
    } catch (err) {
      // The request may have landed. Not retryable: a person checks the account.
      return { ok: false, error: 'Outcome unknown, check the account: ' + (err as Error).message, retryable: false };
    }
    if (!created.json.uri) {
      return { ok: false, error: 'Bluesky rejected the post: ' + (created.json.message ?? 'HTTP ' + created.status), retryable: created.status === 429 || created.status >= 500 };
    }
    const rkey = created.json.uri.split('/').pop();
    return {
      ok: true,
      providerPostId: created.json.uri,
      postUrl: `https://bsky.app/profile/${session.json.handle ?? session.json.did}/post/${rkey}`,
    };
  },
};
