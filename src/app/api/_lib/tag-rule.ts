/**
 * The shape of an auto-tag rule, validated.
 *
 * Rules are evaluated at ingest time by lib/adapters/tagging.ts and stored as
 * jsonb, which means the database will happily accept nonsense. This schema is
 * the only thing standing between a typo in the tag editor and a tag that
 * silently matches nothing forever, so it is applied on create and on update.
 */
import { z } from 'zod';
import { PLATFORMS, POST_TYPES } from '@/lib/types';

const keywords = z.array(z.string().trim().min(1).max(120)).max(200);

export const tagRuleSchema = z.object({
  anyKeywords: keywords.optional(),
  allKeywords: keywords.optional(),
  noneKeywords: keywords.optional(),
  hashtags: keywords.optional(),
  platforms: z.array(z.enum(PLATFORMS)).optional(),
  postTypes: z.array(z.enum(POST_TYPES)).optional(),
  urlDomains: keywords.optional(),
  urlPathContains: keywords.optional(),
  /**
   * Compiled here as well as stored. An invalid pattern would otherwise throw
   * once per post for the rest of time, inside the ingest runner, where nobody
   * is looking.
   */
  regex: z.string().max(500).refine((p) => {
    try { new RegExp(p, 'i'); return true; } catch { return false; }
  }, 'Not a valid regular expression.').optional(),
}).refine(
  (r) => Object.values(r).some((v) => (Array.isArray(v) ? v.length > 0 : v !== undefined)),
  'A rule needs at least one condition, otherwise it matches nothing.',
);

export type TagRule = z.infer<typeof tagRuleSchema>;

/** Hex or CSS-name-free hex only; the UI renders this straight into a style attribute. */
export const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a six-digit hex color.');
