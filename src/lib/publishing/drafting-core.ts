/**
 * AI drafting: the prompts, the request and the checks, with no I/O.
 *
 * Shared by the server (which calls the model) and the Settings screen (which
 * shows and edits the prompts), and pure so it can be tested.
 *
 * Accuracy rule, in the spirit of AGENTS.md rule 3: the model drafts, the code
 * checks. Every number and every quotation in a draft is looked up in the
 * story text, and anything not found is flagged to the editor before posting.
 */
import { PUBLISH_PLATFORMS, PUBLISH_PLATFORM_LABELS, TEXT_LIMITS, chargedLength, finalText, type LinkMode, type PublishPlatform } from './platforms';
import type { Article } from './article-extract';

export interface DraftPrompts {
  /** Applies to every network. */
  house: string;
  platforms: Record<PublishPlatform, string>;
}

/** Ids checked against OpenRouter's live catalog on 7 Oct 2026. Free text is allowed in Settings. */
export const DRAFT_MODELS = [
  { id: 'anthropic/claude-sonnet-5.5', label: 'Claude Sonnet 5.5 (default)' },
  { id: 'anthropic/claude-opus-5.5', label: 'Claude Opus 5.5' },
  { id: 'anthropic/claude-haiku-4.5', label: 'Claude Haiku 4.5 (cheapest)' },
  { id: 'openai/gpt-5.6-luna-pro', label: 'GPT-5.6 Luna Pro' },
  { id: 'google/gemini-3.7-flash', label: 'Gemini 3.7 Flash' },
] as const;
export const DEFAULT_DRAFT_MODEL = DRAFT_MODELS[0].id;

export const DEFAULT_DRAFT_PROMPTS: DraftPrompts = {
  house: [
    'You write social posts for Boston Globe Media brands (The Boston Globe, Boston.com and others). Write in the voice of the brand named for each post.',
    'Write like a sharp newsroom social editor: lead with the most interesting true thing in the story, in plain words a busy reader gets at a glance.',
    'Accuracy comes first. Use only facts, names, numbers and quotes that appear in the story. Never invent or round a number, never guess at a detail, and copy any quote word for word.',
    'No clickbait ("You won\'t believe", "Here\'s why", "This is what happened"), no hype, no opinion the story does not support. Keep a serious tone for crime, death and tragedy.',
    'Use AP style. Avoid exclamation points and emoji unless the story is light. Do not start with the brand name.',
    'Do not write the story link in the post; it is attached automatically where the network allows it.',
  ].join('\n'),
  platforms: {
    facebook: 'Facebook: one to three short sentences that make a local reader want to tap the link card. Conversational and concrete. Aim for 100 to 250 characters.',
    instagram: 'Instagram: the caption has to stand on its own, because there is no clickable link. Open with a strong first line (Instagram cuts the caption after about 125 characters), then two to four short sentences with the key facts. Do not mention a link or "link in bio". Up to three relevant hashtags at the very end are fine.',
    threads: 'Threads: conversational and direct, like telling a smart friend from Greater Boston what happened. One to three sentences, under 350 characters.',
    bluesky: 'Bluesky: plain and informative, no hype. One or two sentences, under 240 characters. No hashtags.',
    twitter: 'X: one tight sentence that leads with the news, under 220 characters. No hashtags.',
    linkedin: 'LinkedIn: for a professional audience. Two to four sentences on why the story matters for work, business or the region. No more than two hashtags.',
    tiktok: 'TikTok: a short, casual caption for a video about the story, under 150 characters, with up to three hashtags.',
  },
};

/** Saved prompts on top of the defaults; blank or missing fields fall back to the default. */
export function mergePrompts(saved: Partial<{ house: string; platforms: Partial<Record<string, string>> }> | null | undefined): DraftPrompts {
  const platforms = { ...DEFAULT_DRAFT_PROMPTS.platforms };
  for (const p of PUBLISH_PLATFORMS) {
    const v = saved?.platforms?.[p];
    if (typeof v === 'string' && v.trim()) platforms[p] = v.trim();
  }
  const house = typeof saved?.house === 'string' && saved.house.trim() ? saved.house.trim() : DEFAULT_DRAFT_PROMPTS.house;
  return { house, platforms };
}

export interface DraftAccount {
  /** Stable key the model echoes back: a1, a2, ... */
  key: string;
  targetId: string;
  brand: string;
  platform: PublishPlatform;
  linkMode: LinkMode;
  /** The tagged link exactly as it will be sent, to count what it costs. */
  sentLink: string | null;
}

