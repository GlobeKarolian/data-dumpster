import 'server-only';
import { complete } from '@/lib/ai/client';
import { diagnoseReport, type BugDiagnostics } from './diagnose';
import {
  BUG_AREAS, BUG_AREA_LABELS, BUG_SEVERITIES, bugRef, heuristicTriage, unsupportedNumbers,
  type BugArea, type BugSeverity,
} from './parse';
import {
  getBugReport, openReportsForDedupe, saveTriage, type BugReport, type BugTriage,
} from './store';

/**
 * Triage one report: compute facts, let the org's model route and phrase them,
 * verify, save, notify. Rules take over whenever the model is unavailable or
 * its answer fails verification, so every report ends up triaged.
 */

const SYSTEM = [
  'You triage bug reports for Data Dumpster, an internal social media analytics tool used by newsroom social editors.',
  'You receive the report and a FACT SHEET computed by code. Route the report and explain it plainly for the engineer who will fix it.',
  'Rules:',
  '- Use only facts in the FACT SHEET. Never invent counts, dates, accounts or causes.',
  '- Do not write any number, date or count that does not appear verbatim in the FACT SHEET.',
  '- When the fact sheet has a post verdict, your summary and likely cause must agree with it.',
  '- duplicateOfId must be the id of an OPEN REPORT describing the same problem, or null. Only mark a duplicate when you are confident.',
  '- Plain, short sentences. No filler.',
].join('\n');

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['area', 'severity', 'summary', 'likelyCause', 'nextStep', 'duplicateOfId'],
  properties: {
    area: { type: 'string', enum: [...BUG_AREAS] },
    severity: { type: 'string', enum: [...BUG_SEVERITIES] },
    summary: { type: 'string', description: 'One or two sentences: what is wrong, for the engineer.' },
    likelyCause: { type: ['string', 'null'], description: 'Most likely cause, supported by the fact sheet, or null.' },
    nextStep: { type: ['string', 'null'], description: 'The single next step to fix or confirm it.' },
    duplicateOfId: { type: ['string', 'null'] },
  },
};

interface ModelAnswer {
  area: BugArea;
  severity: BugSeverity;
  summary: string;
  likelyCause: string | null;
  nextStep: string | null;
  duplicateOfId: string | null;
}

function factSheet(report: BugReport, diagnostics: BugDiagnostics, open: Array<{ id: string; number: number; area: string | null; description: string }>): string {
  return JSON.stringify({
    report: {
      ref: bugRef(report.number),
      description: report.description,
      expected: report.expected,
      page: report.context.route ?? report.pageUrl,
      filters: report.context.filters ?? {},
      consoleErrors: (report.context.consoleErrors ?? []).slice(-5),
    },
    postChecks: diagnostics.posts.map((p) => ({
      url: p.url,
      platform: p.platformLabel,
      account: p.handle,
      postedOn: p.postedOn,
      verdict: p.verdict,
      verdictText: p.verdictText,
      trackedProfiles: p.channels,
    })),
    collectionHealth: diagnostics.health,
    openReports: open.map((o) => ({ id: o.id, ref: bugRef(o.number), area: o.area, description: o.description })),
  }, null, 2);
}

function validAnswer(raw: unknown, openIds: Set<string>): ModelAnswer | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const area = BUG_AREAS.find((a) => a === r.area);
  const severity = BUG_SEVERITIES.find((s) => s === r.severity);
  const summary = typeof r.summary === 'string' ? r.summary.trim() : '';
  if (!area || !severity || !summary) return null;
  const textOrNull = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const dup = textOrNull(r.duplicateOfId);
  return {
    area,
    severity,
    summary,
    likelyCause: textOrNull(r.likelyCause),
    nextStep: textOrNull(r.nextStep),
    duplicateOfId: dup && openIds.has(dup) ? dup : null,
  };
}

