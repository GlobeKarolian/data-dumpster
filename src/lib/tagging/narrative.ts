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
 * 1. The model never states a figure. Counts and engagement are computed in
 *    code and rendered beside the narrative; a model that writes "roughly
 *    12,000 engagements" is a model inventing evidence. It is told this
 *    explicitly and the validator strips numerals it emits anyway.
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
const MAX_NARRATIVE_CHARS = 320;

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
    '1. State NO numbers, quantities, percentages or rankings. Not "several", not "most",',
    '   not "the top post". The tool renders the counts beside your sentence; a number in',
    '   your text would be an invented one.',
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
 * Keep a narrative only if it is prose that obeys the no-numbers rule.
 *
 * Digits are rejected rather than scrubbed. A sentence written around a figure
 * reads as nonsense with the figure removed ("the jury heard from  witnesses"),
 * and a broken sentence beside real counts looks like the data is broken. No
 * narrative at all is a better outcome, and the day simply shows its numbers.
 */
export function validateNarrative(payload: unknown): string | null {
  const raw = (payload as { narrative?: unknown })?.narrative;
  if (typeof raw !== 'string') return null;
  const text = raw.replace(/\s+/g, ' ').trim();
  if (text.length < 25 || text.length > MAX_NARRATIVE_CHARS) return null;
  // Digits, or the quantity words the model reaches for when told not to count.
  if (/\d/.test(text)) return null;
  if (/\b(several|dozens?|many|most|numerous|majority|handful|multiple)\b/i.test(text)) return null;
  return text;
}
