import { randomUUID } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  orgs,
  reportDeliveries,
  reportSchedules,
  weeklyReports,
} from '@/db/schema';
import { computeWeeklyReport } from './compute';
import {
  deliverySucceeded,
  destinationAction,
  recoverDestinationStatus,
  reportSlackBindingError,
  type DestinationStatus,
} from './delivery-state';
import { renderReportHtml, renderReportMarkdown, type ReportDocument } from './render';
import {
  defaultReportTitle,
  emptyManualState,
  readComputed,
  readManual,
  readNarrative,
} from './types';
import { SEARCH_DASHBOARDS, type SearchTableId } from './search-console-sources';
import {
  renderReportCsv,
  renderReportPptx,
  reportExportFilename,
} from './export';
import {
  lastCompleteWeekInZone,
  scheduleWindow,
  type ReportExportFormat,
} from './schedule';
import { assertReportNarrativeVerified } from './narrative-verification';
import { isSearchConsoleConfigured, pullSearchConsoleTables } from './search-console';

export type ReportScheduleRow = typeof reportSchedules.$inferSelect;
type ReportDeliveryRow = typeof reportDeliveries.$inferSelect;

export type DestinationAudit = {
  status: DestinationStatus;
  error: string | null;
  attemptedAt: string | null;
  finishedAt: string | null;
  providerMessageId?: string | null;
};

export type ReportDeliveryResult = {
  deliveryId: string;
  reportId: string | null;
  status: 'succeeded' | 'failed' | 'skipped';
  /**
   * True only when a skipped response is backed by the stored state of the
   * same idempotent delivery claim and that claim already succeeded.
   */
  alreadySucceeded: boolean;
  scheduledFor: string;
  emailId: string | null;
  delivered: { email: boolean; slack: boolean };
  destinations: { email: DestinationAudit; slack: DestinationAudit };
  error?: string;
};

type Attachment = {
  filename: string;
  content: string;
};

type AttemptCertainty = 'rejected' | 'ambiguous';

class DestinationSendError extends Error {
  constructor(message: string, readonly certainty: AttemptCertainty) {
    super(message);
    this.name = 'DestinationSendError';
  }
}

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const direct = (err as { code?: unknown }).code;
  const cause = (err as { cause?: { code?: unknown } }).cause?.code;
  return direct === '23505' || cause === '23505';
}

function destinationStatus(value: string): DestinationStatus {
  switch (value) {
    case 'not_requested':
    case 'pending':
    case 'sending':
    case 'succeeded':
    case 'failed':
    case 'unknown':
      return value;
    default:
      return 'unknown';
  }
}

function errorMessage(err: unknown, fallback: string): string {
  return (err instanceof Error ? err.message : fallback).slice(0, 4_000);
}

function destinationError(err: unknown, fallback: string): {
  status: 'failed' | 'unknown';
  message: string;
} {
  const message = errorMessage(err, fallback);
  return {
    status: err instanceof DestinationSendError && err.certainty === 'rejected'
      ? 'failed'
      : 'unknown',
    message,
  };
}

function destinationAudits(row: ReportDeliveryRow): ReportDeliveryResult['destinations'] {
  return {
    email: {
      status: destinationStatus(row.emailStatus),
      error: row.emailError,
      attemptedAt: row.emailAttemptedAt?.toISOString() ?? null,
      finishedAt: row.emailFinishedAt?.toISOString() ?? null,
      providerMessageId: row.emailProviderMessageId,
    },
    slack: {
      status: destinationStatus(row.slackStatus),
      error: row.slackError,
      attemptedAt: row.slackAttemptedAt?.toISOString() ?? null,
      finishedAt: row.slackFinishedAt?.toISOString() ?? null,
    },
  };
}