/** Characters left for words once the link (if it rides in the text) is counted. */
export function textBudget(a: Pick<DraftAccount, 'platform' | 'linkMode' | 'sentLink'>): number {
  const linkCost = a.sentLink ? chargedLength(a.platform, finalText('x', a.sentLink, a.linkMode)) - 1 : 0;
  return Math.max(60, TEXT_LIMITS[a.platform] - linkCost);
}

function linkNote(mode: LinkMode): string {
  if (mode === 'card') return 'the link is attached as a preview card';
  if (mode === 'text') return 'the link is added after your text automatically';
  return 'there is no clickable link';
}

export function draftSchema(keys: string[]): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['posts'],
    properties: {
      posts: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['account', 'text'],
          properties: { account: { type: 'string', enum: keys }, text: { type: 'string' } },
        },
      },
    },
  };
}

export function buildDraftMessages(article: Article, accounts: DraftAccount[], prompts: DraftPrompts) {
  const platforms = [...new Set(accounts.map((a) => a.platform))];
  const system = [
    prompts.house,
    '',
    'Network instructions:',
    ...platforms.map((p) => `- ${prompts.platforms[p]}`),
    '',
    'Reply with JSON only: {"posts":[{"account":"<key>","text":"<post>"}]}, one entry per account listed, nothing else.',
  ].join('\n');

  const story = [
    `Headline: ${article.title}`,
    article.description ? `Summary: ${article.description}` : null,
    article.byline.length ? `By: ${article.byline.join(', ')}` : null,
    article.section ? `Section: ${article.section}` : null,
    article.publishedAt ? `Published: ${article.publishedAt}` : null,
    '',
    article.source === 'summary' ? '(Only the summary could be read; the full story was not available. Stay within the summary.)' : 'Story:',
    article.text,
  ].filter((l) => l !== null).join('\n');

  const list = accounts.map((a) =>
    `- ${a.key}: ${a.brand} on ${PUBLISH_PLATFORM_LABELS[a.platform]} (at most ${textBudget(a)} characters; ${linkNote(a.linkMode)})`,
  ).join('\n');

  const user = `<story>\n${story}\n</story>\n\nWrite one post for each of these accounts:\n${list}`;
  return [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: user },
  ];
}

/** The model's posts keyed by account, ignoring anything it made up or repeated. */
export function readDrafts(json: unknown, keys: string[]): Map<string, string> {
  const out = new Map<string, string>();
  const posts = json && typeof json === 'object' && Array.isArray((json as { posts?: unknown }).posts) ? (json as { posts: unknown[] }).posts : [];
  for (const p of posts) {
    if (!p || typeof p !== 'object') continue;
    const { account, text } = p as { account?: unknown; text?: unknown };
    if (typeof account !== 'string' || typeof text !== 'string' || !keys.includes(account) || out.has(account)) continue;
    const clean = text.trim();
    if (clean) out.set(account, clean);
  }
  return out;
}

/* ---------------------------------------------------------------- checks */

const norm = (s: string) => s.toLowerCase().replace(/[“”"]/g, '"').replace(/[‘’']/g, "'").replace(/[–—]/g, '-').replace(/\s+/g, ' ');
const digits = (s: string) => s.replace(/[^\d.]/g, '').replace(/\.$/, '');

/**
 * What an editor must look at before posting: numbers and quotes the story
 * does not contain, and text over the network's limit.
 */
export function checkDraft(text: string, source: string, budget: number, platform: PublishPlatform): string[] {
  const warnings: string[] = [];
  const hay = norm(source);
  const hayDigits = new Set((source.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map(digits));

  const numbers = new Set((text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map(digits).filter(Boolean));
  for (const n of numbers) {
    if (!hayDigits.has(n)) warnings.push(`“${n}” is not in the story. Check the number.`);
  }

  for (const [, q] of text.matchAll(/[“"]([^”"]{12,})[”"]/g)) {
    const words = q.trim().split(/\s+/);
    if (words.length < 3) continue;
    // A quote ending a sentence in the post can close with a period where the story had a comma.
    const core = q.trim().replace(/[.,!?;:]+$/, '');
    if (!hay.includes(norm(core))) warnings.push(`This quote is not word for word in the story: “${q.trim()}”`);
  }

  const used = chargedLength(platform, text);
  if (used > budget) warnings.push(`${used - budget} characters too long for ${PUBLISH_PLATFORM_LABELS[platform]}.`);
  return warnings;
}
