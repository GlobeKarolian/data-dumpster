/**
 * Prompt Lab, the statistical half: what does WORDING add, once the things
 * that are not wording are held fixed?
 *
 * Comparing top posts with typical ones (prompt-lab-core.ts) mixes causes:
 * short posts may win because breaking news is short, not because short
 * wins. Two regressions separate them, both plain ridge least squares on
 * log(lift), solved here with no dependencies:
 *
 *  1. Controlled: wording features plus length, with topic tags, post format
 *     and time of day as controls. Every post on the network counts.
 *  2. Same story: only stories (the same canonical link) posted more than
 *     once on the network, each compared with the other posts of the same
 *     story. The story's news value cancels out; what is left is phrasing,
 *     length and timing. Fewer posts, cleaner answer.
 *
 * Effects are reported as the percent change in lift with a 90% range. A
 * range that crosses zero means "no clear effect". The fit is checked on
 * held-out posts (rank correlation) so a weak model says so. These are
 * associations in our own data, not experiments; the report says that too.
 *
 * Pure: no I/O.
 */
import { FEATURES, visibleLength, type LabPost } from './prompt-lab-core';

export interface ModelEffect {
  key: string;
  label: string;
  effectPct: number;
  lowPct: number;
  highPct: number;
  /** Posts in the sample with this trait. */
  n: number;
  clear: boolean;
}

export interface ModelFit {
  posts: number;
  /** Spearman correlation between predicted and actual lift on held-out posts. */
  holdoutRank: number | null;
  effects: ModelEffect[];
}

export interface ModelReport {
  controlled: ModelFit | null;
  controls: string[];
  sameStory: (ModelFit & { stories: number }) | null;
}

/* ------------------------------------------------------------- linear algebra */

/** Solves A x = b for symmetric positive definite A (Cholesky). Returns null when A is singular. */
export function solveSpd(A: number[][], b: number[]): number[] | null {
  const n = A.length;
  const L = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) {
        if (s <= 1e-12) return null;
        L[i][i] = Math.sqrt(s);
      } else L[i][j] = s / L[j][j];
    }
  }
  const y = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i][k] * y[k];
    y[i] = s / L[i][i];
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k];
    x[i] = s / L[i][i];
  }
  return x;
}

function inverseSpd(A: number[][]): number[][] | null {
  const n = A.length;
  const cols: number[][] = [];
  for (let j = 0; j < n; j++) {
    const e = new Array<number>(n).fill(0);
    e[j] = 1;
    const c = solveSpd(A, e);
    if (!c) return null;
    cols.push(c);
  }
  return Array.from({ length: n }, (_, i) => cols.map((c) => c[i]));
}

export interface Ridge { beta: number[]; se: number[] }

/** Ridge least squares; column 0 may be an unpenalized intercept. Standard errors from the residual variance. */
export function ridge(X: number[][], y: number[], lambda = 1, intercept = true): Ridge | null {
  const n = X.length;
  const p = X[0]?.length ?? 0;
  if (!p || n <= p + 5) return null;
  const XtX = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const Xty = new Array<number>(p).fill(0);
  for (let r = 0; r < n; r++) {
    const row = X[r];
    for (let i = 0; i < p; i++) {
      if (row[i] === 0) continue;
      Xty[i] += row[i] * y[r];
      for (let j = 0; j <= i; j++) XtX[i][j] += row[i] * row[j];
    }
  }
  for (let i = 0; i < p; i++) for (let j = 0; j < i; j++) XtX[j][i] = XtX[i][j];
  for (let i = intercept ? 1 : 0; i < p; i++) XtX[i][i] += lambda;
  const beta = solveSpd(XtX, Xty);
  const inv = beta && inverseSpd(XtX);
  if (!beta || !inv) return null;
  let rss = 0;
  for (let r = 0; r < n; r++) {
    let pred = 0;
    for (let i = 0; i < p; i++) pred += X[r][i] * beta[i];
    rss += (y[r] - pred) ** 2;
  }
  const sigma2 = rss / (n - p);
  return { beta, se: inv.map((row, i) => Math.sqrt(Math.max(0, sigma2 * row[i]))) };
}

function ranks(xs: number[]): number[] {
  const idx = xs.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(xs.length);
  for (let k = 0; k < idx.length;) {
    let m = k;
    while (m + 1 < idx.length && idx[m + 1][0] === idx[k][0]) m++;
    for (let t = k; t <= m; t++) r[idx[t][1]] = (k + m) / 2;
    k = m + 1;
  }
  return r;
}