function resultFromRow(
  row: ReportDeliveryRow,
  status: ReportDeliveryResult['status'],
): ReportDeliveryResult {
  const destinations = destinationAudits(row);
  return {
    deliveryId: row.id,
    reportId: row.reportId,
    status,
    alreadySucceeded: status === 'skipped' && row.status === 'succeeded',
    scheduledFor: row.scheduledFor,
    emailId: row.emailProviderMessageId,
    delivered: {
      email: destinations.email.status === 'succeeded',
      slack: destinations.slack.status === 'succeeded',
    },
    destinations,
    ...(row.error ? { error: row.error } : {}),
  };
}

function appBaseUrl(): string | null {
  const explicit = process.env.APP_URL ?? process.env.AUTH_URL;
  if (explicit) return explicit.replace(/\/+$/, '');
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  return vercel ? 'https://' + vercel.replace(/\/+$/, '') : null;
}

async function sendEmail(input: {
  deliveryId: string;
  recipients: string[];
  doc: ReportDocument;
  attachments: Attachment[];
}): Promise<string> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.REPORT_FROM_EMAIL;
  if (!apiKey || !from) {
    throw new DestinationSendError(
      'Email delivery is not configured. Set RESEND_API_KEY and REPORT_FROM_EMAIL.',
      'rejected',
    );
  }

  let response: Response;
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + apiKey,
        'content-type': 'application/json',
        'idempotency-key': 'data-dumpster-report-' + input.deliveryId,
      },
      body: JSON.stringify({
        from,
        to: input.recipients,
        subject: input.doc.title,
        html: renderReportHtml(input.doc),
        text: renderReportMarkdown(input.doc),
        attachments: input.attachments,
        tags: [{ name: 'feature', value: 'scheduled_report' }],
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new DestinationSendError(
      'Email request ended without a definitive provider response: '
        + errorMessage(err, 'network error'),
      'ambiguous',
    );
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = typeof payload === 'object' && payload !== null && 'message' in payload
      ? String((payload as { message: unknown }).message)
      : 'HTTP ' + response.status;
    throw new DestinationSendError(
      'Email provider rejected the report: ' + detail,
      'rejected',
    );
  }
  if (typeof payload !== 'object' || payload === null || !('id' in payload)) {
    throw new DestinationSendError(
      'Email provider may have accepted the request but did not return a message id.',
      'ambiguous',
    );
  }
  return String((payload as { id: unknown }).id);
}

function reportSlackWebhook(orgId: string): string {
  const webhook = process.env.SLACK_WEBHOOK_URL;
  const boundOrgId = process.env.REPORT_SLACK_ORG_ID?.trim();
  const bindingError = reportSlackBindingError({ orgId, webhook, boundOrgId });
  if (bindingError || !webhook) {
    throw new DestinationSendError(
      bindingError ?? 'Slack report delivery is not configured.',
      'rejected',
    );
  }
  return webhook;
}

