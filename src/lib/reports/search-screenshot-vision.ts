/**
 * Read a Looker "Top Queries" screenshot with a vision model.
 *
 * Why this replaced in-browser OCR. Tesseract decided a row's shape by counting
 * number-like tokens, which cannot survive what OCR actually emits from these
 * dashboards: comparison arrows come back as `&`, `*` or `¢`, sometimes fused
 * into the adjacent number; `-47.4%` arrives as `-47 4%`; a query containing a
 * number puts a number where a metric belongs. On the 17 August Boston.com
 * export that silently deleted 12 of 28 rows, 32% of click volume — and the
 * deleted rows were specifically the ones with no prior week to compare
 * against, which is to say the new stories, the entire point of the report.
 *
 * A vision model reads the rendered table instead of guessing at token shapes,
 * so a glyph it cannot name is a glyph in a column it was told to ignore.
 *
 * The safety property that matters: this file never lets the model invent a
 * number. Every row it returns is re-validated here against the shapes a
 * Looker cell can actually have, anything malformed is reported as rejected
 * rather than dropped, and the caller shows the user what could not be read.
 * A short table must never again look like a complete one.
 */
import { complete } from '@/lib/ai/client';
import type { ModelMessage } from '@/lib/ai/types';

/** Query, URL clicks, impressions, CTR — matching the report's columns. */
export type VisionSearchRow = [string, string, string, string];

export interface VisionReadResult {
  rows: VisionSearchRow[];
  /** Rows the model returned that failed validation, with the reason. */
  rejected: { raw: unknown; reason: string }[];
  model: string;
  costUsd: number;
}

export const SEARCH_SCREENSHOT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['rows'],
  properties: {
    rows: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['query', 'clicks', 'impressions', 'ctr'],
        properties: {
          query: { type: 'string' },
          clicks: { type: 'string' },
          impressions: { type: 'string' },
          ctr: { type: 'string' },
        },
      },
    },
  },
} as const;

const PROMPT = `You are reading a screenshot of a Looker Studio table titled "Web Search: Top Queries".

Return every data row in the table, in the order shown, top to bottom.

Columns you must return, per row:
- query: the search query text, exactly as printed
- clicks: the "Url Clicks" value
- impressions: the "Impressions" value
- ctr: the "URL CTR" percentage

Rules that matter:
1. IGNORE every percentage-change / delta column. They sit immediately to the
   right of Url Clicks, Impressions and URL CTR, and contain a small green or
   red arrow. Arrows may render oddly. Never return a delta value.
2. A dash, a blank, or a lone arrow in a delta column means the query is new
   this period. That is normal. Still return the row.
3. Copy numbers EXACTLY as printed, including thousands separators and the %
   sign. Do not reformat, round, or convert. "1,234" stays "1,234". "51.47%"
   stays "51.47%".
4. A query may itself contain digits or a decimal. Those digits belong to the
   query, not to a metric column.
5. Do not include the header row. Do not include totals or summary rows.
6. If a row is genuinely unreadable, omit it rather than guessing. Never invent
   a value to fill a cell.

Return JSON matching the schema exactly.`;

/** Looker prints integers with optional thousands separators. */
const INTEGER = /^\d{1,3}(,\d{3})*$|^\d+$/;
/** And percentages with one or two decimals, occasionally negative. */
const PERCENT = /^-?\d+(\.\d+)?%$/;

function validate(raw: unknown): { row: VisionSearchRow } | { reason: string } {
  if (typeof raw !== 'object' || raw === null) return { reason: 'not an object' };
  const r = raw as Record<string, unknown>;
  const query = typeof r.query === 'string' ? r.query.replace(/\s+/g, ' ').trim() : '';
  const clicks = typeof r.clicks === 'string' ? r.clicks.trim() : '';
  const impressions = typeof r.impressions === 'string' ? r.impressions.trim() : '';
  const ctr = typeof r.ctr === 'string' ? r.ctr.trim() : '';

  if (!query) return { reason: 'empty query' };
  if (!INTEGER.test(clicks)) return { reason: `clicks "${clicks}" is not a whole number` };
  if (!INTEGER.test(impressions)) return { reason: `impressions "${impressions}" is not a whole number` };
  if (!PERCENT.test(ctr)) return { reason: `CTR "${ctr}" is not a percentage` };
  return { row: [query, clicks, impressions, ctr] };
}

export function rowsFromVisionPayload(payload: unknown): {
  rows: VisionSearchRow[];
  rejected: { raw: unknown; reason: string }[];
} {
  const rows: VisionSearchRow[] = [];
  const rejected: { raw: unknown; reason: string }[] = [];
  const list = (payload as { rows?: unknown })?.rows;
  if (!Array.isArray(list)) return { rows, rejected };

  const seen = new Set<string>();
  for (const item of list) {
    const checked = validate(item);
    if ('reason' in checked) { rejected.push({ raw: item, reason: checked.reason }); continue; }
    // The same query can legitimately appear once per screenshot when a user
    // uploads overlapping captures; keep the first and drop exact repeats.
    const key = checked.row.join('').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(checked.row);
  }
  return { rows, rejected };
}

export async function readSearchScreenshots(opts: {
  orgId: string;
  images: { mediaType: string; base64: string }[];
  signal?: AbortSignal;
}): Promise<VisionReadResult> {
  const messages: ModelMessage[] = [
    { role: 'system', content: PROMPT },
    {
      role: 'user',
      content: opts.images.length > 1
        ? `Here are ${opts.images.length} screenshots of the same table, covering different rows. Return the rows from all of them, in order.`
        : 'Here is the screenshot.',
      images: opts.images,
    },
  ];

  const result = await complete(
    opts.orgId,
    {
      messages,
      jsonSchema: SEARCH_SCREENSHOT_SCHEMA as unknown as Record<string, unknown>,
      signal: opts.signal,
      // Tables are long; a 40-row capture needs room to come back whole.
      maxTokens: 8000,
      temperature: 0,
    },
    { feature: 'search-screenshot-import' },
  );

  const payload = result.json ?? safeParse(result.text);
  const { rows, rejected } = rowsFromVisionPayload(payload);
  return { rows, rejected, model: result.model, costUsd: result.costUsd };
}

function safeParse(text: string): unknown {
  try {
    // Models occasionally wrap JSON in a fenced block despite a schema.
    const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
    return JSON.parse(fenced ? fenced[1] : text);
  } catch {
    return null;
  }
}