export function spearman(a: number[], b: number[]): number | null {
  if (a.length < 10) return null;
  const ra = ranks(a), rb = ranks(b);
  const n = a.length;
  const ma = ra.reduce((s, v) => s + v, 0) / n, mb = rb.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2; }
  return da && db ? num / Math.sqrt(da * db) : null;
}

/* ------------------------------------------------------------------ design */

interface Column { key: string; label: string; wording: boolean; value: (p: LabPost) => number }

const LENGTH_BANDS: [string, string, number, number][] = [
  ['len_short', 'under 80 characters (against 80 to 159)', 0, 80],
  ['len_mid', '160 to 279 characters (against 80 to 159)', 160, 280],
  ['len_long', '280 characters or more (against 80 to 159)', 280, Infinity],
];

const HOURS: [string, number, number][] = [
  ['overnight', 0, 6], ['morning', 6, 10], ['midday', 10, 14], ['afternoon', 14, 18], ['evening', 18, 22], ['late', 22, 24],
];
const hourBucket = (h: number | undefined) => HOURS.find(([, lo, hi]) => h !== undefined && h >= lo && h < hi)?.[0] ?? 'unknown';

const share = (posts: LabPost[], f: (p: LabPost) => boolean) => posts.filter(f).length / Math.max(1, posts.length);

/** Columns that vary enough in this sample to estimate. The most common level of each control is the baseline. */
function design(posts: LabPost[], withControls: boolean): { cols: Column[]; controls: string[] } {
  const cols: Column[] = [];
  for (const f of FEATURES) {
    const s = share(posts, (p) => f.test(p.text));
    if (s >= 0.03 && s <= 0.97) cols.push({ key: f.key, label: f.label, wording: true, value: (p) => (f.test(p.text) ? 1 : 0) });
  }
  for (const [key, label, lo, hi] of LENGTH_BANDS) {
    const t = (p: LabPost) => { const l = visibleLength(p.text); return l >= lo && l < hi; };
    const s = share(posts, t);
    if (s >= 0.03 && s <= 0.97) cols.push({ key, label, wording: true, value: (p) => (t(p) ? 1 : 0) });
  }
  const controls: string[] = [];
  const levels = (get: (p: LabPost) => string, prefix: string, min: number, max: number) => {
    const counts = new Map<string, number>();
    for (const p of posts) counts.set(get(p), (counts.get(get(p)) ?? 0) + 1);
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    for (const [level, n] of sorted.slice(1, max + 1)) {
      if (n < min) continue;
      cols.push({ key: `${prefix}:${level}`, label: level, wording: false, value: (p) => (get(p) === level ? 1 : 0) });
    }
    return sorted.length > 1;
  };
  if (levels((p) => p.type, 'type', 30, 6)) controls.push('post format');
  if (levels((p) => hourBucket(p.hour), 'hour', 30, 6)) controls.push('time of day');
  if (withControls) {
    const tagCounts = new Map<string, number>();
    for (const p of posts) for (const t of p.tags ?? []) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
    const tags = [...tagCounts.entries()].filter(([, n]) => n >= 30 && n <= posts.length * 0.9).sort((a, b) => b[1] - a[1]).slice(0, 25);
    for (const [tag] of tags) cols.push({ key: `tag:${tag}`, label: tag, wording: false, value: (p) => ((p.tags ?? []).includes(tag) ? 1 : 0) });
    if (tags.length) controls.push(`topic (${tags.length} tags)`);
  }
  return { cols, controls };
}

const target = (p: LabPost) => Math.log(Math.min(20, Math.max(0.05, p.lift)));
const Z90 = 1.645;

function effects(cols: Column[], fit: Ridge, posts: LabPost[], offset: number): ModelEffect[] {
  return cols.map((c, i) => ({ c, b: fit.beta[i + offset], se: fit.se[i + offset] }))
    .filter(({ c }) => c.wording)
    .map(({ c, b, se }) => {
      const pctOf = (x: number) => Math.round((Math.exp(x) - 1) * 100);
      const low = pctOf(b - Z90 * se), high = pctOf(b + Z90 * se);
      return { key: c.key, label: c.label, effectPct: pctOf(b), lowPct: low, highPct: high, n: posts.filter((p) => c.value(p) === 1).length, clear: low > 0 || high < 0 };
    })
    .sort((a, b) => Number(b.clear) - Number(a.clear) || Math.abs(b.effectPct) - Math.abs(a.effectPct));
}

