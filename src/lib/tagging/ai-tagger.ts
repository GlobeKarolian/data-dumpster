/**
 * The pure half of AI tagging: fingerprint, prompt, schema, validation.
 *
 * Everything here is deterministic and tested without a database or a model.
 * The queue half (queue.ts) owns claiming, writing and settling; this file
 * owns what the model is asked and what of its answer is allowed to survive.
 * See docs/AI-TAGGING.md for the architecture.
 */
import { createHash } from 'node:crypto';

export interface AiTagDefinition {
  id: string;
  name: string;
  /** The tag's meaning, in the operator's words. This IS the classifier. */
  aiPrompt: string;
  /** Landscapes this tag applies to; empty means the whole org. */
  landscapeIds: string[];
}

export interface TaggablePostContent {
  id: string;
  platform: string;
  type: string;
  text: string | null;
  hashtags: string[];
  /** First few URLs only; a link roundup post can carry dozens. */
  urls: string[];
}

export interface ValidatedAssignment {
  postId: string;
  tagId: string;
  confidence: number;
}

/**
 * The taxonomy fingerprint. Any change to the set, names or definitions of an
 * org's AI-eligible tags moves this value, which is what makes old tagging
 * state stale. Sorted by id so ordering is never part of the identity.
 */
export function taxonomyFingerprint(tags: AiTagDefinition[]): string {
  const canon = [...tags]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((t) => `${t.id}${t.name}${t.aiPrompt.trim()}`)
    .join('');
  return createHash('sha256').update(canon).digest('hex');
}

/**
 * Strict response shape. Assignments reference ids only; suggestions are
 * free-text labels for topics the taxonomy has no word for, and they never
 * become assignments — they become evidence for the curator.
 */
export const TAGGING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['assignments', 'suggestions'],
  properties: {
    assignments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['postId', 'tagId', 'confidence'],
        properties: {
          postId: { type: 'string' },
          tagId: { type: 'string' },
          confidence: { type: 'number' },
        },
      },
    },
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['postId', 'label'],
        properties: {
          postId: { type: 'string' },
          label: { type: 'string' },
        },
      },
    },
  },
} as const;

const MAX_TEXT_CHARS = 1_500;
const MAX_URLS = 3;

export function buildTaggingMessages(
  tags: AiTagDefinition[],
  posts: TaggablePostContent[],
): { role: 'system' | 'user'; content: string }[] {
  const tagLines = tags.map((t) => `- id ${t.id} · "${t.name}": ${t.aiPrompt.trim()}`);
  const system = [
    'You are tagging social media posts for a newsroom analytics tool.',
    '',
    'The available tags, with the definition an editor wrote for each:',
    ...tagLines,
    '',
    'Rules for assignments:',
    '1. Apply a tag ONLY when the post clearly matches its definition. When in doubt, do not tag.',
    '2. Apply EVERY tag whose definition fits — the general category AND the specific topics '
      + 'together, never one instead of the other. A post about a Red Sox trade gets the sports '
      + 'category, the baseball tag, the team tag, and the player’s tag if one is defined. '
      + 'A biotech funding story gets the business category and the biotech tag. Specific tags '
      + 'never replace their general category; they ride along with it.',
    '3. A post may receive many tags, one, or none. Untaggable posts are normal.',
    '4. Use ONLY tag ids from the list above, and ONLY post ids from the input. Never invent ids.',
    '5. confidence is your certainty the definition applies, from 0 to 1.',
    '6. Judge from the post content alone. Do not guess at context you cannot see.',
    '',
    'Rules for suggestions:',
    '7. When a post’s clear primary subject — a person, team, company, industry, or running '
      + 'story — has NO adequate tag in the list, add a suggestion: the post id and a short label '
      + 'naming the subject (2 to 4 words, proper nouns preferred). At most 2 per post.',
    '8. Suggest only subjects likely to recur in news coverage. Never suggest a subject an '
      + 'existing tag already covers, and never use suggestions as a substitute for assignments.',
    '9. If nothing is missing, return an empty suggestions array. Most batches need none.',
    'Return JSON matching the schema exactly.',
  ].join('\n');

  const postBlocks = posts.map((p) => {
    const text = (p.text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_CHARS);
    const parts = [
      `POST ${p.id} (${p.platform}, ${p.type})`,
      text ? `text: ${text}` : 'text: (none)',
    ];
    if (p.hashtags.length > 0) parts.push(`hashtags: ${p.hashtags.slice(0, 12).join(' ')}`);
    if (p.urls.length > 0) parts.push(`links: ${p.urls.slice(0, MAX_URLS).join(' ')}`);
    return parts.join('\n');
  });

  return [
    { role: 'system', content: system },
    { role: 'user', content: postBlocks.join('\n\n') },
  ];
}

