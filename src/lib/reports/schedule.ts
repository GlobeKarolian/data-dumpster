import { z } from 'zod';
import type { Period } from './types';

export const REPORT_EXPORT_FORMATS = ['pptx', 'csv'] as const;
export type ReportExportFormat = (typeof REPORT_EXPORT_FORMATS)[number];

export const reportRunIdempotencyKeySchema = z.string()
  .trim()
  .min(8)
  .max(200)
  .regex(/^[A-Za-z0-9._:-]+$/, 'Idempotency-Key contains unsupported characters.');

export type WeeklyScheduleClock = {
  dayOfWeek: number;
  hour: number;
  timeZone: string;
};

export type DueSchedule = WeeklyScheduleClock & {
  enabled: boolean;
  lastRunAt: Date | null;
  /** Creation time prevents a new schedule from backfilling a tick it never owned. */
  createdAt?: Date;
};

const timeZoneSchema = z.string().trim().min(1).max(100).refine((value) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}, 'Choose a valid IANA time zone, such as America/New_York.');

const deliveryFields = {
  name: z.string().trim().min(1).max(120),
  recipients: z.array(z.email().max(320)).max(50).transform((items) => (
    Array.from(new Set(items.map((item) => item.trim().toLowerCase())))
  )),
  formats: z.array(z.enum(REPORT_EXPORT_FORMATS)).min(1).max(REPORT_EXPORT_FORMATS.length)
    .transform((items) => Array.from(new Set(items))),
  includeSlack: z.boolean(),
  dayOfWeek: z.number().int().min(1).max(7),
  hour: z.number().int().min(0).max(23),
  timeZone: timeZoneSchema,
  enabled: z.boolean(),
};

function hasDestination(value: { recipients?: string[]; includeSlack?: boolean }): boolean {
  return Boolean(value.includeSlack) || Boolean(value.recipients?.length);
}

export const createReportScheduleSchema = z.object({
  landscapeId: z.uuid(),
  name: deliveryFields.name,
  recipients: deliveryFields.recipients.default([]),
  formats: deliveryFields.formats.default(['pptx', 'csv']),
  includeSlack: deliveryFields.includeSlack.default(false),
  dayOfWeek: deliveryFields.dayOfWeek.default(1),
  hour: deliveryFields.hour.default(8),
  timeZone: deliveryFields.timeZone.default('America/New_York'),
  enabled: deliveryFields.enabled.default(true),
}).refine(hasDestination, {
  message: 'Add at least one email recipient or enable Slack delivery.',
  path: ['recipients'],
});

export const updateReportScheduleSchema = z.object({
  landscapeId: z.uuid().optional(),
  name: deliveryFields.name.optional(),
  recipients: deliveryFields.recipients.optional(),
  formats: deliveryFields.formats.optional(),
  includeSlack: deliveryFields.includeSlack.optional(),
  dayOfWeek: deliveryFields.dayOfWeek.optional(),
  hour: deliveryFields.hour.optional(),
  timeZone: deliveryFields.timeZone.optional(),
  enabled: deliveryFields.enabled.optional(),
}).refine((value) => Object.keys(value).length > 0, 'Nothing to update.');

type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  isoDay: number;
};

function localParts(now: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => (
    parts.find((part) => part.type === type)?.value ?? ''
  );
  const weekday = value('weekday');
  const isoDay = ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 })[weekday];
  if (!isoDay) throw new Error('Could not resolve the local weekday for ' + timeZone + '.');
  return {
    year: Number(value('year')),
    month: Number(value('month')),
    day: Number(value('day')),
    hour: Number(value('hour')),
    isoDay,
  };
}

function dateKeyFromUtcSurrogate(value: Date): string {
  return [
    value.getUTCFullYear(),
    String(value.getUTCMonth() + 1).padStart(2, '0'),
    String(value.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

/**
 * The most recent local scheduled clock tick.
 *
 * The Date is a UTC surrogate for a local calendar date, not an instant. That
 * avoids guessing a UTC offset around daylight-saving transitions. The key is
 * what is persisted in the delivery audit and is stable across those changes.
 */
export function scheduleWindow(
  schedule: WeeklyScheduleClock,
  now = new Date(),
): { key: string; localDate: string } {
  const local = localParts(now, schedule.timeZone);
  let daysBack = (local.isoDay - schedule.dayOfWeek + 7) % 7;
  if (daysBack === 0 && local.hour < schedule.hour) daysBack = 7;

  const target = new Date(Date.UTC(local.year, local.month - 1, local.day));
  target.setUTCDate(target.getUTCDate() - daysBack);
  const localDate = dateKeyFromUtcSurrogate(target);
  return {
    localDate,
    key: localDate + 'T' + String(schedule.hour).padStart(2, '0') + ':00['
      + schedule.timeZone + ']',
  };
}

export function isScheduleDue(schedule: DueSchedule, now = new Date()): boolean {
  if (!schedule.enabled) return false;
  const current = scheduleWindow(schedule, now).key;
  const reference = schedule.lastRunAt ?? schedule.createdAt;
  if (!reference) return true;
  return scheduleWindow(schedule, reference).key !== current;
}

/**
 * Last complete Monday-to-Sunday report window in the schedule's local zone.
 * This stays correct when the Vercel runtime itself is on UTC.
 */
export function lastCompleteWeekInZone(now: Date, timeZone: string): Period {
  const local = localParts(now, timeZone);
  const localToday = new Date(Date.UTC(local.year, local.month - 1, local.day));
  const thisMonday = new Date(localToday);
  thisMonday.setUTCDate(localToday.getUTCDate() - (local.isoDay - 1));
  const start = new Date(thisMonday);
  start.setUTCDate(thisMonday.getUTCDate() - 7);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  return { start: dateKeyFromUtcSurrogate(start), end: dateKeyFromUtcSurrogate(end) };
}
