/**
 * Story clustering.
 *
 * A story is a real-world event that several outlets covered. Pressbox already
 * knows every post and every URL inside it, so grouping posts into stories turns
 * a flat activity feed into the thing a newsroom actually wants to know: what is
 * the market covering right now, who got there first, and who won it.
 *
 * THREE SIGNALS, IN ORDER OF TRUST
 *
 * 1. Shared canonical URL. Two posts linking the same article are covering the
 *    same story. This is close to proof and costs nothing, and it is available
 *    because the ingest layer already extracts and normalises links.
 * 2. Shared rare terms. Named entities carry almost all the signal in a headline
 *    ("Clancy", "Nantucket", "Pesaturo"), and rare terms are cheap to find with
 *    inverse document frequency. Common newsroom vocabulary is worthless for
 *    clustering, so it is weighted to nothing rather than stop-listed by hand.
 * 3. Time proximity. Coverage of one event is bursty. Two posts a fortnight
 *    apart sharing a word are usually not the same story, so similarity decays
 *    with the gap between them.
 *
 * Deliberately NOT embeddings. Clustering must work before anyone configures a
 * model, must cost nothing per run, and must return the same clusters twice for
 * the same input, because a newsroom will not trust a picture that reshuffles
 * itself. The model is used afterwards to NAME clusters, which is the part it is
 * genuinely better at.
 */
import type { Platform } from '@/lib/types';

export interface ClusterablePost {
  id: string;
  companyId: string;
  companyName: string;
  platform: Platform;
  postedAt: Date;
  text: string | null;
  permalink: string | null;
  thumbnailUrl: string | null;
  engagementTotal: number;
  views: number;
  /** Canonical URLs found in the post body. */
  urls: string[];
}

export interface StoryCluster {
  id: string;
  /** Provisional label from the most representative post. Replaced by the AI namer. */
  label: string;
  postIds: string[];
  posts: ClusterablePost[];
  companies: { id: string; name: string; postCount: number; engagement: number }[];
  platforms: Platform[];
  firstPostedAt: Date;
  lastPostedAt: Date;
  totalEngagement: number;
  totalViews: number;
  /** The company that posted first. The scoop signal. */
  brokeBy: { id: string; name: string } | null;
  /** Single post with the most engagement in the cluster. */
  topPostId: string;
  /** Distinctive terms, used for the label and the tooltip. */
  keywords: string[];
  /** How tightly the cluster holds together, 0 to 1. Low means treat with suspicion. */
  cohesion: number;
}

/* ------------------------------------------------------------ tokenising */

/**
 * Words that carry no story signal in a newsroom corpus. Kept short on purpose:
 * inverse document frequency handles the rest, and a hand-maintained stop list
 * is a maintenance burden that silently degrades as coverage changes.
 */
const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'for', 'with',
  'from', 'by', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'it', 'its', 'this',
  'that', 'these', 'those', 'has', 'have', 'had', 'will', 'would', 'can', 'could',
  'we', 'you', 'they', 'he', 'she', 'his', 'her', 'their', 'our', 'your', 'i',
  'not', 'no', 'more', 'most', 'new', 'now', 'here', 'there', 'what', 'when',
  'who', 'how', 'why', 'about', 'after', 'before', 'over', 'into', 'out', 'up',
  'down', 'says', 'said', 'say', 'read', 'link', 'bio', 'via', 'story', 'news',
  'today', 'week', 'day', 'year', 'first', 'last', 'one', 'two', 'get', 'got',
  'https', 'http', 'www', 'com',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9À-ɏ' ]+/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^'+|'+$/g, ''))
    .filter((t) => t.length > 2 && t.length < 30 && !STOP.has(t) && !/^\d+$/.test(t));
}

/**
 * Strip tracking and fragments so the same article shared by two outlets
 * normalises to one key. Without this, utm parameters alone would make every
 * share look like a different story.
 */
export function canonicalUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    u.hash = '';
    const drop = [...u.searchParams.keys()].filter((k) =>
      /^(utm_|fbclid|gclid|mc_|ref|s_campaign|icid|cmpid|smid)/i.test(k));
    for (const k of drop) u.searchParams.delete(k);
    let path = u.pathname.replace(/\/+$/, '');
    path = path.replace(/\.(amp|html?)$/i, '');
    return u.hostname.replace(/^www\./, '') + path + (u.search || '');
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------ similarity */

/** Inverse document frequency over the window. Rare terms carry the signal. */
function buildIdf(docs: string[][]): Map<string, number> {
  const df = new Map<string, number>();
  for (const doc of docs) {
    for (const term of new Set(doc)) df.set(term, (df.get(term) ?? 0) + 1);
  }
  const n = Math.max(docs.length, 1);
  const idf = new Map<string, number>();
  for (const [term, count] of df) idf.set(term, Math.log((n + 1) / (count + 0.5)));
  return idf;
}

