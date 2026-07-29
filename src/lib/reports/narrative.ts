/**
 * AI drafting for one narrative section.
 *
 * The chief executive's standing instruction on this report is that it must
 * "answer so-what, put the data in perspective, no naked tables". That is a
 * writing problem, and writing is the one part of the weekly a person cannot
 * delegate to a query. So the model gets a draft button per section rather than
 * a "write the whole report" button: the author stays the author, and what they
 * accept is theirs.
 *
 * The honesty contract from lib/ai/prompts applies here unchanged. The model is
 * shown a rendering of exactly the material in that section -- the computed
 * block, the pasted tables, the hand-entered figures -- and it may not introduce
 * a number that is not in front of it. A section with no data yields a draft
 * that says so, not an invented paragraph.
 */
import 'server-only';
import { complete } from '@/lib/ai/client';
import type { CompletionRequest } from '@/lib/ai/types';
import {
  MANUAL_FIGURES,
  MANUAL_SECTIONS,
  NARRATIVE_SECTIONS,
  REPORT_PLATFORM_LABELS,
  REPORT_PLATFORMS,
  periodLabel,
  type NarrativeSectionSpec,
} from './types';
import {
  describeDirection, formatCount, formatPct, formatRate, formatSignedCount,
  type ReportDocument,
} from './render';

const RULES = [
  'HONESTY RULES.',
  '1. Every number you write must appear verbatim in the material below. You may not add,',
  '   divide, average, project, or annualise. If the number you want does not exist, write the',
  '   sentence without a number.',
  '2. If the material is empty or thin, say plainly that the data was not available this week.',
  '   Do not fill the gap with plausible prose.',
  '3. A percent change above 1000 percent always means a near-zero baseline. Describe it in',
  '   words, never as a figure.',
  '4. Repeat any measurement caveat you are given. It is the part a reader most needs.',
].join('\n');

const VOICE = [
  'VOICE. Newsroom register. Plain declarative sentences. The change first, the reason second.',
  'No adjectives doing work that numbers should do. No bullet lists, no headings, no markdown',
  'formatting of any kind. No preamble such as "Here is" or "In summary". Two to four sentences',
  'unless the section brief says otherwise. Write it as the paragraph that goes straight into the',
  'document.',
].join('\n');

/* ------------------------------------------------------ material rendering */

function computedMaterial(doc: ReportDocument): string[] {
  const c = doc.computed;
  if (!c) return ['COMPUTED DATA: not yet computed for this report.'];

  const lines: string[] = [];
  lines.push('COMPUTED DATA (window ' + periodLabel(c.period)
    + ', compared against ' + c.previousPeriod.start + ' to ' + c.previousPeriod.end + ').');
  lines.push('Landscape: ' + c.landscape.name + '.');
  lines.push('Focus brand: ' + (c.focus.companyName ?? 'not set') + '.');
  lines.push('Focus followers: ' + formatCount(c.focus.followers.value)
    + ', net change this week ' + formatSignedCount(c.focus.netFollowers)
    + ', ' + describeDirection(c.focus.followers.changePct) + '.');
  lines.push('Focus engagement total: ' + formatCount(c.focus.engagementTotal.value)
    + ', ' + describeDirection(c.focus.engagementTotal.changePct) + '.');
  lines.push('Focus posts: ' + formatCount(c.focus.posts.value)
    + '. Engagement per post: ' + formatRate(c.focus.engagementPerPost.value)
    + ', ' + describeDirection(c.focus.engagementPerPost.changePct) + '.');
  lines.push('Portfolio followers: ' + formatCount(c.portfolio.followers.value)
    + ', net ' + formatSignedCount(c.portfolio.netFollowers) + ' this week.');
  lines.push('Portfolio engagement: ' + formatCount(c.portfolio.engagementTotal.value)
    + ', ' + describeDirection(c.portfolio.engagementTotal.changePct) + '.');

  lines.push('');
  lines.push('BRANDS BY TOTAL FOLLOWERS:');
  for (const b of c.brands) {
    const split = REPORT_PLATFORMS
      .filter((p) => b.byPlatform[p] !== undefined)
      .map((p) => REPORT_PLATFORM_LABELS[p] + ' ' + formatCount(b.byPlatform[p]))
      .join(', ');
    lines.push('  ' + b.rank + '. ' + b.name + ' - ' + formatCount(b.totalFollowers)
      + ' followers, net ' + formatSignedCount(b.netChange)
      + (split ? ' (' + split + ')' : ''));
  }

  if (c.topPosts.length > 0) {
    lines.push('');
    lines.push('TOP ENGAGED POSTS:');
    for (const p of c.topPosts) {
      lines.push('  ' + p.rank + '. ' + p.companyName + ' on ' + p.platform + ', '
        + formatCount(p.engagementTotal) + ' engagements: '
        + (p.text ? p.text.slice(0, 200).replace(/\s+/g, ' ') : 'no post text captured'));
    }
  }

  lines.push('');
  lines.push('COHORT BY ENGAGEMENT (' + c.cohort.memberCount + ' brands):');
  for (const r of c.cohort.rows.slice(0, 15)) {
    lines.push('  ' + r.rank + '. ' + r.name + (r.isFocus ? ' (us)' : '') + ' - '
      + formatCount(r.engagementTotal) + ', ' + formatPct(r.changePct) + ' week over week');
  }
  if (c.cohort.focusPostRank) {
    lines.push('Our best post ranked ' + c.cohort.focusPostRank + ' of the top '
      + c.cohort.focusPostPool + ' posts in the landscape.');
  }
  if (c.caveats.length > 0) {
    lines.push('');
    lines.push('MEASUREMENT CAVEATS (repeat these):');
    for (const caveat of c.caveats) lines.push('  - ' + caveat);
  }
  return lines;
}

