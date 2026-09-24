/**
 * Story shares on X: who is passing one of our stories around, and how.
 *
 * Built for the "Article Leakage" investigation (23 Sep 2026). Given one of
 * our article URLs, this builds X recent-search queries for (1) direct links,
 * which also catch archive copies that embed the full URL, (2) paywall-bypass
 * and archive links matched by headline words, since short archive IDs hide
 * the source, and classifies every returned post by placement and link type.
 * Pure functions; the route owns the network calls and the X credential.
 */

export const OWN_HOSTS = ['bostonglobe.com', 'statnews.com', 'bostonmagazine.com', 'boston.com'] as const;

export const BYPASS_HOSTS = [
  'archive.ph', 'archive.today', 'archive.is', 'archive.li', 'archive.md', 'archive.vn',
  'ghostarchive.org', 'removepaywall.com', 'smry.ai', '12ft.io', 'web.archive.org',
] as const;

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'over', 'after', 'about', 'what',
  'when', 'where', 'will', 'have', 'says', 'said', 'amid', 'more', 'than', 'your', 'their', 'bar',
]);

export interface StoryTarget {
  host: string;
  path: string;
  /** host + path, no scheme, query or trailing slash. */
  key: string;
  slugTerms: string[];
}

export function parseStoryUrl(raw: string): StoryTarget {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error('Not a valid URL.');
  }
  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  if (!OWN_HOSTS.some((own) => host === own || host.endsWith('.' + own))) {
    throw new Error('Only our own story URLs can be searched.');
  }
  const path = url.pathname.replace(/\/+$/, '');
  if (path.length < 8) throw new Error('That looks like a section page, not a story.');
  const slug = path.split('/').filter(Boolean).pop() ?? '';
  const slugTerms = slug
    .split(/[-_]+/)
    .map((word) => word.toLowerCase())
    .filter((word) => word.length > 3 && !STOPWORDS.has(word) && !/^\d+$/.test(word));
  return { host, path, key: host + path, slugTerms };
}

/** Quote multi-word terms; X treats space-separated terms as AND. */
function termClause(terms: string[]): string {
  return terms.map((term) => (/\s/.test(term) ? '"' + term.replace(/"/g, '') + '"' : term)).join(' ');
}

export interface ShareQuery {
  id: 'direct' | 'slug' | 'bypass' | 'mentions';
  label: string;
  query: string;
}

export function buildShareQueries(story: StoryTarget, terms?: string[]): ShareQuery[] {
  const words = (terms && terms.length > 0 ? terms : story.slugTerms.slice(0, 3)).filter(Boolean);
  const slug = story.path.split('/').filter(Boolean).pop() ?? '';
  const queries: ShareQuery[] = [
    {
      id: 'direct',
      label: 'Links to the story (including archive copies that embed its URL)',
      query: 'url:"https://www.' + story.key + '"',
    },
    {
      // X tokenizes URLs; the slug alone also matches links with tracking
      // parameters, gift tokens or a different host prefix.
      id: 'slug',
      label: 'Links containing the story slug',
      query: 'url:"' + slug + '"',
    },
  ];
  if (words.length > 0) {
    const bypass = BYPASS_HOSTS.map((host) => 'url:' + host).join(' OR ');
    queries.push({
      id: 'bypass',
      label: 'Archive or paywall-bypass links matching the story\'s words',
      query: '(' + bypass + ') ' + termClause(words),
    });
    queries.push({
      id: 'mentions',
      label: 'Posts naming the story by its words, with or without a link',
      query: termClause(words) + ' -is:retweet',
    });
  }
  return queries;
}

export type LinkKind = 'direct' | 'bypass' | 'none';
export type Placement = 'original' | 'reply' | 'quote' | 'retweet';

export interface XUrlEntity {
  expanded_url?: string;
  unwound_url?: string;
  title?: string;
}

export function linkKind(story: StoryTarget, urls: XUrlEntity[]): { kind: LinkKind; tool?: string } {
  let bypassTool: string | undefined;
  for (const entity of urls) {
    const href = (entity.unwound_url || entity.expanded_url || '').toLowerCase();
    if (!href) continue;
    const bypass = BYPASS_HOSTS.find((host) => href.includes('//' + host) || href.includes('.' + host));
    if (bypass) {
      bypassTool = bypassTool ?? bypass;
      continue;
    }
    if (href.includes(story.key)) return { kind: 'direct' };
  }
  return bypassTool ? { kind: 'bypass', tool: bypassTool } : { kind: 'none' };
}

export function placement(referenced: Array<{ type: string }> | undefined): Placement {
  const types = new Set((referenced ?? []).map((r) => r.type));
  if (types.has('retweeted')) return 'retweet';
  if (types.has('quoted')) return 'quote';
  if (types.has('replied_to')) return 'reply';
  return 'original';
}

/** Accounts that answer mentions automatically; counted, never treated as people sharing. */
export const AUTOMATED_ACCOUNTS = new Set(['grok']);

export interface SharePost {
  url: string;
  createdAt: string | null;
  author: string;
  followers: number;
  placement: Placement;
  link: LinkKind;
  tool: string | null;
  likes: number;
  reposts: number;
  quotes: number;
  replies: number;
  views: number;
  text: string;
}

export interface ShareGroup {
  posts: number;
  accounts: number;
  views: number;
  medianFollowers: number;
}

export interface ShareSummary {
  people: number;
  posts: number;
  automatedPosts: number;
  views: number;
  reposts: number;
  linked: ShareGroup;
  leaked: ShareGroup & { asReplies: number; tools: Record<string, number> };
  unlinked: ShareGroup;
  /** Leaked copies as a share of every post that carried a link to the story. */
  leakShareOfLinks: number | null;
  byDay: Record<string, number>;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function group(posts: SharePost[]): ShareGroup {
  return {
    posts: posts.length,
    accounts: new Set(posts.map((p) => p.author)).size,
    views: posts.reduce((sum, p) => sum + p.views, 0),
    medianFollowers: median(posts.map((p) => p.followers)),
  };
}

export function summarizeShares(all: SharePost[]): ShareSummary {
  const people = all.filter((p) => !AUTOMATED_ACCOUNTS.has(p.author.toLowerCase()));
  const leaked = people.filter((p) => p.link === 'bypass');
  const linked = people.filter((p) => p.link === 'direct');
  const unlinked = people.filter((p) => p.link === 'none');
  const tools: Record<string, number> = {};
  for (const p of leaked) if (p.tool) tools[p.tool] = (tools[p.tool] ?? 0) + 1;
  const byDay: Record<string, number> = {};
  for (const p of people) {
    const day = (p.createdAt ?? '').slice(0, 10);
    if (day) byDay[day] = (byDay[day] ?? 0) + 1;
  }
  const withLinks = leaked.length + linked.length;
  return {
    people: new Set(people.map((p) => p.author)).size,
    posts: people.length,
    automatedPosts: all.length - people.length,
    views: people.reduce((sum, p) => sum + p.views, 0),
    reposts: people.reduce((sum, p) => sum + p.reposts, 0),
    linked: group(linked),
    leaked: { ...group(leaked), asReplies: leaked.filter((p) => p.placement === 'reply').length, tools },
    unlinked: group(unlinked),
    leakShareOfLinks: withLinks > 0 ? leaked.length / withLinks : null,
    byDay,
  };
}