/** L2-normalised tf-idf vector, so cosine similarity is a plain dot product. */
function vectorize(tokens: string[], idf: Map<string, number>): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);

  const vec = new Map<string, number>();
  let norm = 0;
  for (const [term, count] of tf) {
    const w = (1 + Math.log(count)) * (idf.get(term) ?? 0);
    if (w <= 0) continue;
    vec.set(term, w);
    norm += w * w;
  }
  norm = Math.sqrt(norm) || 1;
  for (const [term, w] of vec) vec.set(term, w / norm);
  return vec;
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  // Iterate the shorter vector: most pairs share almost nothing.
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [term, w] of small) {
    const other = large.get(term);
    if (other) dot += w * other;
  }
  return dot;
}

/** Coverage of one event is bursty, so similarity decays with the gap. */
function timeDecay(aMs: number, bMs: number, halfLifeHours: number): number {
  const gapHours = Math.abs(aMs - bMs) / 3_600_000;
  return Math.pow(0.5, gapHours / halfLifeHours);
}

/* -------------------------------------------------------------- union-find */

class DisjointSet {
  private parent: number[];
  private sizes: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.sizes = Array.from({ length: n }, () => 1);
  }
  find(i: number): number {
    while (this.parent[i] !== i) { this.parent[i] = this.parent[this.parent[i]]; i = this.parent[i]; }
    return i;
  }
  union(a: number, b: number): void {
    const ra = this.find(a); const rb = this.find(b);
    if (ra !== rb) {
      this.parent[rb] = ra;
      this.sizes[ra] += this.sizes[rb];
    }
  }
  size(i: number): number { return this.sizes[this.find(i)]; }
}

export interface ClusterOptions {
  /** Cosine similarity above which two posts are the same story. */
  threshold?: number;
  /** Hours at which time decay halves similarity. */
  halfLifeHours?: number;
  /** Clusters smaller than this are dropped as noise. */
  minSize?: number;
  /** Only compare posts within this many hours of each other. */
  maxGapHours?: number;
  /**
   * Core terms two clusters must share before they merge. A cluster's core is
   * what most of its members say (not its tf-idf peaks: the bigger a story,
   * the lower its own entity's idf, which buries the one term that names it).
   * Two shared core terms is an entity plus a surname, or an entity plus an
   * event word; one shared term is a busy day, not one story.
   */
  mergeSharedTerms?: number;
}

/**
 * Group posts into stories.
 *
 * Shared canonical URLs merge unconditionally. Everything else has to clear a
 * time-decayed cosine threshold. Union-find gives single-link agglomeration,
 * which is the right shape here: a story spreads outlet to outlet over hours,
 * so transitive linking through intermediate posts is a feature rather than the
 * chaining failure it would be in a static corpus.
 */
