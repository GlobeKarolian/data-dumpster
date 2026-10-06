import 'server-only';
import type { LinkPreview } from './providers/types';

function meta(html: string, key: string): string | null {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`,
    'i',
  );
  const m = html.match(re);
  const v = m?.[1] ?? m?.[2];
  return v ? decode(v) : null;
}

function decode(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

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

/** Title, description and image for a story link, for link cards and the composer. */
export async function fetchLinkPreview(raw: string): Promise<LinkPreview | null> {
  const url = safePreviewUrl(raw);
  if (!url) return null;
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': 'DataDumpsterBot/1.0 (+https://www.datadumpster.boston)', accept: 'text/html' },
      redirect: 'follow',
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const html = (await res.text()).slice(0, 400_000);
    const title = meta(html, 'og:title') ?? meta(html, 'twitter:title') ?? html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? raw;
    const description = meta(html, 'og:description') ?? meta(html, 'description') ?? '';
    let image = meta(html, 'og:image') ?? meta(html, 'twitter:image');
    if (image) {
      try { image = new URL(image, url).toString(); } catch { image = null; }
    }
    return { url: raw, title: decode(title), description, image };
  } catch {
    return null;
  }
}
