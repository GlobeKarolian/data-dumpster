/**
 * Read a story's own page for its headline, summary and the distinctive
 * names that identify it in conversation ("Last Ditch", "Greenfield"), so the
 * leakage search needs only a link. Pure: the route fetches the HTML.
 */

export interface StoryMeta {
  headline: string | null;
  description: string | null;
  terms: string[];
}

const ENTITIES: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', mdash: '—', ndash: '–' };

function decode(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

function meta(html: string, key: string): string | null {
  const patterns = [
    new RegExp('<meta[^>]+(?:property|name)=["\']' + key + '["\'][^>]*content=["\']([^"\']*)["\']', 'i'),
    new RegExp('<meta[^>]+content=["\']([^"\']*)["\'][^>]*(?:property|name)=["\']' + key + '["\']', 'i'),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decode(match[1]);
  }
  return null;
}

const GENERIC = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'when', 'where', 'what', 'why', 'how', 'who', 'after', 'before', 'in', 'on',
  'at', 'for', 'with', 'from', 'this', 'that', 'these', 'those', 'it', 'its', 'as', 'is', 'are', 'was', 'were', 'they',
  'boston', 'globe', 'massachusetts', 'mass', 'new', 'england', 'western', 'eastern', 'northern', 'southern', 'state',
  'city', 'us', 'u.s', 'america', 'american', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
  'sunday', 'magazine', 'opinion', 'news', 'stat', 'boston.com', 'i', 'we', 'you', 'he', 'she', 'his', 'her', 'our',
]);

function isCapitalized(word: string): boolean {
  return /^[A-Z0-9][\w'’.-]*$/.test(word) && /[A-Za-z]/.test(word);
}

/** Runs of consecutive capitalized words, generic words trimmed from the edges. */
function candidatePhrases(text: string): string[] {
  const out: string[] = [];
  for (const sentence of text.split(/[.!?;:,()"“”]+\s*/)) {
    const words = sentence.split(/\s+/).map((w) => w.replace(/^[^\w]+|[^\w-]+$/g, '').replace(/['’]s$/, '')).filter(Boolean);
    let run: string[] = [];
    const flush = () => {
      while (run.length && GENERIC.has(run[0].toLowerCase())) run.shift();
      while (run.length && GENERIC.has(run[run.length - 1].toLowerCase())) run.pop();
      if (run.length && run.join(' ').length >= 3) out.push(run.join(' '));
      run = [];
    };
    for (const word of words) {
      if (isCapitalized(word)) run.push(word);
      else flush();
    }
    flush();
  }
  return out;
}

export function extractStoryMeta(html: string): StoryMeta {
  const titleTag = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1];
  const ogTitle = meta(html, 'og:title');
  const headline = (ogTitle ?? (titleTag ? decode(titleTag) : null))?.replace(/\s+[-|–]\s+(The Boston Globe|STAT|Boston\.com|Boston Magazine)\s*$/i, '') ?? null;
  const description = meta(html, 'description') ?? meta(html, 'og:description');
  const sources = [headline, titleTag ? decode(titleTag) : null, meta(html, 'description'), meta(html, 'og:description')]
    .filter((s): s is string => Boolean(s));

  const scores = new Map<string, number>();
  for (const phrase of sources.flatMap(candidatePhrases)) {
    const key = phrase.toLowerCase();
    if (scores.has(key) || GENERIC.has(key)) continue;
    const seenIn = sources.filter((s) => s.toLowerCase().includes(key)).length;
    scores.set(key, seenIn * 2 + (phrase.includes(' ') ? 1 : 0));
  }
  const original = new Map<string, string>();
  for (const phrase of sources.flatMap(candidatePhrases)) if (!original.has(phrase.toLowerCase())) original.set(phrase.toLowerCase(), phrase);

  const ranked = [...scores.entries()].filter(([, score]) => score >= 4).sort((a, b) => b[1] - a[1]);
  const terms: string[] = [];
  for (const [key] of ranked) {
    if (terms.some((t) => t.toLowerCase().includes(key) || key.includes(t.toLowerCase()))) continue;
    terms.push(original.get(key) ?? key);
    if (terms.length === 2) break;
  }
  return { headline, description, terms };
}