/** Every fifth post is held out to check whether the model's predictions mean anything. */
function holdout(posts: LabPost[], build: (ps: LabPost[]) => { X: number[][]; y: number[] }): number | null {
  const train = posts.filter((_, i) => i % 5 !== 0);
  const test = posts.filter((_, i) => i % 5 === 0);
  const tr = build(train);
  const fit = ridge(tr.X, tr.y);
  if (!fit) return null;
  const te = build(test);
  const pred = te.X.map((row) => row.reduce((s, v, i) => s + v * fit.beta[i], 0));
  const r = spearman(pred, te.y);
  return r === null ? null : Math.round(r * 100) / 100;
}

export const MIN_MODEL_POSTS = 300;
export const MIN_STORY_POSTS = 200;

export function fitModel(posts: LabPost[]): ModelReport {
  const { cols, controls } = design(posts, true);
  const matrix = (ps: LabPost[]) => ({ X: ps.map((p) => [1, ...cols.map((c) => c.value(p))]), y: ps.map(target) });
  let controlled: ModelFit | null = null;
  if (posts.length >= MIN_MODEL_POSTS && cols.some((c) => c.wording)) {
    const { X, y } = matrix(posts);
    const fit = ridge(X, y);
    if (fit) controlled = { posts: posts.length, holdoutRank: holdout(posts, matrix), effects: effects(cols, fit, posts, 1) };
  }

  // Same story: demean within each story so its news value drops out.
  const groups = new Map<string, LabPost[]>();
  for (const p of posts) if (p.story) groups.set(p.story, [...(groups.get(p.story) ?? []), p]);
  const repeated = [...groups.values()].filter((g) => g.length >= 2);
  const storyPosts = repeated.flat();
  let sameStory: ModelReport['sameStory'] = null;
  if (storyPosts.length >= MIN_STORY_POSTS) {
    const d = design(storyPosts, false);
    const within = (gs: LabPost[][]) => {
      const X: number[][] = [], y: number[] = [];
      for (const g of gs) {
        const rows = g.map((p) => d.cols.map((c) => c.value(p)));
        const ys = g.map(target);
        const mx = d.cols.map((_, j) => rows.reduce((s, r) => s + r[j], 0) / g.length);
        const my = ys.reduce((s, v) => s + v, 0) / g.length;
        rows.forEach((r, i) => { X.push(r.map((v, j) => v - mx[j])); y.push(ys[i] - my); });
      }
      return { X, y };
    };
    const all = within(repeated);
    const fit = d.cols.some((c) => c.wording) ? ridge(all.X, all.y, 1, false) : null;
    if (fit) {
      const train = repeated.filter((_, i) => i % 5 !== 0), test = repeated.filter((_, i) => i % 5 === 0);
      const tFit = ridge(within(train).X, within(train).y, 1, false);
      const te = within(test);
      const r = tFit ? spearman(te.X.map((row) => row.reduce((s, v, i) => s + v * tFit.beta[i], 0)), te.y) : null;
      sameStory = {
        posts: storyPosts.length, stories: repeated.length,
        holdoutRank: r === null ? null : Math.round(r * 100) / 100,
        effects: effects(d.cols, fit, storyPosts, 0),
      };
    }
  }
  return { controlled, controls, sameStory };
}

const signed = (n: number) => (n > 0 ? `+${n}%` : `${n}%`);

/** The model's findings as plain text, appended to the measurements the AI reads and is checked against. */
export function renderModel(m: ModelReport): string {
  const lines: string[] = [];
  const list = (fit: ModelFit) => fit.effects.slice(0, 10).map((e) =>
    `- ${e.label}: ${signed(e.effectPct)} (90% range ${signed(e.lowPct)} to ${signed(e.highPct)}${e.clear ? '' : ', no clear effect'})`);
  if (m.controlled) {
    lines.push(
      `Effect on lift with other factors held fixed (a regression on ${m.controlled.posts} posts that also accounts for ${m.controls.join(', ') || 'nothing else'}${m.controlled.holdoutRank !== null ? `; on held-out posts its predictions correlate with actual results at ${m.controlled.holdoutRank}` : ''}):`,
      ...list(m.controlled),
    );
  }
  if (m.sameStory) {
    lines.push(
      `Same story, different wording (${m.sameStory.posts} posts of ${m.sameStory.stories} stories posted more than once, each compared only with posts of the same story):`,
      ...list(m.sameStory),
    );
  }
  if (lines.length) lines.push('These are associations in our own posts, not experiments. A story\'s news value matters more than any of them.');
  return lines.join('\n');
}
