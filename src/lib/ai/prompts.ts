/**
 * Every prompt Data Dumpster sends, and the honesty contract they all enforce.
 *
 * The product promise is narrow and absolute: a Data Dumpster brief is an AI
 * document nobody has to fact-check by hand. That is only true if the model is
 * structurally unable to invent a number. So:
 *
 *   - The model never queries anything. It receives a FactSheet that our own
 *     SQL already computed and sanity-checked, and it may only restate values
 *     that appear in it.
 *   - It may not add, divide, average, project, or annualise. If a number is
 *     not in the sheet, the correct output is a sentence without a number.
 *   - Every quantitative claim carries the fact-sheet path it came from, so
 *     verify.ts can check the output mechanically and a reader can check it by
 *     eye.
 *   - Percent changes above 1000% are described in words, never as a figure.
 *     A +4,300% week is always a near-zero baseline, and printing the figure
 *     turns a rounding artefact into a headline.
 *   - Every string in factSheet.caveats must survive into the output. Caveats
 *     are the part a model is most tempted to drop, and the part an editor most
 *     needs.
 *
 * Voice is the second half of the job. These briefs get forwarded to editors
 * and executives who read for a living, and nothing destroys trust faster than
 * a document that sounds like marketing. Newsroom register: plain declarative
 * sentences, the change first, the reason second, no adjectives doing work that
 * numbers should do.
 */
import type { FactSheet, PostDto } from '@/lib/metrics/contract';
import type { CompletionRequest } from './types';

export interface TagOption { id: string; name: string; description?: string | null }

/** One post, trimmed to what a tagger actually needs. */
export type TaggablePost = Pick<PostDto, 'id' | 'platform' | 'type' | 'postedAt' | 'text'> & {
  company?: { name: string } | null;
};

/* ----------------------------------------------------- fact-sheet rendering */

const MAX_TEXT = 400;

function trim(text: string | null | undefined, max = MAX_TEXT): string {
  if (!text) return '';
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max) + '…' : flat;
}

function unavailableMetricField(record: Record<string, unknown>, key: string): boolean {
  if (record.available === false && (key === 'value' || key === 'rank' || key === 'changePct')) {
    return true;
  }
  return record.previousAvailable === false && key === 'previousValue';
}

function availableBreakdown(
  record: Record<string, unknown>,
  value: unknown,
): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const availability = record.breakdownAvailability;
  if (!availability || typeof availability !== 'object' || Array.isArray(availability)) {
    return value as Record<string, unknown>;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(([platform]) =>
      (availability as Record<string, unknown>)[platform] !== false),
  );
}

/**
 * Strip the fields that cost tokens and carry no analytical signal: image URLs,
 * logos, permalinks, and long post bodies. Keeping the shape identical to the
 * FactSheet type is deliberate — the paths the model cites must be the paths
 * that exist in the stored fact sheet, or the audit trail breaks.
 */
function slimForPrompt(value: unknown, key?: string): unknown {
  if (Array.isArray(value)) return value.map((v) => slimForPrompt(v, key));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    const record = value as Record<string, unknown>;
    for (const [k, v] of Object.entries(record)) {
      if (k === 'thumbnailUrl' || k === 'logoUrl' || k === 'color' || k === 'mediaUrl') continue;
      if (unavailableMetricField(record, k)) continue;
      if (k === 'breakdown') {
        const measured = availableBreakdown(record, v);
        if (measured) out[k] = slimForPrompt(measured, k);
        continue;
      }
      out[k] = slimForPrompt(v, k);
    }
    return out;
  }
  if (typeof value === 'string' && key === 'text') return trim(value);
  if (typeof value === 'number') return Number.isInteger(value) ? value : Number(value.toFixed(4));
  return value;
}

/**
 * A flat index of every number in the sheet with its exact path.
 *
 * This is what makes citation cheap for the model and verification cheap for
 * us: the same path strings appear in the prompt, in the output, and in
 * verify.ts. No fuzzy matching, no "the engagement number", no ambiguity about
 * which of four similar figures a sentence meant.
 */
export function numberIndex(facts: FactSheet, limit = 600): { path: string; value: number }[] {
  const out: { path: string; value: number }[] = [];
  const walk = (node: unknown, path: string): void => {
    if (out.length >= limit) return;
    if (typeof node === 'number' && Number.isFinite(node)) {
      out.push({ path, value: node });
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, path + '[' + i + ']'));
      return;
    }
    if (node && typeof node === 'object') {
      const record = node as Record<string, unknown>;
      for (const [k, v] of Object.entries(record)) {
        if (unavailableMetricField(record, k)) continue;
        if (k === 'breakdown') {
          const measured = availableBreakdown(record, v);
          if (measured) walk(measured, path ? path + '.' + k : k);
          continue;
        }
        walk(v, path ? path + '.' + k : k);
      }
    }
  };
  walk(facts, 'facts');
  return out;
}

