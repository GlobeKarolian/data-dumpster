/**
 * The "read the room" pass over one leakage run: what kind of account each
 * sharer is, which leaked copies were handed over as a paywall workaround,
 * the stance of the most-seen posts, and plain-English findings. The model
 * labels; every number shown next to a label is computed here from the run,
 * and anything the model returns that does not match a real account or post
 * is dropped.
 */
import type { CompletionRequest } from '@/lib/ai/types';
import type { SharePost } from './story-shares';

export const ACCOUNT_TYPES = [
  'our_staff_or_brand', 'news_outlet', 'journalist', 'public_figure', 'commentator', 'bot_or_aggregator', 'reader',
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  our_staff_or_brand: 'Our staff and brands',
  news_outlet: 'Other news outlets',
  journalist: 'Journalists elsewhere',
  public_figure: 'Public figures',
  commentator: 'Commentators and influencers',
  bot_or_aggregator: 'Bots and aggregators',
  reader: 'Readers',
};

export const STANCES = ['amplifying', 'criticizing_story', 'criticizing_subject', 'mocking', 'neutral'] as const;
export type Stance = (typeof STANCES)[number];

export const STANCE_LABEL: Record<Stance, string> = {
  amplifying: 'Recommending it',
  criticizing_story: 'Criticizing the story',
  criticizing_subject: 'Criticizing the people in it',
  mocking: 'Mocking',
  neutral: 'Neutral',
};

export interface AnalysisAccount { username: string; name: string | null; followers: number; bio: string; verified: string | null }

export interface LeakageAnalysis {
  accountTypes: Record<string, AccountType>;
  workaround: Record<string, boolean>;
  stance: Record<string, Stance>;
  findings: Array<{ headline: string; detail: string }>;
  model: string | null;
  costUsd: number;
  analyzedAt: string;
}

const MAX_ACCOUNTS = 220;
const MAX_TOP_POSTS = 40;

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? clean.slice(0, max - 1) + '…' : clean;
}

export function buildAnalysisPrompt(input: {
  headline: string | null;
  storyKey: string;
  summaryLine: string;
  accounts: AnalysisAccount[];
  posts: SharePost[];
}): { request: CompletionRequest; postIds: Map<string, string> } {
  const postIds = new Map<string, string>();
  const topPosts = [...input.posts].sort((a, b) => b.views - a.views).slice(0, MAX_TOP_POSTS);
  const leaked = input.posts.filter((p) => p.link === 'bypass');
  const chosen = [...new Map([...topPosts, ...leaked].map((p) => [p.url, p])).values()];
  chosen.forEach((p, i) => postIds.set('p' + (i + 1), p.url));
  const idFor = new Map([...postIds.entries()].map(([id, url]) => [url, id]));

  const accounts = [...input.accounts].sort((a, b) => b.followers - a.followers).slice(0, MAX_ACCOUNTS)
    .map((a) => '@' + a.username + ' | ' + clip(a.name ?? '', 60) + ' | ' + a.followers + ' followers'
      + (a.verified && a.verified !== 'none' ? ' | ' + a.verified : '') + ' | ' + clip(a.bio, 160))
    .join('\n');
  const posts = chosen
    .map((p) => idFor.get(p.url) + ' | @' + p.author + ' | ' + p.placement + ' | ' + (p.link === 'bypass' ? 'leaked copy via ' + p.tool : p.link === 'direct' ? 'links the story' : 'no link')
      + ' | ' + p.views + ' views | ' + clip(p.text, 240))
    .join('\n');

  const system = [
    'You help a newsroom understand how one of its stories spread on X and how people passed around free copies of it.',
    'Return JSON only, matching the schema.',
    '1. account_types: for EVERY account listed, pick one type:',
    '   our_staff_or_brand = works for or is an account of The Boston Globe, Boston Globe Media, STAT, Boston.com or Boston Magazine (bio or name says so);',
    '   news_outlet = an account of another news organization; journalist = a reporter, editor or writer at another outlet or independent;',
    '   public_figure = politician, candidate, official, celebrity, or a named expert with a public profile;',
    '   commentator = pundit, podcaster, influencer or activist whose posting is commentary;',
    '   bot_or_aggregator = automated, AI, engagement-farm or headline-aggregator account; reader = everyone else. When unsure, reader.',
    '2. workaround: for every post marked "leaked copy", true if it offers someone a way to read without paying (for example "no paywall link", "here you go", or answering someone who hit the paywall); false if it looks like archiving for the record or is unclear.',
    '3. stance: for every post listed, the poster\'s stance toward the story: amplifying, criticizing_story (attacks the reporting or the outlet), criticizing_subject (attacks the people or place in the story), mocking, or neutral.',
    '4. findings: 3 to 6 findings for a newsroom leader, most important first. Plain everyday words, no jargon. Each has a headline under 12 words and a detail of one or two sentences.',
    '   Use only numbers that appear in the input, and never name an account that is not in the input. Say who drove attention, who retold the story without linking it, and who passed around free copies and why.',
  ].join('\n');
  const user = [
    'Story: ' + (input.headline ?? input.storyKey),
    'Numbers: ' + input.summaryLine,
    '',
    'Accounts (username | name | followers | verification | bio):',
    accounts,
    '',
    'Posts (id | author | placement | link | views | text):',
    posts,
  ].join('\n');

  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['account_types', 'workaround', 'stance', 'findings'],
    properties: {
      account_types: {
        type: 'array',
        items: { type: 'object', additionalProperties: false, required: ['username', 'type'], properties: { username: { type: 'string' }, type: { type: 'string', enum: [...ACCOUNT_TYPES] } } },
      },
      workaround: {
        type: 'array',
        items: { type: 'object', additionalProperties: false, required: ['id', 'offers_workaround'], properties: { id: { type: 'string' }, offers_workaround: { type: 'boolean' } } },
      },
      stance: {
        type: 'array',
        items: { type: 'object', additionalProperties: false, required: ['id', 'stance'], properties: { id: { type: 'string' }, stance: { type: 'string', enum: [...STANCES] } } },
      },
      findings: {
        type: 'array',
        items: { type: 'object', additionalProperties: false, required: ['headline', 'detail'], properties: { headline: { type: 'string' }, detail: { type: 'string' } } },
      },
    },
  };

  return {
    request: { messages: [{ role: 'system', content: system }, { role: 'user', content: user }], jsonSchema: schema, maxTokens: 12_000, temperature: 0 },
    postIds,
  };
}

