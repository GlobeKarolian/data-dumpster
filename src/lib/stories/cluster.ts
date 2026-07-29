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
  constructor(n: number) { this.parent = Array.from({ length: n }, (_, i) => i); }
  find(i: number): number {
    while (this.parent[i] !== i) { this.parent[i] = this.parent[this.parent[i]]; i = this.parent[i]; }
    return i;
  }
  union(a: number, b: number): void {
    const ra = this.find(a); const rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }
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

  const ds = new DisjointSet(items.length);

  // Signal 1: shared canonical URL. Treated as proof.
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
    for (let k = 1; k < idxs.length; k += 1) ds.union(idxs[0], idxs[k]);
  }

  // Signals 2 and 3: rare shared terms, decayed by time.
  const maxGapMs = maxGapHours * 3_600_000;
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      if (times[j] - times[i] > maxGapMs) break;
      if (ds.find(i) === ds.find(j)) continue;
      const sim = cosine(vectors[i], vectors[j]) * timeDecay(times[i], times[j], halfLifeHours);
      if (sim >= threshold) ds.union(i, j);
    }
  }

  // Materialise groups.
  const groups = new Map<number, number[]>();
  items.forEach((_, i) => {
    const root = ds.find(i);
    const g = groups.get(root);
    if (g) g.push(i); else groups.set(root, [i]);
  });

  const clusters: StoryCluster[] = [];
  for (const [root, idxs] of groups) {
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
      id: 'story_' + root.toString(36) + '_' + members.length,
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