/** The exact payload the model sees. Stored alongside the brief for audit. */
export function renderFactSheet(facts: FactSheet): string {
  const index = numberIndex(facts);
  return [
    'FACT SHEET (authoritative, JSON):',
    JSON.stringify(slimForPrompt(facts), null, 1),
    '',
    'NUMBER INDEX (every number above, with its citable path):',
    index.map((e) => e.path + ' = ' + e.value).join('\n'),
  ].join('\n');
}

/* ------------------------------------------------------------ shared rules */

const HONESTY_RULES = [
  'HARD RULES. These are not style preferences. Violating any of them makes the output unusable.',
  '',
  '1. NUMBERS. You may state a number only if that exact number appears in the fact sheet.',
  '   You may not add, subtract, multiply, divide, average, rank, project, annualise, or',
  '   otherwise derive a new number. If the fact sheet does not contain a figure you want,',
  '   write the sentence without a figure, or omit the sentence.',
  '2. CITATIONS. Every sentence containing a number ends with the fact-sheet path that number',
  '   came from, in square brackets, exactly as written in the NUMBER INDEX. Example:',
  '   "Engagement fell to 41,208 [facts.focusSummary.headline.engagementTotal.value]."',
  '   Multiple figures in one sentence get multiple bracketed paths.',
  '3. RUNAWAY PERCENTAGES. If a percent change is greater than 1000% (or less than -95%),',
  '   never print the figure. Describe it in words and say why: such swings always come from a',
  '   near-zero baseline in the prior period, so the ratio is an artefact, not a result.',
  '   Write "grew from a near-zero base" rather than "+4,300%".',
  '4. CAVEATS. Every string in facts.caveats must appear in your output, in your own words,',
  '   attached to the claim it qualifies. Do not collect them in a footnote and do not drop one.',
  '5. UNCERTAINTY. If the data does not support a conclusion, say so plainly in one sentence.',
  '   "The data does not show why" is an acceptable and often correct thing to write.',
  '6. AVAILABILITY. A metric row with available=false was not measured. Do not call it zero,',
  '   rank it, compare it, or include it in an average. Its numeric fallback is omitted.',
  '7. NO OUTSIDE KNOWLEDGE. Do not use anything you know about these companies beyond the fact',
  '   sheet. No industry context, no news events, no benchmarks, no guesses about strategy.',
].join('\n');

const NEWSROOM_VOICE = [
  'VOICE. Write like a newsroom executive briefing a masthead, not like a marketing tool.',
  '',
  '- Plain declarative sentences. Subject, verb, object. Past tense for what happened.',
  '- Lead with what changed, then why it matters to this organisation. Never bury it.',
  '- No hype and no hedging filler: no "delve", "leverage", "unlock", "robust", "significant"',
  '  as a synonym for "large", "it is worth noting", "in today\'s landscape", "game-changer".',
  '- No emoji. No exclamation marks. No rhetorical questions. No bullet lists of one-word items.',
  '- Prefer a specific noun to an adjective. "Three video posts" beats "strong video performance".',
  '- Do not congratulate anyone. Do not editorialise about effort. Report.',
  '- An analyst reading this should be able to act on it or forward it without editing it.',
].join('\n');

function systemPrompt(role: string): string {
  return [role, '', HONESTY_RULES, '', NEWSROOM_VOICE].join('\n');
}

/* ------------------------------------------------------------ weekly brief */

const BRIEF_SHAPE = [
  'OUTPUT. Markdown, no front matter, no code fences. Use exactly these sections:',
  '',
  '# <headline: the single most important change this period, stated as fact>',
  '',
  'One paragraph, three to five sentences, that a chief executive could read alone and be',
  'correctly informed. What changed, for whom, and against which comparison period.',
  '',
  '## What moved',
  'Two to four short paragraphs on the largest changes in the fact sheet. Name the company and',
  'the metric. Where the fact sheet gives a previous value or a change, use it to anchor the size',
  'of the move. Do not list every metric; choose the ones a person would act on.',
  '',
  '## Competitive picture',
  'Where the focus company sits relative to the rest of the landscape, using the leaderboards and',
  'the landscape totals. If the focus company is not in the fact sheet, describe the landscape',
  'leaders instead and say the focus company was not set.',
  '',
  '## Content that worked',
  'Two or three specific posts, tags, or post types that outperformed, each with the number that',
  'shows it and what the post actually was. Describe the content, not the format label alone.',
  '',
  '## What to watch',
  'Two or three sentences on what next period should confirm or contradict. No predictions with',
  'numbers attached. Frame each as something that can be checked.',
  '',
  '## Caveats',
  'Every caveat from facts.caveats, one per line, plainly worded, each saying which claim above it',
  'qualifies. If facts.caveats is empty, write: "No data quality caveats were flagged for this period."',
].join('\n');

