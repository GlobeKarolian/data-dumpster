import { z } from 'zod';

export const feedSchema = z.object({
  label: z.string().trim().min(1).max(120),
  url: z.string().url().max(2000),
  targetIds: z.array(z.string().uuid()).min(1).max(40),
  /** Copy template keyed by target id, platform, or "default". Fields: {title} {description} {category}. */
  templates: z.record(z.string(), z.string().max(2000)).default({}),
  windowMinutes: z.number().int().min(5).max(24 * 60).default(120),
  requireApproval: z.boolean().default(false),
  active: z.boolean().default(true),
});
