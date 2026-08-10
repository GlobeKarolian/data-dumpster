/**
 * Paste parsing for the manual sections.
 *
 * The user's actual workflow is: open Search Console in one tab and the referral
 * report in another, select the rows, copy, paste. Whatever lands in the box is
 * whatever the source application put on the clipboard, which in practice is one
 * of four things -- tab separated from Google Sheets, tab separated from a Google
 * Doc table, comma separated from a CSV export, or column-aligned text from a
 * dashboard that only offers "copy". All four are accepted here rather than
 * telling a vice president to reformat their clipboard.
 *
 * Two rules keep the result trustworthy. Cell text is never rewritten, only
 * trimmed, so a figure shown in the report is character-for-character the figure
 * that was copied. And the original paste is retained alongside the parsed rows,
 * so a bad parse is always recoverable and never destructive.
 */
import type { ManualColumnSpec, ManualTable } from './types';

export type Delimiter = 'tab' | 'comma' | 'spaces' | 'single';

function splitLines(raw: string): string[] {
  return raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    // Google Docs tables paste non-breaking spaces; those must not become cell text.
    .map((line) => line.replace(/\u00a0/g, ' ').trimEnd())
    .filter((line) => line.trim().length > 0);
}

/**
 * Comma splitting that understands quotes, because a search query containing a
 * comma is common and losing half of it would be silent corruption.
 */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ',') { out.push(cell); cell = ''; continue; }
    cell += ch;
  }
  out.push(cell);
  return out;
}

/**
 * Pick a delimiter from the whole paste rather than the first line, so a header
 * that happens to contain a comma cannot mis-type the entire table.
 */
export function detectDelimiter(lines: string[]): Delimiter {
  if (lines.length === 0) return 'single';
  if (lines.some((l) => l.includes('\t'))) return 'tab';

  /**
   * Column-aligned text is tested before CSV, and the order is load bearing.
   * A dashboard that pastes as aligned columns also pastes its numbers with
   * thousands separators, so "facebook.com    12,431    87" splits into three
   * consistent fields on commas as well as on spaces -- and the comma reading
   * is nonsense. Real CSV almost never contains runs of two spaces that split
   * every line into the same number of fields, so testing spaces first is the
   * cheap way to get both cases right.
   */
  const spaceCounts = lines.map((l) => l.split(/ {2,}/).length);
  const spaceConsistent = spaceCounts.every((c) => c === spaceCounts[0]) && (spaceCounts[0] ?? 1) > 1;
  if (spaceConsistent) return 'spaces';

  const commaCounts = lines.map((l) => splitCsvLine(l).length);
  const commaConsistent = commaCounts.every((c) => c === commaCounts[0]) && (commaCounts[0] ?? 1) > 1;
  if (commaConsistent) return 'comma';

  return commaCounts.some((c) => c > 1) ? 'comma' : 'single';
}

function splitLine(line: string, delimiter: Delimiter): string[] {
  switch (delimiter) {
    case 'tab': return line.split('\t');
    case 'comma': return splitCsvLine(line);
    case 'spaces': return line.split(/ {2,}/);
    case 'single': return [line];
  }
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * A first row is treated as a header only when at least half of its cells match
 * the declared column labels. Guessing more aggressively than that would eat a
 * real data row on any table whose top entry happens to be text.
 */
export function looksLikeHeader(cells: string[], columns: ManualColumnSpec[]): boolean {
  if (cells.length === 0) return false;
  const expected = new Set(columns.flatMap((c) => [normalizeHeader(c.label), normalizeHeader(c.key)]));
  let hits = 0;
  for (const cell of cells) {
    if (expected.has(normalizeHeader(cell))) hits += 1;
  }
  return hits * 2 >= Math.min(cells.length, columns.length);
}

export type ParseResult = {
  rows: string[][];
  delimiter: Delimiter;
  headerDropped: boolean;
  /** Rows whose cell count did not match the column spec, before padding. */
  raggedRows: number;
};

/** Parse a paste into rows padded and clipped to the section's column count. */
export function parseTable(raw: string, columns: ManualColumnSpec[]): ParseResult {
  const lines = splitLines(raw);
  if (lines.length === 0) {
    return { rows: [], delimiter: 'single', headerDropped: false, raggedRows: 0 };
  }

  const delimiter = detectDelimiter(lines);
  const split = lines.map((line) => splitLine(line, delimiter).map((cell) => cell.trim()));

  let headerDropped = false;
  let headerIndexes: number[] | null = null;
  if (split.length > 1 && looksLikeHeader(split[0], columns)) {
    const header = split.shift() ?? [];
    headerDropped = true;
    const normalized = header.map(normalizeHeader);
    headerIndexes = columns.map((column) => {
      const expected = [normalizeHeader(column.label), normalizeHeader(column.key)];
      return normalized.findIndex((cell) => expected.includes(cell)
        || (column.key === 'ctr' && cell === 'urlctr'));
    });
  }

  let raggedRows = 0;
  const width = columns.length;
  const rows = split.map((cells) => {
    if (headerIndexes) {
      return headerIndexes.map((index) => index >= 0 ? (cells[index] ?? '') : '');
    }
    if (cells.length !== width) raggedRows += 1;
    const padded = cells.slice(0, width);
    while (padded.length < width) padded.push('');
    return padded;
  });

  return { rows, delimiter, headerDropped, raggedRows };
}

/** Build the stored table from a paste, stamping the moment it was entered. */
export function tableFromPaste(raw: string, columns: ManualColumnSpec[]): ManualTable {
  const { rows } = parseTable(raw, columns);
  return { raw, rows, updatedAt: new Date().toISOString() };
}

export function emptyTable(): ManualTable {
  return { raw: '', rows: [], updatedAt: null };
}

/** Serialize rows back to a tab-separated paste, for the editable fallback. */
export function rowsToTsv(rows: string[][]): string {
  return rows.map((r) => r.join('\t')).join('\n');
}