/**
 * Keep only assignments that name a real tag and a real claimed post.
 *
 * The model chooses from ids we supplied; anything else is dropped here and
 * counted, never written. Duplicates keep their highest confidence, because
 * two mentions of the same pairing are one opinion, not two rows.
 */
export function validateAssignments(
  payload: unknown,
  tags: AiTagDefinition[],
  posts: TaggablePostContent[],
): { assignments: ValidatedAssignment[]; dropped: number } {
  const tagIds = new Set(tags.map((t) => t.id));
  const postIds = new Set(posts.map((p) => p.id));
  const byKey = new Map<string, ValidatedAssignment>();
  let dropped = 0;

  const list = (payload as { assignments?: unknown })?.assignments;
  if (!Array.isArray(list)) return { assignments: [], dropped: 0 };

  for (const item of list) {
    if (typeof item !== 'object' || item === null) { dropped++; continue; }
    const a = item as Record<string, unknown>;
    const postId = typeof a.postId === 'string' ? a.postId : '';
    const tagId = typeof a.tagId === 'string' ? a.tagId : '';
    if (!postIds.has(postId) || !tagIds.has(tagId)) { dropped++; continue; }
    const raw = typeof a.confidence === 'number' && Number.isFinite(a.confidence) ? a.confidence : 0.5;
    const confidence = Math.max(0, Math.min(1, raw));
    const key = `${postId}${tagId}`;
    const existing = byKey.get(key);
    if (!existing || existing.confidence < confidence) {
      byKey.set(key, { postId, tagId, confidence });
    }
  }
  return { assignments: [...byKey.values()], dropped };
}

export interface ValidatedSuggestion {
  postId: string;
  label: string;
  labelNorm: string;
}

/** Grouping key for a label: case, spacing and trivial punctuation ignored. */
export function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[.,'"“”‘’!?()]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const MAX_SUGGESTIONS_PER_POST = 2;
const MAX_LABEL_CHARS = 48;

/**
 * Keep only suggestions that name a claimed post and carry a plausible label.
 *
 * A label that case-insensitively equals an existing tag's name is dropped:
 * the model was told those are covered, and letting them through would let
 * the suggestion pile re-litigate the taxonomy it was given. Everything kept
 * is evidence, never an assignment.
 */
export function validateSuggestions(
  payload: unknown,
  tags: AiTagDefinition[],
  posts: TaggablePostContent[],
): ValidatedSuggestion[] {
  const postIds = new Set(posts.map((p) => p.id));
  const tagNames = new Set(tags.map((t) => normalizeLabel(t.name)));
  const perPost = new Map<string, number>();
  const seen = new Set<string>();
  const out: ValidatedSuggestion[] = [];

  const list = (payload as { suggestions?: unknown })?.suggestions;
  if (!Array.isArray(list)) return out;

  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue;
    const s = item as Record<string, unknown>;
    const postId = typeof s.postId === 'string' ? s.postId : '';
    const label = typeof s.label === 'string' ? s.label.trim() : '';
    if (!postIds.has(postId)) continue;
    if (!label || label.length > MAX_LABEL_CHARS) continue;
    const labelNorm = normalizeLabel(label);
    if (!labelNorm || tagNames.has(labelNorm)) continue;
    const count = perPost.get(postId) ?? 0;
    if (count >= MAX_SUGGESTIONS_PER_POST) continue;
    const key = `${postId} ${labelNorm}`;
    if (seen.has(key)) continue;
    seen.add(key);
    perPost.set(postId, count + 1);
    out.push({ postId, label, labelNorm });
  }
  return out;
}

/** Retry backoff: 10 minutes doubling, capped at a day. */
export function nextRetryDelayMs(attempts: number): number {
  return Math.min(10 * 60_000 * 2 ** Math.max(0, attempts - 1), 24 * 3_600_000);
}

/** After this many consecutive failures a post waits for a taxonomy change. */
export const MAX_TAGGING_ATTEMPTS = 6;
