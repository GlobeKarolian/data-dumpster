/**
 * Prompt Lab: learn each network's drafting instructions from posts that worked.
 *
 * The method, so the result can be trusted and argued with:
 *
 *  1. Every post is scored against its own account's median engagement on that
 *     network in the window ("lift"). A 2.0 means twice that account's typical
 *     post. This keeps large accounts from drowning out small ones and makes a
 *     Boston.com Threads post comparable to a WBUR Threads post.
 *  2. The top tenth by lift is compared with the typical middle half. Code,
 *     not the model, measures the differences (length, questions, numbers,
 *     quotes, emoji, hashtags, labels like "BREAKING", and so on).
 *  3. The model reads those measurements plus real top and typical posts and
 *     writes the network's instruction, citing the measurements it relied on.
 *     Every number in its reasoning is checked against the measurements before
 *     an editor sees it (AGENTS.md rule 3).
 *
 * Engagement is reactions, comments and shares, not clicks. The house rules
 * (accuracy, no clickbait, no engagement bait) outrank anything the data
 * rewards, and the model is told so.
 *
 * Pure: no I/O, so it is tested directly.
 */
import { PUBLISH_PLATFORM_LABELS, textLength, type PublishPlatform } from './platforms';

export interface LabPost {
  company: string;
  type: string;
  text: string;
  engagement: number;
  /** Engagement divided by the account's median on this network in the window. */
  lift: number;
}

export interface Feature {
  key: string;
  label: string;
  test: (text: string) => boolean;
}

const URL_RE = /https?:\/\/\S+/g;
const EMOJI_RE = /\p{Extended_Pictographic}/u;

