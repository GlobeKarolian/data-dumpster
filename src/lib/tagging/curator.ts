/**
 * The curator: pure half.
 *
 * The tagger applies the vocabulary; the curator governs it. Suggestion
 * groups with real support come here as evidence, and a stronger model rules
 * each one: COVERED by an existing tag, worth CREATING (with a drafted name,
 * is/is-not definition and parent), or REJECTED as one-off noise. This file
 * owns what that model is asked and which of its answers may survive; the
 * durable half (curation.ts) owns gathering evidence and executing verdicts.
 *
 * The constraint that keeps the vocabulary meaningful is unchanged from the
 * tagger: the model can only ever REFERENCE tags we list. The one new power —
 * proposing a tag that does not exist — is bounded by evidence thresholds, a
 * daily creation cap, and a full audit row per ruling.
 */
import type { AiTagDefinition } from './ai-tagger';
import { normalizeLabel } from './ai-tagger';

export interface SuggestionGroup {
  labelNorm: string;
  /** The most common verbatim spelling, for display and for the prompt. */
  label: string;
  supportPosts: number;
  supportCompanies: number;
  /** Up to a handful of sample post texts, newest first. */
  samples: { company: string; text: string }[];
}

export interface CuratorVerdict {
  labelNorm: string;
  verdict: 'covered' | 'create' | 'reject';
  coveredByTagId: string | null;
  name: string | null;
  definition: string | null;
  parentTagId: string | null;
  confidence: number;
  rationale: string;
}

/** A group must be seen this often, this widely, before the curator reads it. */
export const MIN_SUPPORT_POSTS = 4;
export const MIN_SUPPORT_COMPANIES = 2;
/** Groups ruled per pass; keeps one pass one completion. */
export const GROUPS_PER_PASS = 6;
/**
 * Auto-creations allowed per org per day unless overridden.
 *
 * Raised from 3 once the curator had a track record: of its first 31 rulings
 * it created 3 (Dan McKee, Elly De La Cruz, Luigi Mangione Case — all
 * legitimate recurring subjects), deferred 13 to existing tags and rejected
 * 15, while 69 more sat queued behind the cap. A governor that throttles good
 * judgment just leaves the vocabulary stale in a different way. Retiring a
 * bad tag is one edit and every creation is logged with its evidence.
 */
export const AUTOCREATE_DAILY_DEFAULT = 10;

export const CURATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdicts'],
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'verdict', 'coveredByTagId', 'name', 'definition', 'parentTagId', 'confidence', 'rationale'],
        properties: {
          label: { type: 'string' },
          verdict: { type: 'string', enum: ['covered', 'create', 'reject'] },
          coveredByTagId: { type: ['string', 'null'] },
          name: { type: ['string', 'null'] },
          definition: { type: ['string', 'null'] },
          parentTagId: { type: ['string', 'null'] },
          confidence: { type: 'number' },
          rationale: { type: 'string' },
        },
      },
    },
  },
} as const;

export function buildCurationMessages(
  tags: AiTagDefinition[],
  groups: SuggestionGroup[],
): { role: 'system' | 'user'; content: string }[] {
  const tagLines = tags.map((t) => `- id ${t.id} · "${t.name}": ${t.aiPrompt.trim()}`);
  const system = [
    'You govern the tag vocabulary of a newsroom analytics tool.',
    '',
    'The existing taxonomy:',
    ...tagLines,
    '',
    'A cheaper tagging model has repeatedly suggested the topics below as missing from the',
    'taxonomy. For each, rule exactly one of:',
    '',
    '- "covered": an existing tag already means this. Set coveredByTagId to that tag id.',
    '- "create": the topic deserves its own tag. Draft it:',
    '    name — 2 to 4 words, title case, how an editor would say it.',
    '    definition — 2 to 4 sentences in the style of the existing definitions: what it IS,',
    '      what it is NOT, written to be applied by a model reading one post at a time.',
    '    parentTagId — the id of the broadest existing tag this belongs under (a player under',
    '      its sport or team tag, an industry under the business tag), or null if none fits.',
    '- "reject": one-off noise, too vague, or unlikely to recur in coverage.',
    '',
    'Bar for "create": the topic must be a durable subject of repeated coverage — a person,',
    'team, company, industry, institution, or a running story with a name. Not a single event,',
    'not a vague theme, not a synonym of an existing tag. When torn between covered and',
    'create, choose covered: a vocabulary grows by necessity, not enthusiasm.',
    '',
    'Use ONLY tag ids from the taxonomy above. confidence is 0 to 1 for your ruling.',
    'rationale is one sentence an editor will read. Return JSON matching the schema exactly.',
  ].join('\n');

  const blocks = groups.map((g) => {
    const lines = [
      `TOPIC "${g.label}" — suggested on ${g.supportPosts} posts across ${g.supportCompanies} outlets`,
      ...g.samples.map((s) => `  [${s.company}] ${s.text}`),
    ];
    return lines.join('\n');
  });

  return [
    { role: 'system', content: system },
    { role: 'user', content: blocks.join('\n\n') },
  ];
}

