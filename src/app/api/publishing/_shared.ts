import { z } from 'zod';
import { PUBLISH_PLATFORMS, PUBLISH_PROVIDERS } from '@/lib/publishing/platforms';

export const NO_STORE = { headers: { 'cache-control': 'no-store' } };

const minute = z.number().int().min(0).max(1440);
export const ruleSchema = z.object({ weekday: z.number().int().min(0).max(6), startMinute: minute, endMinute: minute })
  .refine((r) => r.endMinute > r.startMinute, 'A posting block must end after it starts.');

export const targetSchema = z.object({
  brand: z.string().trim().min(1).max(80),
  platform: z.enum(PUBLISH_PLATFORMS),
  label: z.string().trim().min(1).max(120),
  handle: z.string().trim().max(120).nullable().default(null),
  provider: z.enum(PUBLISH_PROVIDERS),
  /** Write-only. Ayrshare: {profileKey}. Bluesky: {identifier, appPassword}. Omit to keep the saved one. */
  secret: z.record(z.string(), z.string().max(500)).nullable().optional(),
  channelId: z.string().uuid().nullable().default(null),
  utm: z.object({
    source: z.string().max(80).optional(), medium: z.string().max(80).optional(), campaign: z.string().max(120).optional(),
    content: z.string().max(120).optional(), term: z.string().max(120).optional(),
  }).default({}),
  rules: z.array(ruleSchema).max(70).default([]),
  minGapMinutes: z.number().int().min(0).max(24 * 60).default(30),
  maxPerDay: z.number().int().min(1).max(200).nullable().default(null),
  bioPageId: z.string().uuid().nullable().default(null),
  active: z.boolean().default(true),
});