export function clusterPosts(posts: ClusterablePost[], opts: ClusterOptions = {}): StoryCluster[] {
  const threshold = opts.threshold ?? 0.30;
  const halfLifeHours = opts.halfLifeHours ?? 240;
  const minSize = opts.minSize ?? 2;
  const maxGapHours = opts.maxGapHours ?? 720;

  if (posts.length === 0) return [];

  // Chronological order lets the inner loop stop early once the gap is too big.
  const items = [...posts].sort((a, b) => a.postedAt.getTime() - b.postedAt.getTime());
  const tokens = items.map((p) => tokenize(p.text ?? ''));
  const idf = buildIdf(tokens);
  const vectors = tokens.map((t) => vectorize(t, idf));
  const times = items.map((p) => p.postedAt.getTime());

  /*
   * The pipeline, in load-bearing order:
   *   1. link      -- URL proof plus guarded cosine, single-link.
   *   2. decompose -- an oversized component re-links its own members at a
   *                   stricter bar; hairballs shatter, wire-copy stories hold.
   *   3. camp-merge -- clusters that agree on core terms fold into one story.
   * Decomposing before merging matters: fragments freed from a hairball must
   * still be able to find their story, and a hairball must never be handed to
   * the merge pass, which would only glue it back together.
   */
  const MIN_LINK_TOKENS = 4;
  const MIN_SHARED_TERMS = 2;
  const BLOB_SIZE = 150;
  const SPLIT_BOOST = 0.2;
  const maxGapMs = maxGapHours * 3_600_000;

  // Signals 2 and 3 as a reusable pass: rare shared terms, decayed by time.
  //
  // Degeneracy guards, learned from an 8,000-post day chaining 77% of the
  // corpus into two hairballs. A near-empty caption ("Link in bio") carries a
  // one-term vector scoring cosine 1.0 against every other near-empty caption,
  // so cosine linking requires a real caption and two shared terms. And at
  // news-day density single-link percolates, so attachment gets harder as a
  // component grows: wispy links stop welding big things while verbatim wire
  // copy, which is what real cross-outlet stories are made of, clears any bar.
  const cosineLink = (ds: DisjointSet, indices: number[], bar0: number): void => {
    for (let a = 0; a < indices.length; a += 1) {
      const i = indices[a];
      if (tokens[i].length < MIN_LINK_TOKENS) continue;
      for (let b = a + 1; b < indices.length; b += 1) {
        const j = indices[b];
        if (times[j] - times[i] > maxGapMs) break;
        if (tokens[j].length < MIN_LINK_TOKENS) continue;
        if (ds.find(i) === ds.find(j)) continue;
        const sim = cosine(vectors[i], vectors[j]) * timeDecay(times[i], times[j], halfLifeHours);
        const grown = Math.max(ds.size(i), ds.size(j));
        const bar = grown > 32 ? bar0 + 0.05 * Math.log2(grown / 32) : bar0;
        if (sim < bar) continue;
        const [small, large] = vectors[i].size <= vectors[j].size
          ? [vectors[i], vectors[j]] : [vectors[j], vectors[i]];
        let shared = 0;
        for (const term of small.keys()) {
          if (large.has(term)) { shared += 1; if (shared >= MIN_SHARED_TERMS) break; }
        }
        if (shared >= MIN_SHARED_TERMS) ds.union(i, j);
      }
    }
  };

  const components = (ds: DisjointSet, indices: number[]): number[][] => {
    const byRoot = new Map<number, number[]>();
    for (const i of indices) {
      const root = ds.find(i);
      const g = byRoot.get(root);
      if (g) g.push(i); else byRoot.set(root, [i]);
    }
    return [...byRoot.values()];
  };

  // Signal 1: shared canonical URL. Treated as proof, up to a point: a story
  // link appears on a handful of posts (one article, a few platforms, some
  // syndication), while a link on dozens is an outlet's boilerplate footer
  // (SubscribeToNBC, a linktree) that welded every post an outlet made into
  // one node and, through any single cross-outlet link, welded outlets into a
  // corpus-sized hairball. Proof stops being proof at scale.
  const URL_WALLPAPER_POSTS = 15;
  const ds = new DisjointSet(items.length);
  const byUrl = new Map<string, number[]>();
  items.forEach((p, i) => {
    for (const raw of p.urls) {
      const key = canonicalUrl(raw);
      // A bare domain is not a story. Require a path.
      if (!key || !key.includes('/')) continue;
      const bucket = byUrl.get(key);
      if (bucket) bucket.push(i); else byUrl.set(key, [i]);
    }
  });
  for (const idxs of byUrl.values()) {
    if (idxs.length > URL_WALLPAPER_POSTS) continue;
    for (let k = 1; k < idxs.length; k += 1) ds.union(idxs[0], idxs[k]);
  }

  const allIndices = items.map((_, i) => i);
  cosineLink(ds, allIndices, threshold);

  // Decompose. A component this large is either the story of the day or a
  // percolation artifact; re-linking its own members at a stricter bar tells
  // them apart, because wire copy holds and wisps do not.
  let groups: number[][] = [];
  for (const group of components(ds, allIndices)) {
    if (group.length <= BLOB_SIZE) {
      groups.push(group);
      continue;
    }
    const sub = new DisjointSet(items.length);
    cosineLink(sub, group, threshold + SPLIT_BOOST);
    const parts = components(sub, group);
    const real = parts.filter((part) => part.length >= minSize);
    if (real.length <= 1) {
      groups.push(group);
    } else {
      groups.push(...parts);
    }
  }
  groups = groups.filter((g) => g.length >= minSize);

  // Camp-merge: coverage of one event splits into camps the pairwise pass
  // cannot bridge -- every outlet quoting the subject in one camp, every
  // outlet writing the obituary in another. What names the event across camps
  // is its core: terms most members share. Wallpaper is judged among
  // clusters, not documents, because document frequency disqualified "dolly"
  // on the very day Dolly was the story.
  const mergeSharedTerms = opts.mergeSharedTerms ?? 2;
  {
    const cores: (Set<string> | null)[] = groups.map((idxs) => {
      const memberCount = new Map<string, number>();
      for (const i of idxs) {
        for (const term of new Set(tokens[i])) {
          memberCount.set(term, (memberCount.get(term) ?? 0) + 1);
        }
      }
      // The bigger the cluster, the more caption styles it holds, and the
      // lower the fraction any one term reaches: "dolly" sat at 37% of a
      // five-thousand-post day-of-death cluster. Small camps stay strict at
      // 60%; big ones relax to 30%, and cross-cluster wallpaper filtering
      // below keeps junk that clears 30% ("https") from ever counting.
      const needed = Math.ceil(idxs.length * (idxs.length >= 100 ? 0.3 : 0.6));
      const core = new Set<string>();
      for (const [term, count] of memberCount) {
        if (count >= needed) core.add(term);
      }
      return core.size > 0 ? core : null;
    });
    const coreDf = new Map<string, number>();
    for (const core of cores) {
      if (!core) continue;
      for (const term of core) coreDf.set(term, (coreDf.get(term) ?? 0) + 1);
    }
    const wallpaperAt = Math.max(3, Math.ceil(groups.length * 0.15));
    const spans = groups.map((idxs) => {
      let from = Infinity;
      let to = -Infinity;
      for (const i of idxs) {
        if (times[i] < from) from = times[i];
        if (times[i] > to) to = times[i];
      }
      return { from, to };
    });

    const parent = groups.map((_, g) => g);
    const findGroup = (g: number): number => {
      while (parent[g] !== g) { parent[g] = parent[parent[g]]; g = parent[g]; }
      return g;
    };
    for (let a = 0; a < groups.length; a += 1) {
      if (!cores[a]) continue;
      for (let b = a + 1; b < groups.length; b += 1) {
        if (!cores[b]) continue;
        if (findGroup(a) === findGroup(b)) continue;
        const gap = Math.max(spans[a].from, spans[b].from) - Math.min(spans[a].to, spans[b].to);
        if (gap > maxGapMs) continue;
        let shared = 0;
        for (const term of cores[b]!) {
          if (cores[a]!.has(term) && (coreDf.get(term) ?? 0) <= wallpaperAt) shared += 1;
        }
        if (shared >= mergeSharedTerms) parent[findGroup(b)] = findGroup(a);
      }
    }
    const mergedGroups = new Map<number, number[]>();
    groups.forEach((idxs, g) => {
      const root = findGroup(g);
      const bucket = mergedGroups.get(root);
      if (bucket) bucket.push(...idxs); else mergedGroups.set(root, [...idxs]);
    });
    groups = [...mergedGroups.values()];
  }

  const clusters: StoryCluster[] = [];
  for (const idxs of groups) {
    if (idxs.length < minSize) continue;
    const members = idxs.map((i) => items[i]);

    const byCompany = new Map<string, { id: string; name: string; postCount: number; engagement: number }>();
    for (const p of members) {
      const c = byCompany.get(p.companyId)
        ?? { id: p.companyId, name: p.companyName, postCount: 0, engagement: 0 };
      c.postCount += 1;
      c.engagement += p.engagementTotal;
      byCompany.set(p.companyId, c);
    }

    const sortedByTime = [...members].sort((a, b) => a.postedAt.getTime() - b.postedAt.getTime());
    const top = members.reduce((a, b) => (b.engagementTotal > a.engagementTotal ? b : a));

    // Centroid keywords: sum the member vectors and take the heaviest terms.
    const centroid = new Map<string, number>();
    for (const i of idxs) {
      for (const [term, w] of vectors[i]) centroid.set(term, (centroid.get(term) ?? 0) + w);
    }
    const keywords = [...centroid.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t]) => t);

    // Cohesion: mean similarity of members to the centroid. Surfaced rather than
    // hidden, because a loose cluster should look loose in the UI.
    let cohesion = 0;
    if (idxs.length > 1) {
      let norm = 0;
      for (const w of centroid.values()) norm += w * w;
      norm = Math.sqrt(norm) || 1;
      const unit = new Map([...centroid].map(([t, w]) => [t, w / norm] as const));
      cohesion = idxs.reduce((sum, i) => sum + cosine(vectors[i], unit), 0) / idxs.length;
    }

    clusters.push({
      id: 'story_' + idxs[0].toString(36) + '_' + members.length,
      label: (top.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 90) || keywords.slice(0, 4).join(', '),
      postIds: members.map((p) => p.id),
      posts: members,
      companies: [...byCompany.values()].sort((a, b) => b.engagement - a.engagement),
      platforms: [...new Set(members.map((p) => p.platform))],
      firstPostedAt: sortedByTime[0].postedAt,
      lastPostedAt: sortedByTime[sortedByTime.length - 1].postedAt,
      totalEngagement: members.reduce((s, p) => s + p.engagementTotal, 0),
      totalViews: members.reduce((s, p) => s + p.views, 0),
      brokeBy: { id: sortedByTime[0].companyId, name: sortedByTime[0].companyName },
      topPostId: top.id,
      keywords,
      cohesion,
    });
  }

  return clusters.sort((a, b) => b.totalEngagement - a.totalEngagement);
}
