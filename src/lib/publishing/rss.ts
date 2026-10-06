/**
 * Minimal RSS 2.0 / Atom reader for autopublishing our own feeds.
 *
 * This is publishing, not ingestion: Data Dumpster still does not collect
 * competitors' RSS. A feed rule here watches one of OUR feeds (a WordPress
 * category, a Globe section) and turns new stories into queued posts.
 *
 * No XML dependency: feeds from WordPress and Arc are regular enough that a
 * tolerant tag reader is safer than pulling a parser into the server bundle.
 */
export interface FeedItem {
  guid: string;
  title: string;
  link: string;
  description: string;
  image: string | null;
  published: Date | null;
  categories: string[];
}

function decode(s: string): string {
  return s
    .replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, '$1')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function stripTags(s: string): string {
  return decode(decode(s).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1].trim() : null;
}

function attr(block: string, name: string, attrName: string): string | null {
  const m = block.match(new RegExp(`<${name}\\b[^>]*\\b${attrName}=["']([^"']+)["'][^>]*>`, 'i'));
  return m ? decode(m[1]) : null;
}

function parseDate(s: string | null): Date | null {
  if (!s) return null;
  const d = new Date(decode(s).trim());
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseFeed(xml: string): FeedItem[] {
  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const blocks = xml.match(isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi) ?? [];
  const items: FeedItem[] = [];
  for (const b of blocks) {
    const title = stripTags(tag(b, 'title') ?? '');
    const link = isAtom
      ? (b.match(/<link\b[^>]*rel=["']alternate["'][^>]*>/i) ? attr(b.match(/<link\b[^>]*rel=["']alternate["'][^>]*>/i)![0], 'link', 'href') : attr(b, 'link', 'href')) ?? ''
      : decode(tag(b, 'link') ?? '').trim();
    const guid = decode(tag(b, isAtom ? 'id' : 'guid') ?? '').trim() || link;
    const description = stripTags(tag(b, isAtom ? 'summary' : 'description') ?? tag(b, 'content') ?? '');
    const image =
      attr(b, 'media:content', 'url') ?? attr(b, 'media:thumbnail', 'url') ??
      (/<enclosure[^>]*type=["']image/i.test(b) ? attr(b, 'enclosure', 'url') : null);
    const categories = (b.match(/<category\b[^>]*>([\s\S]*?)<\/category>/gi) ?? [])
      .map((c) => stripTags(c.replace(/^<category\b[^>]*>|<\/category>$/gi, '')))
      .filter(Boolean);
    const published = parseDate(tag(b, 'pubDate') ?? tag(b, 'published') ?? tag(b, 'updated') ?? tag(b, 'dc:date'));
    if (!link || !title) continue;
    items.push({ guid, title, link, description, image, published, categories });
  }
  return items;
}

/**
 * Fill a per-platform copy template. Supported fields: {title}, {description},
 * {category}. The link is never part of the template: how it travels (card,
 * text, or none on Instagram) is decided per platform, so a Bluesky template does not
 * spend characters on a URL.
 */
export function renderTemplate(template: string, item: FeedItem, limit: number): string {
  const desc = item.description.length > 400 ? item.description.slice(0, 397).trimEnd() + '...' : item.description;
  let out = template
    .replaceAll('{title}', item.title)
    .replaceAll('{description}', desc)
    .replaceAll('{category}', item.categories[0] ?? '')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
  if ([...out].length > limit) out = [...out].slice(0, Math.max(0, limit - 1)).join('').trimEnd() + '…';
  return out;
}