/** Keep only labels that refer to real accounts and posts, with valid values. */
export function validateAnalysis(
  payload: unknown,
  accounts: AnalysisAccount[],
  postIds: Map<string, string>,
  leakedUrls: Set<string>,
): Omit<LeakageAnalysis, 'model' | 'costUsd' | 'analyzedAt'> {
  const out: Omit<LeakageAnalysis, 'model' | 'costUsd' | 'analyzedAt'> = { accountTypes: {}, workaround: {}, stance: {}, findings: [] };
  if (!payload || typeof payload !== 'object') return out;
  const p = payload as Record<string, unknown>;
  const known = new Map(accounts.map((a) => [a.username.toLowerCase(), a.username]));
  for (const row of Array.isArray(p.account_types) ? p.account_types : []) {
    const r = row as { username?: unknown; type?: unknown };
    const name = typeof r.username === 'string' ? known.get(r.username.replace(/^@/, '').toLowerCase()) : undefined;
    if (name && typeof r.type === 'string' && (ACCOUNT_TYPES as readonly string[]).includes(r.type)) out.accountTypes[name] = r.type as AccountType;
  }
  for (const row of Array.isArray(p.workaround) ? p.workaround : []) {
    const r = row as { id?: unknown; offers_workaround?: unknown };
    const url = typeof r.id === 'string' ? postIds.get(r.id) : undefined;
    if (url && leakedUrls.has(url) && typeof r.offers_workaround === 'boolean') out.workaround[url] = r.offers_workaround;
  }
  for (const row of Array.isArray(p.stance) ? p.stance : []) {
    const r = row as { id?: unknown; stance?: unknown };
    const url = typeof r.id === 'string' ? postIds.get(r.id) : undefined;
    if (url && typeof r.stance === 'string' && (STANCES as readonly string[]).includes(r.stance)) out.stance[url] = r.stance as Stance;
  }
  for (const row of (Array.isArray(p.findings) ? p.findings : []).slice(0, 6)) {
    const r = row as { headline?: unknown; detail?: unknown };
    if (typeof r.headline === 'string' && typeof r.detail === 'string' && r.headline.trim() && r.detail.trim()) {
      out.findings.push({ headline: clip(r.headline, 120), detail: clip(r.detail, 420) });
    }
  }
  return out;
}

export interface TypeRow { type: AccountType; accounts: number; posts: number; views: number; leaked: number; linked: number; unlinked: number }

/** Who shared it, by account type. Unlabeled accounts count as readers. */
export function breakdownByType(posts: SharePost[], accountTypes: Record<string, AccountType>): TypeRow[] {
  const rows = new Map<AccountType, TypeRow & { names: Set<string> }>();
  for (const post of posts) {
    const type = accountTypes[post.author] ?? 'reader';
    const row = rows.get(type) ?? { type, accounts: 0, posts: 0, views: 0, leaked: 0, linked: 0, unlinked: 0, names: new Set<string>() };
    row.names.add(post.author);
    row.posts += 1;
    row.views += post.views;
    if (post.link === 'bypass') row.leaked += 1;
    else if (post.link === 'direct') row.linked += 1;
    else row.unlinked += 1;
    rows.set(type, row);
  }
  return [...rows.values()]
    .map(({ names, ...row }) => ({ ...row, accounts: names.size }))
    .sort((a, b) => b.views - a.views);
}