function manualMaterial(spec: NarrativeSectionSpec, doc: ReportDocument): string[] {
  const lines: string[] = [];
  for (const tableId of spec.sources.manualTables) {
    const section = MANUAL_SECTIONS.find((s) => s.id === tableId);
    if (!section) continue;
    const table = doc.manual.tables[tableId];
    lines.push('');
    lines.push('PASTED TABLE: ' + section.title);
    if (!table || table.rows.length === 0) {
      lines.push('  (nothing pasted for this table this week)');
      continue;
    }
    lines.push('  ' + section.columns.map((c) => c.label).join(' | '));
    for (const row of table.rows.slice(0, 25)) lines.push('  ' + row.join(' | '));
    if (table.rows.length > 25) {
      lines.push('  (' + (table.rows.length - 25) + ' further rows not shown)');
    }
  }

  const figures = spec.sources.manualFigures
    .map((id) => ({ spec: MANUAL_FIGURES.find((f) => f.id === id), value: doc.manual.figures[id] }))
    .filter((f) => f.spec && f.value && f.value.trim().length > 0);
  if (figures.length > 0) {
    lines.push('');
    lines.push('HAND-ENTERED FIGURES:');
    for (const f of figures) lines.push('  ' + f.spec?.label + ': ' + f.value?.trim());
  }
  return lines;
}

/** Build the completion request for one section. Exported so it is inspectable. */
export function narrativePrompt(spec: NarrativeSectionSpec, doc: ReportDocument): CompletionRequest {
  const material: string[] = [];
  if (spec.sources.computed) material.push(...computedMaterial(doc));
  material.push(...manualMaterial(spec, doc));

  return {
    temperature: 0.3,
    /**
     * No maxTokens. A reasoning model spends its budget thinking before it
     * writes, so a cap sized for a paragraph starves it and the request fails
     * having produced nothing. The connection's own limit is the right ceiling,
     * and the length instruction lives in the prompt where the model can read it.
     */
    messages: [
      {
        role: 'system',
        content: [
          'You write the narrative supplement for a weekly platforms report at a metropolitan news '
          + 'organisation. It is read by the chief executive and the executive team. Your only job '
          + 'is to answer so-what: put the numbers in perspective, say what changed and why it '
          + 'matters. The tables are already in the document; never restate a table.',
          '',
          RULES,
          '',
          VOICE,
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          'REPORT: ' + doc.title,
          'PERIOD: ' + periodLabel(doc.period),
          doc.dataNote && doc.dataNote.trim()
            ? 'IMPORTANT NOTE ON THIS WEEK: ' + doc.dataNote.trim()
            : 'No data-stream problems were flagged this week.',
          '',
          'SECTION: ' + spec.title,
          'SECTION BRIEF: ' + spec.guidance,
          '',
          material.join('\n'),
          '',
          'Write the paragraph for this section now. Prose only.',
        ].join('\n'),
      },
    ],
  };
}

export type NarrativeDraft = {
  sectionId: string;
  text: string;
  model: string;
  costUsd: number;
  latencyMs: number;
};

/**
 * Draft one section. Returns the prose only -- persistence is the caller's
 * decision, because a draft the author has not read yet is not the report.
 */
export async function draftNarrativeSection(
  orgId: string,
  sectionId: string,
  doc: ReportDocument,
  opts: { connectionId?: string } = {},
): Promise<NarrativeDraft> {
  const spec = NARRATIVE_SECTIONS.find((s) => s.id === sectionId);
  if (!spec) throw new Error('There is no report section called "' + sectionId + '".');

  const result = await complete(orgId, narrativePrompt(spec, doc), {
    feature: 'weekly-report-narrative',
    connectionId: opts.connectionId,
  });

  return {
    sectionId: spec.id,
    // Models reach for markdown even when told not to; strip the two it reaches for most.
    text: result.text.trim().replace(/^#{1,6}\s+/gm, '').replace(/\*\*/g, ''),
    model: result.model,
    costUsd: result.costUsd,
    latencyMs: result.latencyMs,
  };
}
