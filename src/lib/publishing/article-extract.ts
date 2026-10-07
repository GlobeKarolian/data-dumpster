/**
 * Read a news story out of its HTML: headline, byline and body text, for AI drafting.
 *
 * Pure (no fetch, no server-only) so it can be tested against saved pages. Three
 * sources, best first, matching what BGM sites actually serve (checked 7 Oct 2026):
 *
 *  1. JSON-LD `articleBody`, when a site publishes it.
 *  2. Arc XP's `Fusion.globalContent` (bostonglobe.com). The full story is in
 *     the server HTML even for subscriber stories; the paywall is applied in
 *     the browser.
 *  3. The page's paragraphs (boston.com and most WordPress sites), with
 *     newsletter and sharing boilerplate removed.
 *
 * If none yields a real story, the page's own summary is used and the caller
 * is told (`source: 'summary'`) so it can warn the editor.
 */

export interface Article {
  url: string;
  title: string;
  description: string;
  byline: string[];
  section: string | null;
  publishedAt: string | null;
  image: string | null;
  text: string;
  words: number;
  source: 'jsonld' | 'arc' | 'paragraphs' | 'summary';
}

/** Enough to brief a model on a long feature without paying for the whole thing. */
export const MAX_ARTICLE_CHARS = 16_000;
const MIN_BODY_CHARS = 400;

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’',
  mdash: '—', ndash: '–', hellip: '…', eacute: 'é', egrave: 'è', aacute: 'á', oacute: 'ó', ntilde: 'ñ', uuml: 'ü', ccedil: 'ç',
};

export function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

/** Visible text of an HTML fragment, whitespace collapsed. */
export function htmlToText(s: string): string {
  return decode(
    s.replace(/<(br|\/?(p|div|li|ul|ol|h[1-6]|tr|td|blockquote|figure|figcaption))\b[^>]*>/gi, ' ').replace(/<[^>]+>/g, ''),
  ).replace(/\s+/g, ' ').trim();
}

export function meta(html: string, key: string): string | null {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`,
    'i',
  );
  const m = html.match(re);
  const v = m?.[1] ?? m?.[2];
  return v ? decode(v) : null;
}

/** The JSON object starting at `start` (a `{`), read by bracket counting so trailing script is ignored. */
export function readJsonObject(s: string, start: number): unknown {
  if (s[start] !== '{') return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      try { return JSON.parse(s.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const names = (v: unknown): string[] => (Array.isArray(v) ? v : [v])
  .map((a) => (typeof a === 'string' ? a : isObj(a) ? str(a.name) : null))
  .filter((n): n is string => !!n);

function jsonLdArticle(html: string): Obj | null {
  const blocks = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const [, body] of blocks) {
    let parsed: unknown;
    try { parsed = JSON.parse(body.trim()); } catch { continue; }
    const items: unknown[] = Array.isArray(parsed) ? parsed : isObj(parsed) && Array.isArray(parsed['@graph']) ? parsed['@graph'] : [parsed];
    for (const it of items) {
      if (!isObj(it)) continue;
      const types = (Array.isArray(it['@type']) ? it['@type'] : [it['@type']]).map(String);
      if (types.some((t) => /Article$/i.test(t))) return it;
    }
  }
  return null;
}

function arcContent(html: string): Obj | null {
  const m = /Fusion\.globalContent\s*=\s*/.exec(html);
  if (!m) return null;
  const obj = readJsonObject(html, m.index + m[0].length);
  return isObj(obj) ? obj : null;
}

function arcText(content: Obj): string {
  const out: string[] = [];
  for (const el of Array.isArray(content.content_elements) ? content.content_elements : []) {
    if (!isObj(el)) continue;
    if ((el.type === 'text' || el.type === 'header') && typeof el.content === 'string') out.push(htmlToText(el.content));
    if (el.type === 'list' && Array.isArray(el.items)) {
      for (const item of el.items) if (isObj(item) && typeof item.content === 'string') out.push(htmlToText(item.content));
    }
  }
  return out.filter(Boolean).join('\n\n');
}

const BOILERPLATE = /preferred source on google|to your inbox|send this article|sign up for|newsletter|all rights reserved|©|subscribe (now|today)|this article was|advertisement|click here/i;

function paragraphText(html: string): string {
  const start = html.search(/<article\b/i);
  const scope = start >= 0 ? html.slice(start) : html;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const [, inner] of scope.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const t = htmlToText(inner);
    if (t.length < 60 || BOILERPLATE.test(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out.join('\n\n');
}

function cap(text: string): string {
  if (text.length <= MAX_ARTICLE_CHARS) return text;
  const cut = text.slice(0, MAX_ARTICLE_CHARS);
  const para = cut.lastIndexOf('\n\n');
  return (para > MAX_ARTICLE_CHARS * 0.6 ? cut.slice(0, para) : cut) + '\n\n[Story continues; trimmed for length.]';
}

export function extractArticle(html: string, url: string): Article {
  const ld = jsonLdArticle(html);
  const arc = arcContent(html);
  const arcHeadline = arc && isObj(arc.headlines) ? str(arc.headlines.basic) : null;
  const arcDeck = arc && isObj(arc.subheadlines) ? str(arc.subheadlines.basic) : null;
  const arcDescription = arc && isObj(arc.description) ? str(arc.description.basic) : null;

  const title = decode(meta(html, 'og:title') ?? str(ld?.headline) ?? arcHeadline ?? html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? url);
  const description = meta(html, 'og:description') ?? meta(html, 'description') ?? str(ld?.description) ?? arcDeck ?? arcDescription ?? '';
  let image = meta(html, 'og:image');
  if (image) {
    try { image = new URL(image, url).toString(); } catch { image = null; }
  }

  const ldBody = str(ld?.articleBody) ? htmlToText(String(ld!.articleBody)) : '';
  const arcBody = arc ? arcText(arc) : '';
  let text = '';
  let source: Article['source'] = 'summary';
  if (ldBody.length >= MIN_BODY_CHARS) { text = ldBody; source = 'jsonld'; }
  else if (arcBody.length >= MIN_BODY_CHARS) { text = arcBody; source = 'arc'; }
  else {
    const paras = paragraphText(html);
    if (paras.length >= MIN_BODY_CHARS) { text = paras; source = 'paragraphs'; }
    else text = description;
  }
  text = cap(text);

  const metaAuthor = meta(html, 'author');
  const byline = [...new Set([
    ...names(ld?.author),
    ...(arc && isObj(arc.credits) ? names(arc.credits.by) : []),
  ])];
  // WordPress JSON-LD often points at the author by @id only; the meta tag has the name.
  if (!byline.length && metaAuthor && !/^https?:/i.test(metaAuthor)) byline.push(metaAuthor);
  const arcSection = arc && isObj(arc.taxonomy) && isObj(arc.taxonomy.primary_section) ? str(arc.taxonomy.primary_section.name) : null;
  const section = (Array.isArray(ld?.articleSection) ? str(ld!.articleSection[0]) : str(ld?.articleSection)) ?? arcSection ?? meta(html, 'article:section');
  const publishedAt = str(ld?.datePublished) ?? (arc ? str(arc.first_publish_date) ?? str(arc.display_date) : null) ?? meta(html, 'article:published_time');

  return {
    url, title, description, byline, section, publishedAt, image, text,
    words: text ? text.split(/\s+/).length : 0,
    source,
  };
}