async function sendSlack(input: {
  orgId: string;
  reportId: string;
  doc: ReportDocument;
  formats: ReportExportFormat[];
}): Promise<void> {
  const webhook = reportSlackWebhook(input.orgId);
  const baseUrl = appBaseUrl();
  if (!baseUrl) {
    throw new DestinationSendError(
      'Slack delivery needs APP_URL so the export links have a stable address.',
      'rejected',
    );
  }

  const links = input.formats.map((format) => (
    '<' + baseUrl + '/api/reports/' + input.reportId + '/export?format=' + format
    + '|Download ' + format.toUpperCase() + '>'
  )).join(' · ');
  const summary = renderReportMarkdown(input.doc)
    .replace(/\n{3,}/g, '\n\n')
    .slice(0, 2_400);

  let response: Response;
  try {
    response = await fetch(webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: input.doc.title + '\n' + links,
        unfurl_links: false,
        blocks: [
          {
            type: 'header',
            text: { type: 'plain_text', text: input.doc.title.slice(0, 150) },
          },
          {
            type: 'section',
            text: { type: 'mrkdwn', text: summary },
          },
          {
            type: 'section',
            text: { type: 'mrkdwn', text: links },
          },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new DestinationSendError(
      'Slack request ended without a definitive response: '
        + errorMessage(err, 'network error'),
      'ambiguous',
    );
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 500);
    throw new DestinationSendError(
      'Slack rejected the report: HTTP ' + response.status
        + (detail ? ' (' + detail + ')' : ''),
      'rejected',
    );
  }
}

/**
 * Load the immutable report snapshot for the target week. Existing rows are
 * never silently recomputed because their narrative belongs to that snapshot.
 */
async function reportDocument(
  schedule: ReportScheduleRow,
  claim: ReportDeliveryRow,
): Promise<{ reportId: string; doc: ReportDocument }> {
  let row: typeof weeklyReports.$inferSelect | undefined;
  if (claim.reportId) {
    [row] = await db
      .select()
      .from(weeklyReports)
      .where(and(
        eq(weeklyReports.id, claim.reportId),
        eq(weeklyReports.orgId, claim.orgId),
      ))
      .limit(1);
    if (!row) {
      throw new Error(
        'The report frozen to this delivery no longer exists. '
          + 'A retry will not substitute a different week.',
      );
    }
  } else {
    if (
      !claim.landscapeIdSnapshot
      || !claim.reportPeriodStart
      || !claim.reportPeriodEnd
    ) {
      throw new Error(
        'This delivery has no frozen report period. Refusing to choose a new week on retry.',
      );
    }
    [row] = await db
      .select()
      .from(weeklyReports)
      .where(and(
        eq(weeklyReports.orgId, claim.orgId),
        eq(weeklyReports.landscapeId, claim.landscapeIdSnapshot),
        eq(weeklyReports.periodStart, claim.reportPeriodStart),
        eq(weeklyReports.periodEnd, claim.reportPeriodEnd),
      ))
      .limit(1);
  }

  if (!row) {
    if (
      !claim.landscapeIdSnapshot
      || !claim.reportPeriodStart
      || !claim.reportPeriodEnd
    ) {
      throw new Error('The frozen report snapshot is incomplete.');
    }
    const period = {
      start: claim.reportPeriodStart,
      end: claim.reportPeriodEnd,
    };
    const computed = await computeWeeklyReport(
      claim.orgId,
      claim.landscapeIdSnapshot,
      period.start,
      period.end,
    );
    try {
      [row] = await db
        .insert(weeklyReports)
        .values({
          orgId: claim.orgId,
          landscapeId: claim.landscapeIdSnapshot,
          periodStart: period.start,
          periodEnd: period.end,
          title: defaultReportTitle(period),
          computed,
          manual: emptyManualState(),
          narrative: {},
          status: 'draft',
          createdBy: schedule.createdBy,
        })
        .returning();
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      [row] = await db
        .select()
        .from(weeklyReports)
        .where(and(
          eq(weeklyReports.orgId, claim.orgId),
          eq(weeklyReports.landscapeId, claim.landscapeIdSnapshot),
          eq(weeklyReports.periodStart, period.start),
          eq(weeklyReports.periodEnd, period.end),
        ))
        .limit(1);
    }
  }

  if (!row) throw new Error('The scheduled report could not be created or loaded.');
  const [org] = await db
    .select({ name: orgs.name })
    .from(orgs)
    .where(eq(orgs.id, claim.orgId))
    .limit(1);
  if (!org) throw new Error('The schedule belongs to an organization that no longer exists.');

  let manual = readManual(row.manual);
  const narrative = readNarrative(row.narrative);
  if (isSearchConsoleConfigured()) {
    const searchTables = await pullSearchConsoleTables({
      start: row.periodStart,
      end: row.periodEnd,
    });
    for (const id of Object.keys(searchTables) as SearchTableId[]) {
      searchTables[id] = {
        ...searchTables[id],
        sourceUrl: manual.tables[id]?.sourceUrl ?? SEARCH_DASHBOARDS[id].url,
      };
    }
    manual = { ...manual, tables: { ...manual.tables, ...searchTables } };
    delete narrative.search;
    const [updated] = await db
      .update(weeklyReports)
      .set({ manual, narrative, updatedAt: new Date() })
      .where(and(eq(weeklyReports.id, row.id), eq(weeklyReports.orgId, claim.orgId)))
      .returning();
    if (!updated) throw new Error('The Search Console tables could not be saved to the report.');
    row = updated;
  }

  const doc: ReportDocument = {
    title: row.title,
    orgName: org.name,
    period: { start: row.periodStart, end: row.periodEnd },
    dataNote: row.dataNote,
    computed: readComputed(row.computed),
    manual,
    narrative,
  };
  return { reportId: row.id, doc };
}

function staleRecoveryError(destination: 'email' | 'Slack'): string {
  return destination + ' may have been accepted before the worker stopped. '
    + 'Automatic retry is blocked to prevent a duplicate; review the destination manually.';
}

async function claimDelivery(
  schedule: ReportScheduleRow,
  scheduledFor: string,
  now: Date,
): Promise<{ row: ReportDeliveryRow } | { terminal: ReportDeliveryResult }> {
  const reportPeriod = lastCompleteWeekInZone(now, schedule.timeZone);
  try {
    const [created] = await db
      .insert(reportDeliveries)
      .values({
        claimToken: randomUUID(),
        scheduleId: schedule.id,
        orgId: schedule.orgId,
        landscapeIdSnapshot: schedule.landscapeId,
        reportPeriodStart: reportPeriod.start,
        reportPeriodEnd: reportPeriod.end,
        scheduledFor,
        formats: schedule.formats,
        recipients: schedule.recipients,
        includeSlack: schedule.includeSlack,
        status: 'running',
        emailStatus: schedule.recipients.length > 0 ? 'pending' : 'not_requested',
        slackStatus: schedule.includeSlack ? 'pending' : 'not_requested',
        startedAt: now,
      })
      .returning();
    if (!created) throw new Error('The delivery could not be recorded.');
    return { row: created };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
  }

  const [existing] = await db
    .select()
    .from(reportDeliveries)
    .where(and(
      eq(reportDeliveries.scheduleId, schedule.id),
      eq(reportDeliveries.scheduledFor, scheduledFor),
    ))
    .limit(1);
  if (!existing) throw new Error('The existing delivery claim could not be loaded.');

  const runningIsFresh = existing.status === 'running'
    && now.getTime() - existing.startedAt.getTime() < 30 * 60 * 1_000;
  if (existing.status === 'succeeded' || runningIsFresh) {
    return { terminal: resultFromRow(existing, 'skipped') };
  }
  if (existing.status !== 'failed' && existing.status !== 'running') {
    return { terminal: resultFromRow(existing, 'skipped') };
  }

  const previousEmail = destinationStatus(existing.emailStatus);
  const previousSlack = destinationStatus(existing.slackStatus);
  const emailStatus = recoverDestinationStatus(previousEmail);
  const slackStatus = recoverDestinationStatus(previousSlack);
  const claimToken = randomUUID();
  const [recovered] = await db
    .update(reportDeliveries)
    .set({
      claimToken,
      status: 'running',
      attemptCount: sql`${reportDeliveries.attemptCount} + 1`,
      error: null,
      startedAt: now,
      finishedAt: null,
      emailStatus,
      ...(previousEmail === 'sending'
        ? {
            emailError: staleRecoveryError('email'),
            emailFinishedAt: now,
          }
        : {}),
      slackStatus,
      ...(previousSlack === 'sending'
        ? {
            slackError: staleRecoveryError('Slack'),
            slackFinishedAt: now,
          }
        : {}),
    })
    .where(and(
      eq(reportDeliveries.id, existing.id),
      eq(reportDeliveries.claimToken, existing.claimToken),
      eq(reportDeliveries.status, existing.status),
    ))
    .returning();

  if (recovered) return { row: recovered };

  const [winner] = await db
    .select()
    .from(reportDeliveries)
    .where(eq(reportDeliveries.id, existing.id))
    .limit(1);
  if (!winner) throw new Error('The delivery claim disappeared during recovery.');
  return { terminal: resultFromRow(winner, 'skipped') };
}

async function attachReportToClaim(
  claim: ReportDeliveryRow,
  reportId: string,
): Promise<boolean> {
  const [owned] = await db
    .update(reportDeliveries)
    .set({ reportId })
    .where(and(
      eq(reportDeliveries.id, claim.id),
      eq(reportDeliveries.claimToken, claim.claimToken),
      eq(reportDeliveries.status, 'running'),
      isNull(reportDeliveries.reportId),
    ))
    .returning({ id: reportDeliveries.id });
  return Boolean(owned);
}

async function attemptEmail(input: {
  claim: ReportDeliveryRow;
  doc: ReportDocument;
  attachments: Attachment[];
}): Promise<DestinationAudit> {
  const current = destinationStatus(input.claim.emailStatus);
  const action = destinationAction(current);
  if (action !== 'send') return destinationAudits(input.claim).email;

  const attemptedAt = new Date();
  const [started] = await db
    .update(reportDeliveries)
    .set({
      emailStatus: 'sending',
      emailError: null,
      emailAttemptedAt: attemptedAt,
      emailFinishedAt: null,
    })
    .where(and(
      eq(reportDeliveries.id, input.claim.id),
      eq(reportDeliveries.claimToken, input.claim.claimToken),
      eq(reportDeliveries.status, 'running'),
      eq(reportDeliveries.emailStatus, current),
    ))
    .returning({ id: reportDeliveries.id });
  if (!started) {
    return {
      status: 'unknown',
      error: 'Email was not attempted because this worker no longer owns the delivery claim.',
      attemptedAt: null,
      finishedAt: null,
      providerMessageId: null,
    };
  }

  try {
    const providerMessageId = await sendEmail({
      deliveryId: input.claim.id,
      recipients: input.claim.recipients,
      doc: input.doc,
      attachments: input.attachments,
    });
    const finishedAt = new Date();
    const [saved] = await db
      .update(reportDeliveries)
      .set({
        emailStatus: 'succeeded',
        emailProviderMessageId: providerMessageId,
        emailError: null,
        emailFinishedAt: finishedAt,
      })
      .where(and(
        eq(reportDeliveries.id, input.claim.id),
        eq(reportDeliveries.claimToken, input.claim.claimToken),
        eq(reportDeliveries.emailStatus, 'sending'),
      ))
      .returning({ id: reportDeliveries.id });
    if (!saved) {
      return {
        status: 'unknown',
        error: staleRecoveryError('email'),
        attemptedAt: attemptedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        providerMessageId: null,
      };
    }
    return {
      status: 'succeeded',
      error: null,
      attemptedAt: attemptedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      providerMessageId,
    };
  } catch (err) {
    const outcome = destinationError(err, 'Email delivery failed.');
    const finishedAt = new Date();
    await db
      .update(reportDeliveries)
      .set({
        emailStatus: outcome.status,
        emailError: outcome.message,
        emailFinishedAt: finishedAt,
      })
      .where(and(
        eq(reportDeliveries.id, input.claim.id),
        eq(reportDeliveries.claimToken, input.claim.claimToken),
        eq(reportDeliveries.emailStatus, 'sending'),
      ));
    return {
      status: outcome.status,
      error: outcome.message,
      attemptedAt: attemptedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      providerMessageId: null,
    };
  }
}

async function attemptSlack(input: {
  claim: ReportDeliveryRow;
  reportId: string;
  doc: ReportDocument;
}): Promise<DestinationAudit> {
  const current = destinationStatus(input.claim.slackStatus);
  const action = destinationAction(current);
  if (action !== 'send') return destinationAudits(input.claim).slack;

  const attemptedAt = new Date();
  const [started] = await db
    .update(reportDeliveries)
    .set({
      slackStatus: 'sending',
      slackError: null,
      slackAttemptedAt: attemptedAt,
      slackFinishedAt: null,
    })
    .where(and(
      eq(reportDeliveries.id, input.claim.id),
      eq(reportDeliveries.claimToken, input.claim.claimToken),
      eq(reportDeliveries.status, 'running'),
      eq(reportDeliveries.slackStatus, current),
    ))
    .returning({ id: reportDeliveries.id });
  if (!started) {
    return {
      status: 'unknown',
      error: 'Slack was not attempted because this worker no longer owns the delivery claim.',
      attemptedAt: null,
      finishedAt: null,
    };
  }

  try {
    await sendSlack({
      orgId: input.claim.orgId,
      reportId: input.reportId,
      doc: input.doc,
      formats: input.claim.formats,
    });
    const finishedAt = new Date();
    const [saved] = await db
      .update(reportDeliveries)
      .set({
        slackStatus: 'succeeded',
        slackError: null,
        slackFinishedAt: finishedAt,
      })
      .where(and(
        eq(reportDeliveries.id, input.claim.id),
        eq(reportDeliveries.claimToken, input.claim.claimToken),
        eq(reportDeliveries.slackStatus, 'sending'),
      ))
      .returning({ id: reportDeliveries.id });
    if (!saved) {
      return {
        status: 'unknown',
        error: staleRecoveryError('Slack'),
        attemptedAt: attemptedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
      };
    }
    return {
      status: 'succeeded',
      error: null,
      attemptedAt: attemptedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
    };
  } catch (err) {
    const outcome = destinationError(err, 'Slack delivery failed.');
    const finishedAt = new Date();
    await db
      .update(reportDeliveries)
      .set({
        slackStatus: outcome.status,
        slackError: outcome.message,
        slackFinishedAt: finishedAt,
      })
      .where(and(
        eq(reportDeliveries.id, input.claim.id),
        eq(reportDeliveries.claimToken, input.claim.claimToken),
        eq(reportDeliveries.slackStatus, 'sending'),
      ));
    return {
      status: outcome.status,
      error: outcome.message,
      attemptedAt: attemptedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
    };
  }
}

function combinedDeliveryError(input: {
  email: DestinationAudit;
  slack: DestinationAudit;
}): string {
  const failures = [
    input.email.status === 'failed' || input.email.status === 'unknown'
      ? 'Email: ' + (input.email.error ?? input.email.status)
      : null,
    input.slack.status === 'failed' || input.slack.status === 'unknown'
      ? 'Slack: ' + (input.slack.error ?? input.slack.status)
      : null,
  ].filter((message): message is string => Boolean(message));
  return failures.join(' ');
}

async function finishDelivery(input: {
  claim: ReportDeliveryRow;
  reportId: string | null;
  destinations: ReportDeliveryResult['destinations'];
  isManual: boolean;
}): Promise<ReportDeliveryResult> {
  const succeeded = deliverySucceeded(
    input.destinations.email.status,
    input.destinations.slack.status,
  );
  const status = succeeded ? 'succeeded' : 'failed';
  const error = succeeded ? null : combinedDeliveryError(input.destinations);
  const finishedAt = new Date();
  const [finished] = await db
    .update(reportDeliveries)
    .set({
      reportId: input.reportId,
      status,
      error: error?.slice(0, 4_000) ?? null,
      finishedAt,
    })
    .where(and(
      eq(reportDeliveries.id, input.claim.id),
      eq(reportDeliveries.claimToken, input.claim.claimToken),
      eq(reportDeliveries.status, 'running'),
    ))
    .returning();

  if (!finished) {
    const [current] = await db
      .select()
      .from(reportDeliveries)
      .where(eq(reportDeliveries.id, input.claim.id))
      .limit(1);
    if (!current) throw new Error('The delivery audit disappeared before it could finish.');
    return resultFromRow(current, 'skipped');
  }

  if (succeeded) {
    await db
      .update(reportSchedules)
      .set({
        ...(!input.isManual ? { lastRunAt: finishedAt } : {}),
        lastSuccessAt: finishedAt,
        lastError: null,
        updatedAt: finishedAt,
      })
      .where(and(
        eq(reportSchedules.id, input.claim.scheduleId ?? ''),
        eq(reportSchedules.orgId, input.claim.orgId),
      ));
  } else {
    await db
      .update(reportSchedules)
      .set({
        lastError: error?.slice(0, 4_000) ?? 'Scheduled report delivery failed.',
        updatedAt: finishedAt,
      })
      .where(and(
        eq(reportSchedules.id, input.claim.scheduleId ?? ''),
        eq(reportSchedules.orgId, input.claim.orgId),
      ));
  }

  return resultFromRow(finished, status);
}

/**
 * Generate, attach and deliver a schedule exactly once for a scheduled window.
 * Manual callers must supply a stable key so an HTTP retry reaches the same
 * delivery claim instead of creating a second send.
 */
export async function runReportSchedule(
  schedule: ReportScheduleRow,
  options: { now?: Date; scheduledFor?: string } = {},
): Promise<ReportDeliveryResult> {
  const now = options.now ?? new Date();
  const scheduledFor = options.scheduledFor ?? scheduleWindow(schedule, now).key;
  const isManual = scheduledFor.startsWith('manual:');
  const claimed = await claimDelivery(schedule, scheduledFor, now);
  if ('terminal' in claimed) return claimed.terminal;
  const claim = claimed.row;

  await db
    .update(reportSchedules)
    .set({ lastError: null, updatedAt: now })
    .where(and(
      eq(reportSchedules.id, schedule.id),
      eq(reportSchedules.orgId, schedule.orgId),
    ));

  let reportId: string | null = claim.reportId;
  try {
    const prepared = await reportDocument(schedule, claim);
    reportId = prepared.reportId;
    if (claim.reportId && claim.reportId !== reportId) {
      throw new Error('The report frozen to this delivery changed unexpectedly.');
    }
    if (!claim.reportId && !await attachReportToClaim(claim, reportId)) {
      const [current] = await db
        .select()
        .from(reportDeliveries)
        .where(eq(reportDeliveries.id, claim.id))
        .limit(1);
      if (!current) throw new Error('The delivery claim disappeared while building the report.');
      return resultFromRow(current, 'skipped');
    }
    assertReportNarrativeVerified(prepared.doc);

    let attachments: Attachment[] = [];
    if (destinationAction(destinationStatus(claim.emailStatus)) === 'send') {
      attachments = await Promise.all(claim.formats.map(async (format) => {
        if (format === 'csv') {
          return {
            filename: reportExportFilename(prepared.doc, format),
            content: Buffer.from(renderReportCsv(prepared.doc), 'utf8').toString('base64'),
          };
        }
        const pptx = await renderReportPptx(prepared.doc);
        return {
          filename: reportExportFilename(prepared.doc, format),
          content: pptx.toString('base64'),
        };
      }));
    }

    const email = await attemptEmail({ claim, doc: prepared.doc, attachments });
    const slack = await attemptSlack({
      claim,
      reportId: prepared.reportId,
      doc: prepared.doc,
    });
    return await finishDelivery({
      claim,
      reportId,
      destinations: { email, slack },
      isManual,
    });
  } catch (err) {
    const message = errorMessage(err, 'Scheduled report delivery failed.');
    const currentDestinations = destinationAudits(claim);
    const result = await finishDelivery({
      claim,
      reportId,
      destinations: currentDestinations,
      isManual,
    });
    if (result.status === 'failed' && !result.error) {
      result.error = message;
    }
    await db
      .update(reportDeliveries)
      .set({ error: message, finishedAt: new Date() })
      .where(and(
        eq(reportDeliveries.id, claim.id),
        eq(reportDeliveries.claimToken, claim.claimToken),
        eq(reportDeliveries.status, 'failed'),
      ));
    await db
      .update(reportSchedules)
      .set({ lastError: message, updatedAt: new Date() })
      .where(and(
        eq(reportSchedules.id, schedule.id),
        eq(reportSchedules.orgId, schedule.orgId),
      ));
    return { ...result, error: message };
  }
}
