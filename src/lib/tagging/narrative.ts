/**
 * What drove a day of a story, in words.
 *
 * The lifecycle chart could show that August 11 was the biggest day of the
 * Clancy trial and could name the single loudest post on it. Neither answers
 * the question a reader actually has, because a day is not one post: it is
 * testimony in the morning, a ruling at lunch and a reaction thread by
 * evening, all of which belong to one arc. So the model reads EVERY post
 * carrying the tag that day and writes what moved.
 *
 * Two constraints shape the prompt, both from CONTRACTS.md:
 *
 * 1. The model never states one of OUR measurements. Post counts, engagement
 *    and shares of coverage are computed in code and rendered beside the
 *    narrative; a model writing "roughly twelve thousand engagements" is
 *    inventing evidence. Facts about the world — a career milestone, a game
 *    number, a date — are welcome, because those come from the posts.
 * 2. It describes only what the posts say. No speculation about what happened
 *    next, no context from its training data about the case. If the posts do
 *    not establish something, the narrative does not contain it.
 *
 * This file is pure and tested without a database or a model.
 */

export interface NarrativePost {
  company: string;
  platform: string;
  text: string;
  /** Rank within the day by engagement, 1 = biggest. Used for emphasis only. */
  rank: number;
}

export interface NarrativeRequest {
  tagName: string;
  /** The tag's own definition, so the model knows what the story IS. */
  tagDefinition: string;
  /** Human day label, e.g. "Monday, 11 August 2026". */
  dayLabel: string;
  posts: NarrativePost[];
}

export const NARRATIVE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['narrative'],
  properties: {
    narrative: { type: 'string' },
  },
} as const;

/** Posts sent per day. Enough to see a day's shape without paying for a novel. */
export const MAX_POSTS_PER_NARRATIVE = 40;
const MAX_POST_CHARS = 220;
/** A day this thin is an anecdote; the arc is better served by silence. */
export const MIN_POSTS_FOR_NARRATIVE = 3;
/*
 * Room for two full sentences about a busy day. The first cap was 320, which
 * rejected three quarters of otherwise perfect narratives — a day with two
 * threads simply needs more words, and a rejected day shows a reader nothing
 * at all.
 */
const MAX_NARRATIVE_CHARS = 620;

export function buildNarrativeMessages(req: NarrativeRequest): {
  role: 'system' | 'user'; content: string;
}[] {
  const system = [
    'You explain what drove one day of one running story, for a newsroom analytics tool.',
    '',
    `The story: "${req.tagName}" — ${req.tagDefinition.trim()}`,
    '',
    'You will be given every post that newsrooms published about this story on a single',
    'day, ordered with the most-engaged first. Write ONE or TWO sentences describing what',
    'happened that day and what the coverage was about.',
    '',
    'Rules:',
    '1. Never state how much coverage there was. No counts of posts, no engagement or',
    '   view figures, no percentages, no "most of the coverage", no "the top post". The',
    '   tool renders those beside your sentence and only it can know them.',
    '   Facts reported IN the posts are fine, including dates and figures they mention.',
    '2. Describe only what these posts actually say. No background from your own knowledge,',
    '   no speculation about causes or consequences, no predictions.',
    '3. Write about the DAY as an episode of an ongoing story: what developed, what was',
    '   said, what the newsrooms focused on. Past tense, plain language, no preamble.',
    '4. If the posts cover several unrelated threads, name the dominant one and note that',
    '   coverage also touched the other.',
    '5. Never begin with "On this day" or repeat the story name. Start with the substance.',
    '',
    'Return JSON matching the schema exactly.',
  ].join('\n');

  const lines = req.posts.slice(0, MAX_POSTS_PER_NARRATIVE).map((post) => {
    const text = post.text.replace(/\s+/g, ' ').trim().slice(0, MAX_POST_CHARS);
    return `- [${post.company} · ${post.platform}] ${text}`;
  });

  return [
    { role: 'system', content: system },
    { role: 'user', content: `${req.dayLabel}\n\n${lines.join('\n')}` },
  ];
}

/**
 * Keep a narrative only if it is prose that makes no claim about our data.
 *
 * Offenders are rejected rather than scrubbed: a sentence written around a
 * figure reads as nonsense with the figure removed, and a broken sentence
 * beside real counts looks like the data is broken.
 */
export function validateNarrative(payload: unknown): string | null {
  const raw = (payload as { narrative?: unknown })?.narrative;
  if (typeof raw !== 'string') return null;
  const text = raw.replace(/\s+/g, ' ').trim();
  if (text.length < 25 || text.length > MAX_NARRATIVE_CHARS) return null;
  if (statesAMetric(text)) return null;
  return text;
}

/**
 * Does this sentence claim something about OUR measurements?
 *
 * The first version rejected any digit, which threw away true, useful facts
 * about the world — a career home run mark, a game number, a date — and cost
 * three quarters of all narratives. The danger was never a numeral; it is a
 * model asserting a quantity that only our database can know: how many posts
 * ran, how much engagement they earned, what share of coverage something was.
 * Those are computed in code and rendered beside the prose, so the model
 * stating one is either redundant or wrong.
 */
const METRIC_NOUNS = String.raw`posts?|engagements?|interactions?|impressions?|views?|likes?`
  + String.raw`|shares?|comments?|reactions?|followers?|mentions?|coverage|stories`;

function statesAMetric(text: string): boolean {
  // Any percentage at all: we never asked it to compute a share.
  if (/\d\s*%|\bpercent(age)?\b/i.test(text)) return true;
  // A number attached to one of our metrics, in either order.
  if (new RegExp(String.raw`\b\d[\d,.]*\s*(thousand|million|k|m)?\s+(${METRIC_NOUNS})\b`, 'i').test(text)) return true;
  if (new RegExp(String.raw`\b(${METRIC_NOUNS})\b[^.]{0,20}\b\d`, 'i').test(text)) return true;
  // Proportion-of-the-data words, which are the same claim without the digits.
  if (new RegExp(String.raw`\b(most|majority|nearly all|almost all|the bulk)\b[^.]{0,30}\b(${METRIC_NOUNS})\b`, 'i').test(text)) return true;
  return false;
}