export const FEATURES: Feature[] = [
  { key: 'question', label: 'asks a question', test: (t) => /\?/.test(t.replace(URL_RE, '')) },
  { key: 'number', label: 'includes a number', test: (t) => /\d/.test(t.replace(URL_RE, '').replace(/#\w+/g, '')) },
  { key: 'quote', label: 'includes a direct quote', test: (t) => /[“"][^”"]{12,}[”"]/.test(t) },
  { key: 'startsQuote', label: 'opens with a quote', test: (t) => /^\s*[“"]/.test(t) },
  { key: 'emoji', label: 'uses emoji', test: (t) => EMOJI_RE.test(t) },
  { key: 'hashtag', label: 'uses hashtags', test: (t) => /(^|\s)#[\p{L}\d_]+/u.test(t) },
  { key: 'mention', label: 'tags another account (@)', test: (t) => /(^|\s)@[\w.]+/.test(t) },
  { key: 'label', label: 'opens with a label like BREAKING, NEW or UPDATE', test: (t) => /^\s*(breaking|developing|new|update|updated|just in|live|watch|exclusive)\b[:!\s-]/i.test(t) },
  { key: 'kicker', label: 'opens with a short kicker and colon', test: (t) => /^[^.!?\n:]{2,40}:\s/.test(t) && !/^\s*(breaking|update|new)\b/i.test(t) },
  { key: 'you', label: 'speaks to the reader (you, your)', test: (t) => /\byou(r|'re|’re)?\b/i.test(t) },
  { key: 'we', label: 'speaks as the newsroom (we, our)', test: (t) => /\b(we|our|we're|we’re|us)\b/i.test(t) },
  { key: 'exclaim', label: 'uses an exclamation point', test: (t) => /!/.test(t) },
  { key: 'lineBreak', label: 'uses line breaks', test: (t) => /\n/.test(t.trim()) },
  { key: 'link', label: 'has the link written in the text', test: (t) => /https?:\/\/\S+/.test(t) },
  { key: 'cta', label: 'tells people to read, tap or click', test: (t) => /\b(read more|read the full|full story|link in (our )?bio|tap the link|click|subscribe|sign up)\b/i.test(t) },
  { key: 'caps', label: 'has a word in ALL CAPS', test: (t) => /\b[A-Z]{5,}\b/.test(t.replace(URL_RE, '')) },
];

/** Characters a reader sees, links and trailing hashtag blocks aside. */
export function visibleLength(text: string): number {
  return textLength(text.replace(URL_RE, '').replace(/(\s#[\p{L}\d_]+)+\s*$/u, '').trim());
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

export interface FeatureRow { key: string; label: string; topPct: number; typicalPct: number }

export interface FactSheet {
  platform: PublishPlatform;
  days: number;
  posts: number;
  accounts: number;
  topCount: number;
  typicalCount: number;
  /** Lift at the 90th percentile: a top post did at least this many times its account's typical engagement. */
  topLiftFloor: number;
  medianLength: { top: number; typical: number };
  lengthBands: { band: string; topPct: number; typicalPct: number }[];
  features: FeatureRow[];
  types: { type: string; topPct: number; typicalPct: number }[];
}

export interface LabSplit { top: LabPost[]; typical: LabPost[] }

/** Top tenth by lift against the middle half. */
export function splitByLift(posts: LabPost[]): LabSplit {
  const s = [...posts].sort((a, b) => b.lift - a.lift);
  const topN = Math.max(1, Math.round(s.length * 0.1));
  const q1 = Math.floor(s.length * 0.25);
  const q3 = Math.ceil(s.length * 0.75);
  return { top: s.slice(0, topN), typical: s.slice(q1, q3) };
}

const BANDS: [string, number, number][] = [
  ['under 80 characters', 0, 80],
  ['80 to 159', 80, 160],
  ['160 to 279', 160, 280],
  ['280 to 499', 280, 500],
  ['500 or more', 500, Infinity],
];

export function buildFactSheet(platform: PublishPlatform, days: number, posts: LabPost[]): FactSheet {
  const { top, typical } = splitByLift(posts);
  const share = (group: LabPost[], f: (p: LabPost) => boolean) => pct(group.filter(f).length, group.length);
  const types = [...new Set(posts.map((p) => p.type))];
  return {
    platform, days,
    posts: posts.length,
    accounts: new Set(posts.map((p) => p.company)).size,
    topCount: top.length,
    typicalCount: typical.length,
    topLiftFloor: Math.round((top.at(-1)?.lift ?? 0) * 10) / 10,
    medianLength: { top: Math.round(median(top.map((p) => visibleLength(p.text)))), typical: Math.round(median(typical.map((p) => visibleLength(p.text)))) },
    lengthBands: BANDS.map(([band, lo, hi]) => ({
      band,
      topPct: share(top, (p) => { const l = visibleLength(p.text); return l >= lo && l < hi; }),
      typicalPct: share(typical, (p) => { const l = visibleLength(p.text); return l >= lo && l < hi; }),
    })),
    features: FEATURES.map((f) => ({ key: f.key, label: f.label, topPct: share(top, (p) => f.test(p.text)), typicalPct: share(typical, (p) => f.test(p.text)) }))
      // Only patterns that show up somewhere are worth the model's attention.
      .filter((r) => r.topPct >= 5 || r.typicalPct >= 5),
    types: types.map((type) => ({ type, topPct: share(top, (p) => p.type === type), typicalPct: share(typical, (p) => p.type === type) }))
      .filter((r) => r.topPct >= 5 || r.typicalPct >= 5),
  };
}

/** The fact sheet as plain text: what the model reads and what its reasoning is checked against. */
export function renderFactSheet(f: FactSheet): string {
  const lines = [
    `${PUBLISH_PLATFORM_LABELS[f.platform]}, last ${f.days} days: ${f.posts} posts from ${f.accounts} accounts.`,
    `Top posts: the best 10% by lift, ${f.topCount} posts, each at least ${f.topLiftFloor}x its own account's typical engagement. Typical posts: the middle 50%, ${f.typicalCount} posts.`,
    `Median length: top ${f.medianLength.top} characters, typical ${f.medianLength.typical} characters (links and trailing hashtags not counted).`,
    'Length (share of top posts vs share of typical posts):',
    ...f.lengthBands.map((b) => `- ${b.band}: ${b.topPct}% vs ${b.typicalPct}%`),
    'Patterns (share of top posts vs share of typical posts):',
    ...f.features.map((r) => `- ${r.label}: ${r.topPct}% vs ${r.typicalPct}%`),
  ];
  if (f.types.length > 1) {
    lines.push('Post format (share of top vs typical):', ...f.types.map((t) => `- ${t.type}: ${t.topPct}% vs ${t.typicalPct}%`));
  }
  return lines.join('\n');
}

/** Up to `n` posts, at most `perAccount` from any one account, so one outlet cannot set the style. */
export function pickExamples(group: LabPost[], n: number, perAccount = 3): LabPost[] {
  const out: LabPost[] = [];
  const used = new Map<string, number>();
  for (const p of group) {
    if (out.length >= n) break;
    const k = used.get(p.company) ?? 0;
    if (k >= perAccount) continue;
    used.set(p.company, k + 1);
    out.push(p);
  }
  return out;
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n).trimEnd() + '…' : s).replace(/\s*\n\s*/g, ' / ');

export function labSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['prompt', 'reasons'],
    properties: {
      prompt: { type: 'string' },
      reasons: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['rule', 'evidence'],
          properties: { rule: { type: 'string' }, evidence: { type: 'string' } },
        },
      },
    },
  };
}

export function buildLabMessages(f: FactSheet, top: LabPost[], typical: LabPost[], currentPrompt: string, house: string) {
  const name = PUBLISH_PLATFORM_LABELS[f.platform];
  const system = [
    'You are the head of social media for a Boston news organization. You write the instruction an AI follows when it drafts posts for one network.',
    'Base every rule on the evidence supplied: measurements computed by code from real posts, and real examples of top and typical posts. Do not rely on general social media advice the evidence does not support.',
    'The newsroom house rules always win. Never encourage a pattern that breaks them (clickbait, engagement bait such as "comment below", invented or exaggerated facts, outrage), even if it correlates with engagement. Say so in a reason when you leave such a pattern out.',
    'Engagement here means reactions, comments and shares, not clicks. Treat it as a signal of what people respond to, not as the goal itself.',
    'A difference of a few points is noise. Only build a rule on a clear difference, and prefer a few strong rules over many weak ones.',
    '',
    'House rules the drafting AI already follows:',
    house,
  ].join('\n');
  const user = [
    `<measurements>\n${renderFactSheet(f)}\n</measurements>`,
    `<top_posts>\n${top.map((p, i) => `${i + 1}. [${p.company}, ${p.lift.toFixed(1)}x] ${clip(p.text, 420)}`).join('\n')}\n</top_posts>`,
    `<typical_posts>\n${typical.map((p, i) => `${i + 1}. [${p.company}] ${clip(p.text, 300)}`).join('\n')}\n</typical_posts>`,
    `<current_instruction>\n${currentPrompt}\n</current_instruction>`,
    '',
    `Write the new ${name} instruction. It replaces the current one, so keep what still holds. Requirements:`,
    `- Start with "${name}:" and write 3 to 7 short imperative sentences the drafting AI can follow: length, how to open, voice, what to include, what to avoid.`,
    '- Give a target length in characters drawn from the measurements.',
    '- Do not quote or copy any example post, and name no outlet.',
    'Then list 3 to 6 reasons. Each names one rule and the measurement behind it, quoting the numbers exactly as they appear in the measurements.',
    'Reply with JSON only: {"prompt": "...", "reasons": [{"rule": "...", "evidence": "..."}]}.',
  ].join('\n');
  return [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: user },
  ];
}

export interface LabSuggestion { prompt: string; reasons: { rule: string; evidence: string }[] }

export function readSuggestion(json: unknown, platform: PublishPlatform): LabSuggestion | null {
  if (!json || typeof json !== 'object') return null;
  const { prompt, reasons } = json as { prompt?: unknown; reasons?: unknown };
  if (typeof prompt !== 'string' || prompt.trim().length < 20) return null;
  const name = PUBLISH_PLATFORM_LABELS[platform];
  const text = prompt.trim().startsWith(`${name}:`) ? prompt.trim() : `${name}: ${prompt.trim()}`;
  const list = Array.isArray(reasons) ? reasons : [];
  return {
    prompt: text.slice(0, 3000),
    reasons: list.filter((r): r is { rule: string; evidence: string } =>
      !!r && typeof r === 'object' && typeof (r as { rule?: unknown }).rule === 'string' && typeof (r as { evidence?: unknown }).evidence === 'string')
      .slice(0, 8),
  };
}