/**
 * The flagship output: the weekly competitive brief.
 *
 * Temperature is low but not zero. Zero produces stilted, repetitive prose that
 * reads identically week to week, which trains editors to stop reading; 0.3
 * varies the sentence construction while the hard rules keep the facts pinned.
 */
export function weeklyBriefPrompt(facts: FactSheet): CompletionRequest {
  const period = facts.range.start + ' to ' + facts.range.end + ' (' + facts.range.days + ' days)';
  const prior = facts.previousRange.start + ' to ' + facts.previousRange.end;
  return {
    temperature: 0.3,
    messages: [
      {
        role: 'system',
        content: systemPrompt(
          'You are the analyst who writes the competitive brief for a newsroom. You are given a '
          + 'pre-computed, already-verified fact sheet and you narrate it. You do not have access to '
          + 'any data source. Your output is read by editors who will forward it unedited.',
        ),
      },
      {
        role: 'user',
        content: [
          'Landscape: ' + facts.landscape.name,
          'Focus company: ' + (facts.landscape.focusCompany ?? 'not set'),
          'Period: ' + period,
          'Compared against: ' + prior,
          'Companies tracked: ' + facts.companies.map((c) => c.name).join(', '),
          '',
          renderFactSheet(facts),
          '',
          BRIEF_SHAPE,
          '',
          'Write the brief now.',
        ].join('\n'),
      },
    ],
  };
}

/* -------------------------------------------------------- anomaly narration */

/**
 * Turns one machine-detected movement into two or three sentences an editor can
 * read in an alert. The detector already decided the movement is real; the model
 * only explains what it is and how much weight to put on it.
 */
export function anomalyNarrationPrompt(
  anomaly: FactSheet['anomalies'][number],
  facts: FactSheet,
): CompletionRequest {
  return {
    temperature: 0.2,
    maxTokens: 400,
    messages: [
      {
        role: 'system',
        content: systemPrompt(
          'You explain a single detected movement in a competitive social dataset. Two to three '
          + 'sentences, no headings, no bullets. This text appears inside an alert, so it must stand '
          + 'alone without the surrounding report.',
        ),
      },
      {
        role: 'user',
        content: [
          'DETECTED MOVEMENT:',
          JSON.stringify(slimForPrompt(anomaly), null, 1),
          '',
          renderFactSheet(facts),
          '',
          'Write two or three sentences: what happened, how large it is relative to the baseline in',
          'the movement record, and how much confidence the reader should place in it. If zScore is',
          'null or the baseline is small, say the movement is directional rather than measured.',
          'Cite paths for every number. Do not speculate about the cause.',
        ].join('\n'),
      },
    ],
  };
}

/* ---------------------------------------------------------------- ask data */

/**
 * Natural-language questions over the same fact sheet.
 *
 * The refusal behaviour is the feature. A tool that answers "what was our
 * engagement rate on Threads" with a plausible invented number is worse than a
 * tool that says the fact sheet does not cover Threads, because the first
 * teaches people to trust it.
 */
export function askDataPrompt(question: string, facts: FactSheet): CompletionRequest {
  return {
    temperature: 0.1,
    maxTokens: 900,
    messages: [
      {
        role: 'system',
        content: systemPrompt(
          'You answer questions about a competitive social dataset using only a supplied fact sheet. '
          + 'You are a careful analyst, not a search engine: a wrong number is far worse than a '
          + 'refusal. Answer in at most six sentences, in prose. No headings.',
        ),
      },
      {
        role: 'user',
        content: [
          'QUESTION: ' + question.trim(),
          '',
          renderFactSheet(facts),
          '',
          'Answer using only the fact sheet. If the fact sheet does not contain what is needed, say',
          'exactly which figure is missing and what filter or date range would produce it, then stop.',
          'Do not approximate from a related number. Cite the path for every figure you state.',
          'If any caveat in facts.caveats bears on this answer, state it in the same breath as the figure.',
        ].join('\n'),
      },
    ],
  };
}

