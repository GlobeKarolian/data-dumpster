/**
 * Alert rule configuration: what an alert watches, and where it goes.
 *
 * Kept in one file because the CRUD endpoints and the cron evaluator have to
 * agree exactly. A rule that validates on save and then means something slightly
 * different at 4am is the worst kind of bug in a monitoring feature -- it does
 * not fail, it just quietly stops telling you things.
 *
 * Every threshold has a default. A rule created from the UI with nothing but a
 * name and a kind is a working rule, not a stub.
 */
import { z } from 'zod';
import { METRIC_KEYS, PLATFORMS } from '@/lib/types';

/** Slack is the only destination Data Dumpster delivers to itself; email is recorded
 *  for a future transactional sender and is a no-op at delivery time today. */
export const destinationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('slack'),
    webhookUrl: z.string().url().startsWith('https://hooks.slack.com/', 'Use a Slack incoming-webhook URL.'),
    label: z.string().trim().max(80).optional(),
  }),
  z.object({
    type: z.literal('email'),
    to: z.string().email(),
  }),
]);

export const destinationsSchema = z.array(destinationSchema).max(10);
export type AlertDestination = z.infer<typeof destinationSchema>;

/** How far back an evaluation looks. Kept short so alerts are news, not history. */
const lookbackDays = z.number().int().min(1).max(90).default(7);

/** Fractional, e.g. 0.25 for 25%. Fractions everywhere, percentages only in prose. */
const fraction = z.number().min(0).max(100);

export const alertConfigSchema = z.object({
  lookbackDays,
  /** competitor_outlier: how many times its own median a post must beat to count. */
  outlierMultiple: z.number().min(1.5).max(100).default(4),
  /** competitor_outlier: floor so a company with three posts cannot trip it. */
  minEngagement: z.number().int().min(0).default(250),
  /** audience_swing / volume_drop / share_of_voice_shift: movement that matters. */
  thresholdPct: fraction.default(0.2),
  /** keyword_hit: any of these appearing in post text fires. */
  keywords: z.array(z.string().trim().min(2).max(80)).max(50).default([]),
  /** Narrow any rule to particular platforms. Empty means all. */
  platforms: z.array(z.enum(PLATFORMS)).default([]),
  /** audience_swing / volume_drop: which metric to watch, where it is a choice. */
  metric: z.enum(METRIC_KEYS).optional(),
  /** Cap on events one rule may raise per run, so one bad day is not 400 Slack messages. */
  maxEventsPerRun: z.number().int().min(1).max(50).default(10),
});

export type AlertConfig = z.infer<typeof alertConfigSchema>;

/**
 * Parse a stored config leniently. Rules written before a field existed must keep
 * working, so unknown keys are dropped and missing ones take their default rather
 * than failing the whole run.
 */
export function readStoredConfig(raw: unknown): AlertConfig {
  const parsed = alertConfigSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : alertConfigSchema.parse({});
}

export function readStoredDestinations(raw: unknown): AlertDestination[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((d) => {
    const parsed = destinationSchema.safeParse(d);
    return parsed.success ? [parsed.data] : [];
  });
}
