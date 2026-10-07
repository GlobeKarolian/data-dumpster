import 'server-only';
import type { LinkPreview } from './providers/types';
import { decode, meta } from './article-extract';

/** Only http(s) on public hostnames; never fetch internal addresses on a user's behalf. */
export function safePreviewUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    const h = u.hostname;
    if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || /^[\d.]+$/.test(h) || h.includes(':')) return null;
    return u;
  } catch {
    return null;
  }
}

const BOT_HEADERS = { 'user-agent': 'DataDumpsterBot/1.0 (+https://www.datadumpster.boston)', accept: 'text/html' };

/** A public page's HTML (up to maxChars), or null. Shared by link cards and article reading. */
export async function fetchPage(raw: string, maxChars = 400_000): Promise<{ url: URL; html: string } | null> {
  const url = safePreviewUrl(raw);
  if (!url) return null;
  try {
    const res = await fetch(url, { headers: BOT_HEADERS, redirect: 'follow', signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    return { url, html: (await res.text()).slice(0, maxChars) };
  } catch {
    return null;
  }
}

/** Title, description and image from a page's HTML. */
export function previewFromHtml(raw: string, url: URL, html: string): LinkPreview {
  const title = meta(html, 'og:title') ?? meta(html, 'twitter:title') ?? html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? raw;
  const description = meta(html, 'og:description') ?? meta(html, 'description') ?? '';
  let image = meta(html, 'og:image') ?? meta(html, 'twitter:image');
  if (image) {
    try { image = new URL(image, url).toString(); } catch { image = null; }
  }
  return { url: raw, title: decode(title), description, image };
}

/** Title, description and image for a story link, for link cards and the composer. */
export async function fetchLinkPreview(raw: string): Promise<LinkPreview | null> {
  const page = await fetchPage(raw);
  return page ? previewFromHtml(raw, page.url, page.html) : null;
}