/**
 * Keep only verdicts that reference a judged group and, where they reference
 * tags, reference real ones. A "create" missing a usable name or definition
 * degrades to reject — a half-drafted tag is worse than none.
 */
export function validateVerdicts(
  payload: unknown,
  tags: AiTagDefinition[],
  groups: SuggestionGroup[],
): CuratorVerdict[] {
  const tagIds = new Set(tags.map((t) => t.id));
  const tagNames = new Set(tags.map((t) => normalizeLabel(t.name)));
  const byNorm = new Map(groups.map((g) => [g.labelNorm, g]));
  const out: CuratorVerdict[] = [];
  const ruled = new Set<string>();

  const list = (payload as { verdicts?: unknown })?.verdicts;
  if (!Array.isArray(list)) return out;

  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue;
    const v = item as Record<string, unknown>;
    const labelNorm = normalizeLabel(typeof v.label === 'string' ? v.label : '');
    if (!byNorm.has(labelNorm) || ruled.has(labelNorm)) continue;

    let verdict: CuratorVerdict['verdict'] =
      v.verdict === 'covered' || v.verdict === 'create' || v.verdict === 'reject'
        ? v.verdict
        : 'reject';
    let coveredByTagId = typeof v.coveredByTagId === 'string' && tagIds.has(v.coveredByTagId)
      ? v.coveredByTagId
      : null;
    const parentTagId = typeof v.parentTagId === 'string' && tagIds.has(v.parentTagId)
      ? v.parentTagId
      : null;
    const name = typeof v.name === 'string' ? v.name.trim().slice(0, 48) : '';
    const definition = typeof v.definition === 'string' ? v.definition.trim() : '';

    if (verdict === 'covered' && !coveredByTagId) verdict = 'reject';
    if (verdict === 'create') {
      const nameTaken = name && tagNames.has(normalizeLabel(name));
      if (!name || definition.length < 40 || nameTaken) verdict = 'reject';
    }
    if (verdict !== 'covered') coveredByTagId = null;

    const rawConfidence = typeof v.confidence === 'number' && Number.isFinite(v.confidence)
      ? v.confidence
      : 0.5;

    ruled.add(labelNorm);
    out.push({
      labelNorm,
      verdict,
      coveredByTagId,
      name: verdict === 'create' ? name : null,
      definition: verdict === 'create' ? definition : null,
      parentTagId: verdict === 'create' ? parentTagId : null,
      confidence: Math.max(0, Math.min(1, rawConfidence)),
      rationale: (typeof v.rationale === 'string' ? v.rationale.trim() : '').slice(0, 500),
    });
  }
  return out;
}

/**
 * Deterministic color for an auto-created tag: stable per name, drawn from a
 * palette that reads as "machine-proposed" next to the hand-picked family
 * colors, and never collides with the meaning of red (breaking) by accident.
 */
const AUTO_PALETTE = [
  '#0E7490', '#7C3AED', '#B45309', '#4D7C0F', '#BE185D',
  '#1D4ED8', '#0F766E', '#A21CAF', '#92400E', '#334155',
];

export function autoTagColor(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return AUTO_PALETTE[Math.abs(hash) % AUTO_PALETTE.length];
}