/* ------------------------------------------------------------ post tagging */

/**
 * JSON Schema for tagging. Closed objects and an explicit enum of tag ids mean
 * providers that support strict structured output physically cannot return a
 * tag that does not exist, which is the failure mode that would otherwise
 * silently pollute an org's taxonomy.
 */
function taggingSchema(tags: TagOption[]): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['assignments'],
    properties: {
      assignments: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['postId', 'tagIds', 'confidence', 'evidence'],
          properties: {
            postId: { type: 'string' },
            tagIds: {
              type: 'array',
              items: tags.length ? { type: 'string', enum: tags.map((t) => t.id) } : { type: 'string' },
            },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            evidence: {
              type: 'string',
              description: 'The words in the post that justify the tags. Empty string when tagIds is empty.',
            },
          },
        },
      },
    },
  };
}

/**
 * Classify posts against an org's own taxonomy.
 *
 * Tagging is the one place a model is allowed to make a judgement rather than
 * restate a fact, so the guardrail moves: it must quote the post text it relied
 * on. An unevidenced tag is a wrong tag waiting to be found, and evidence makes
 * a bad tag reviewable in a glance rather than a re-read.
 */
export function postTaggingPrompt(posts: TaggablePost[], tags: TagOption[]): CompletionRequest {
  return {
    temperature: 0,
    jsonSchema: taggingSchema(tags),
    messages: [
      {
        role: 'system',
        content: [
          'You assign an organisation\'s own content tags to social posts. You are conservative:',
          'a post with no clearly applicable tag gets an empty tag list. Precision matters more than',
          'coverage, because a human reviews false negatives cheaply and false positives expensively.',
          '',
          'RULES.',
          '- Use only the tag ids supplied. Never invent a tag, a name, or an id.',
          '- Assign a tag only when the post text, hashtags, or link support it directly.',
          '- Quote the supporting words from the post in the evidence field. Do not paraphrase.',
          '- Confidence is your own honest estimate: below 0.6 means a human should look.',
          '- Return exactly one assignment object per post, in the order given, including posts you',
          '  tagged with nothing.',
          '- Do not infer sentiment, quality, or performance. You are labelling subject matter.',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          'AVAILABLE TAGS:',
          tags.map((t) => '- ' + t.id + ' — ' + t.name + (t.description ? ': ' + trim(t.description, 200) : '')).join('\n'),
          '',
          'POSTS:',
          JSON.stringify(posts.map((p) => ({
            id: p.id,
            company: p.company?.name ?? null,
            platform: p.platform,
            type: p.type,
            postedAt: p.postedAt,
            text: trim(p.text, 600),
          })), null, 1),
          '',
          'Return the JSON object described by the schema. Nothing else.',
        ].join('\n'),
      },
    ],
  };
}

/* ------------------------------------------------- content recommendations */

/**
 * Recommendations, constrained to be evidence-led.
 *
 * Generic social media advice is free and worthless. Every recommendation here
 * has to name the fact-sheet number that motivated it, which means the model
 * can only recommend things this landscape's data actually supports, and a
 * reader can reject a recommendation by disputing its number.
 */
export function contentRecommendationPrompt(facts: FactSheet): CompletionRequest {
  return {
    temperature: 0.3,
    maxTokens: 1400,
    messages: [
      {
        role: 'system',
        content: systemPrompt(
          'You recommend what a social team should do next, based only on what this landscape\'s own '
          + 'data shows. Generic best practice is forbidden: if a recommendation could have been '
          + 'written without seeing this fact sheet, it does not belong in the output.',
        ),
      },
      {
        role: 'user',
        content: [
          'Landscape: ' + facts.landscape.name,
          'Focus company: ' + (facts.landscape.focusCompany ?? 'not set'),
          'Period: ' + facts.range.start + ' to ' + facts.range.end,
          '',
          renderFactSheet(facts),
          '',
          'OUTPUT. Markdown. Three to five recommendations, each as:',
          '',
          '### <the action, stated as an imperative verb phrase>',
          'One or two sentences of evidence from the fact sheet, with cited paths. Then one sentence',
          'naming what result would show it worked, and how it would be measured with a metric that',
          'already exists in this fact sheet.',
          '',
          'Order recommendations by the size of the supporting evidence, largest first. If the fact',
          'sheet supports fewer than three, return fewer and say in one closing line what additional',
          'data would be needed. End with a short "Caveats" section covering every string in',
          'facts.caveats that bears on a recommendation above.',
        ].join('\n'),
      },
    ],
  };
}
