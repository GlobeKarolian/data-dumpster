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
import type { NumericGroundingVerification } from '@/lib/ai/verify';
import type { CompletionRequest } from '@/lib/ai/types';
import {
  NARRATIVE_SECTIONS,
  periodLabel,
  type NarrativeSectionSpec,
} from './types';
import type { ReportDocument } from './render';
import {
  buildNarrativeSectionMaterial,
  ReportNarrativeVerificationError,
  verifyNarrativeSection,
} from './narrative-verification';

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

/** Build the completion request for one section. Exported so it is inspectable. */
export function narrativePrompt(
  spec: NarrativeSectionSpec,
  doc: ReportDocument,
  material = buildNarrativeSectionMaterial(spec, doc),
): CompletionRequest {
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
          material,
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
  verification: NumericGroundingVerification;
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

  const material = buildNarrativeSectionMaterial(spec, doc);
  const result = await complete(orgId, narrativePrompt(spec, doc, material), {
    feature: 'weekly-report-narrative',
    connectionId: opts.connectionId,
  });
  // Models reach for markdown even when told not to; strip the two it reaches for most.
  const text = result.text.trim().replace(/^#{1,6}\s+/gm, '').replace(/\*\*/g, '');
  const verification = verifyNarrativeSection(spec.id, text, doc, material);
  if (!verification.ok) {
    throw new ReportNarrativeVerificationError({
      ok: false,
      sections: { [spec.id]: verification },
      invalidSectionIds: [spec.id],
    });
  }

  return {
    sectionId: spec.id,
    text,
    verification,
    model: result.model,
    costUsd: result.costUsd,
    latencyMs: result.latencyMs,
  };
}