function rulesTriage(report: BugReport, diagnostics: BugDiagnostics, fallbackReason?: string): {
  area: BugArea; severity: BugSeverity; triage: BugTriage;
} {
  const text = report.description + '\n' + (report.expected ?? '');
  const { area, severity } = heuristicTriage(text, diagnostics.posts.length > 0);
  const firstProblem = diagnostics.posts.find((p) => p.verdict !== 'stored') ?? diagnostics.posts[0];
  const engineer = diagnostics.posts.some((p) => p.verdict === 'collection_silent' || p.verdict === 'skipped_in_gap');
  return {
    area,
    severity: engineer && severity === 'medium' ? 'high' : severity,
    triage: {
      method: 'rules',
      summary: firstProblem ? firstProblem.verdictText : BUG_AREA_LABELS[area] + ' report: ' + report.description.slice(0, 200),
      likelyCause: null,
      nextStep: null,
      ...(fallbackReason ? { fallbackReason } : {}),
    },
  };
}

export async function triageBugReport(orgId: string, id: string): Promise<BugReport | null> {
  const report = await getBugReport(orgId, id);
  if (!report) return null;

  const text = report.description + '\n' + (report.expected ?? '');
  const diagnostics = await diagnoseReport(text);
  const open = await openReportsForDedupe(orgId, id);
  const sheet = factSheet(report, diagnostics, open);

  let result: { area: BugArea; severity: BugSeverity; triage: BugTriage; duplicateOf: string | null };
  try {
    const res = await complete(orgId, {
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: 'FACT SHEET:\n' + sheet },
      ],
      jsonSchema: SCHEMA,
      maxTokens: 700,
      temperature: 0,
    }, { feature: 'bug-triage', maxAttempts: 2 });

    let parsed: unknown = res.json;
    if (parsed === undefined) {
      try {
        parsed = JSON.parse(res.text.replace(/```json|```/g, '').trim());
      } catch {
        parsed = undefined;
      }
    }
    const answer = validAnswer(parsed, new Set(open.map((o) => o.id)));
    if (!answer) throw new Error('The model answer did not match the triage schema.');

    const written = [answer.summary, answer.likelyCause ?? '', answer.nextStep ?? ''].join('\n');
    const unsupported = unsupportedNumbers(written, sheet);
    if (unsupported.length > 0) {
      throw new Error('The model wrote numbers not in the fact sheet: ' + unsupported.join(', '));
    }

    result = {
      area: answer.area,
      severity: answer.severity,
      duplicateOf: answer.duplicateOfId,
      triage: {
        method: 'model',
        summary: answer.summary,
        likelyCause: answer.likelyCause,
        nextStep: answer.nextStep,
        model: res.model,
      },
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    result = { ...rulesTriage(report, diagnostics, reason.slice(0, 300)), duplicateOf: null };
  }

  await saveTriage({ id, ...result, diagnostics });
  const saved = await getBugReport(orgId, id);
  if (saved) await notifySlack(saved).catch((e) => console.error('[pressbox:bugs] slack notify failed', e));
  return saved;
}

/** Same resolution as report delivery: explicit APP_URL, then Vercel's own. */
function appUrl(): string | null {
  const explicit = process.env.APP_URL?.trim() || process.env.AUTH_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  return vercel ? 'https://' + vercel.replace(/\/+$/, '') : null;
}

/** Post a triaged report to the bug channel. Silent when no webhook is configured. */
async function notifySlack(report: BugReport): Promise<void> {
  const webhook = process.env.BUG_REPORT_SLACK_WEBHOOK_URL?.trim();
  if (!webhook) return;
  const base = appUrl();
  const link = base ? base + '/settings/bugs?id=' + report.id : null;
  const severity = (report.severity ?? 'medium').toUpperCase();
  const lines = [
    '*' + bugRef(report.number) + '* · ' + severity + ' · ' + BUG_AREA_LABELS[report.area ?? 'other'],
    report.triage?.summary ?? report.description.slice(0, 300),
    report.duplicateOfNumber ? 'Possible duplicate of ' + bugRef(report.duplicateOfNumber) : null,
    report.triage?.nextStep ? 'Next: ' + report.triage.nextStep : null,
    '_Reported by ' + (report.reporterEmail ?? 'unknown') + (report.context.route ? ' on ' + report.context.route : '') + '_',
    link ? '<' + link + '|Open in Data Dumpster>' : null,
  ].filter(Boolean);
  const res = await fetch(webhook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: lines.join('\n') }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error('Slack webhook returned ' + res.status);
}
