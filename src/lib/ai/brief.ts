/**
 * Weekly brief generation, end to end.
 *
 * The order of operations is the product:
 *   1. Compute the fact sheet in SQL. Numbers come from the database, always.
 *   2. Hand the model the fact sheet and ask for prose. It narrates; it never
 *      calculates.
 *   3. Verify the prose against the fact sheet, deterministically.
 *   4. If verification failed, show the model exactly which claims failed and
 *      let it correct itself once. One repair pass, not a loop: a model that
 *      cannot ground its claims on the second attempt is not going to on the
 *      fifth, and each attempt costs the org money.
 *   5. Persist the markdown, the fact sheet it came from, and the verification
 *      verdict together. A brief without its fact sheet is an assertion; with
 *      it, it is a document someone can audit a year later.
 */
import { db } from '@/db';
import { briefs } from '@/db/schema';
import { getFactSheet } from '@/lib/metrics/queries';
import type { FactSheet } from '@/lib/metrics/contract';
import type { DateRange, Platform } from '@/lib/types';
import { complete } from './client';
import { weeklyBriefPrompt } from './prompts';
import { summarizeVerification, verifyBrief, type BriefVerification } from './verify';
import type { ModelMessage } from './types';

export interface GenerateBriefOptions {
  connectionId?: string;
  /** User to attribute the brief to, for the audit trail. */
  createdBy?: string;
  platforms?: Platform[];
  companyIds?: string[];
  /** Set false to preview a brief without writing it to the database. */
  persist?: boolean;
  /** One self-correction pass by default; 0 disables repair. */
  repairAttempts?: number;
}

export interface GeneratedBrief {
  id: string | null;
  title: string;
  body: string;
  facts: FactSheet;
  verification: BriefVerification;
  modelUsed: string;
  costUsd: number;
  latencyMs: number;
  periodStart: string;
  periodEnd: string;
}

/** ISO date (no time) — the briefs table stores period bounds as dates. */
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Models occasionally wrap markdown in a fence despite being told not to. */
function unfence(text: string): string {
  const fenced = text.trim().match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/);
  return (fenced ? fenced[1] : text).trim();
}

function deriveTitle(body: string, facts: FactSheet): string {
  const h1 = body.match(/^#\s+(.+)$/m);
  if (h1) return h1[1].replace(/\[facts[^\]]*\]/g, '').trim().slice(0, 200);
  const who = facts.landscape.focusCompany ?? facts.landscape.name;
  return who + ': ' + facts.range.start + ' to ' + facts.range.end;
}

/**
 * The repair turn. It is deliberately specific — listing the exact strings that
 * failed and the paths that were available — because "your numbers were wrong,
 * try again" reliably produces a differently wrong document.
 */
function repairMessage(v: BriefVerification): string {
  const lines = [
    'Your draft failed automated verification against the fact sheet. Every problem below is',
    'mechanical, not a matter of taste. Rewrite the brief, keeping everything that was correct.',
    '',
  ];
  if (v.unverified.length) {
    lines.push('NUMBERS NOT IN THE FACT SHEET (remove them, or replace them with a figure that is):');
    lines.push(...v.unverified.map((u) => '- ' + u));
    lines.push('');
  }
  if (v.miscited.length) {
    lines.push('WRONG CITATIONS (the figure is real but the path does not match):');
    lines.push(...v.miscited.map((m) => '- ' + m));
    lines.push('');
  }
  if (v.violations.length) {
    lines.push('RULE VIOLATIONS:');
    lines.push(...v.violations.map((x) => '- ' + x));
    lines.push('');
  }
  lines.push('Return the complete corrected brief in the same format. Do not explain the changes.');
  return lines.join('\n');
}

/** Prefer the draft that grounds more of its claims; ties go to the earlier one. */
function score(v: BriefVerification): number {
  return (v.ok ? 1000 : 0)
    - v.unverified.length * 10
    - v.violations.length * 5
    - v.miscited.length * 2;
}

export async function generateBrief(
  orgId: string,
  landscapeId: string,
  range: DateRange,
  opts: GenerateBriefOptions = {},
): Promise<GeneratedBrief> {
  const facts = await getFactSheet({
    // The org guard is passed explicitly. Every caller of generateBrief happens
    // to verify the landscape first, so omitting it was not exploitable today --
    // but resolveScope's landscape lookup is unfiltered when orgId is absent,
    // and this was the only call site in the app that left it off. The guard
    // belongs at the query, not in a convention the next caller has to know.
    orgId,
    landscapeId,
    start: range.start,
    end: range.end,
    platforms: opts.platforms,
    companyIds: opts.companyIds,
    compare: true,
  });

  const request = weeklyBriefPrompt(facts);
  const first = await complete(orgId, request, {
    connectionId: opts.connectionId,
    feature: 'weekly_brief',
  });

  let body = unfence(first.text);
  let verification = verifyBrief(body, facts);
  let modelUsed = first.model;
  let costUsd = first.costUsd;
  let latencyMs = first.latencyMs;
  let repaired = false;

  const repairs = opts.repairAttempts ?? 1;
  if (!verification.ok && repairs > 0) {
    const conversation: ModelMessage[] = [
      ...request.messages,
      { role: 'assistant', content: body },
      { role: 'user', content: repairMessage(verification) },
    ];
    try {
      const second = await complete(orgId, { ...request, messages: conversation }, {
        connectionId: opts.connectionId,
        feature: 'weekly_brief_repair',
        connection: first.connection,
      });
      const repairedBody = unfence(second.text);
      const repairedVerification = verifyBrief(repairedBody, facts);
      costUsd += second.costUsd;
      latencyMs += second.latencyMs;
      if (score(repairedVerification) > score(verification)) {
        body = repairedBody;
        verification = repairedVerification;
        modelUsed = second.model;
        repaired = true;
      }
    } catch (cause) {
      // A failed repair must not lose the first draft; it is still usable and
      // its verification block tells the reader exactly what to double-check.
      console.error('[ai] brief repair pass failed', cause);
    }
  }

  const title = deriveTitle(body, facts);
  const periodStart = isoDate(range.start);
  const periodEnd = isoDate(range.end);

  /**
   * Everything needed to re-audit this brief lives in one jsonb column: the
   * exact fact sheet the model saw, the verdict, and how it was produced.
   */
  const factsColumn: Record<string, unknown> = {
    factSheet: facts,
    verification,
    generation: {
      model: modelUsed,
      connectionLabel: first.connection.label,
      provider: first.connection.provider,
      costUsd,
      latencyMs,
      attempts: first.attempts,
      repaired,
      generatedAt: new Date().toISOString(),
      summary: summarizeVerification(verification),
    },
  };

  let id: string | null = null;
  if (opts.persist !== false) {
    const [row] = await db.insert(briefs).values({
      orgId,
      landscapeId,
      periodStart,
      periodEnd,
      title,
      body,
      facts: factsColumn,
      modelUsed,
      createdBy: opts.createdBy ?? null,
    }).returning({ id: briefs.id });
    id = row?.id ?? null;
  }

  return {
    id,
    title,
    body,
    facts,
    verification,
    modelUsed,
    costUsd,
    latencyMs,
    periodStart,
    periodEnd,
  };
}
