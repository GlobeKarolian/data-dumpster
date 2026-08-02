/**
 * Parser for Adobe Analytics Freeform CSV exports.
 *
 * This is not a CSV in the sense the paste box means it. One file holds several
 * independent tables stacked vertically, each introduced by a `# Freeform table`
 * comment, each carrying a TWO row header, and each free to have a different
 * column count from its neighbours. Handing the raw text to a delimiter sniffer
 * produces a table with the right number of commas and no meaning at all.
 *
 * Two facts about the format drive the whole design.
 *
 * First, the metric named "BG Digital Subscriptions (Visit)" counts NEW
 * subscriptions started. The "(Visit)" suffix is Adobe's attribution scope, not
 * the unit being counted. Reading it as subscriber visits understates the value
 * of every referrer in the report by roughly three orders of magnitude, so the
 * label is rewritten on the way in and never carried through verbatim.
 *
 * Second, period rows DO NOT SUM to the period total. Adobe deduplicates visits
 * that straddle a bucket boundary, so a week whose two month rows read 630,852
 * and 164,244 reports a total of 795,041 rather than 795,096. The parser reads
 * total rows and never adds them, for the same reason the metrics layer refuses
 * to sum audience snapshots.
 */

/** One referring domain, as Adobe reports it. */
export type FreeformDomainRow = {
  domain: string;
  /** Visits by users who were not logged in, the denominator Adobe converts on. */
  loggedOutVisits: number | null;
  /** All visits, logged in and out. Present only in the device-split table. */
  totalVisits: number | null;
  /** NEW subscriptions started, attributed at visit scope. */
  newSubscriptions: number | null;
  /** As reported by Adobe. Recomputed only when Adobe omitted it. */
  conversionRate: number | null;
};

export type FreeformParse = {
  ok: boolean;
  /** Why the parse failed, or notes worth surfacing when it succeeded. */
  problems: string[];
  reportSuite: string | null;
  /** Verbatim from the header comment; the export does not use ISO dates. */
  dateRange: string | null;
  rows: FreeformDomainRow[];
  /** The 'Referring Domain' summary row, which is a total and not a domain. */
  total: FreeformDomainRow | null;
  /** How many `# Freeform table` blocks the file contained. */
  tablesFound: number;
};

type Block = { label: string; header: string[]; rows: string[][] };

/** Minimal RFC 4180 reader. Adobe quotes any field containing a comma. */
function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 1; } else { quoted = false; }
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field); out.push(row); row = []; field = '';
      continue;
    }
    field += c;
  }
  if (field !== '' || row.length > 0) { row.push(field); out.push(row); }
  return out;
}

function toNumber(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const cleaned = raw.replace(/[,$%\s]/g, '');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Split the file into blocks.
 *
 * The two header rows are merged into one label per column. Adobe repeats the
 * metric name on row one and the breakdown on row two, so "Visits / Mobile
 * Phone" and "Visits / Tablet" only become distinguishable once joined.
 */
function splitBlocks(rows: string[][]): Block[] {
  const blocks: Block[] = [];
  let pending: string | null = null;
  let current: Block | null = null;
  let headerRows: string[][] = [];

  for (const row of rows) {
    const first = (row[0] ?? '').trim();
    if (first.startsWith('#')) {
      const m = /^#\s*(Freeform table.*)$/.exec(first);
      if (m) { pending = m[1].trim(); current = null; headerRows = []; }
      continue;
    }
    if (row.every((c) => c.trim() === '')) continue;
    if (pending !== null && current === null) {
      headerRows.push(row);
      if (headerRows.length === 2) {
        const width = Math.max(headerRows[0].length, headerRows[1].length);
        const header: string[] = [];
        for (let i = 0; i < width; i += 1) {
          const a = (headerRows[0][i] ?? '').trim();
          const b = (headerRows[1][i] ?? '').trim();
          header.push(a && b && a !== b ? a + ' / ' + b : (a || b));
        }
        current = { label: pending, header, rows: [] };
        blocks.push(current);
        pending = null;
        headerRows = [];
      }
      continue;
    }
    if (current) current.rows.push(row);
  }
  return blocks;
}

const SUBSCRIPTIONS = /BG Digital Subscriptions/i;
const LOGGED_OUT = /BG Logged Out Visits/i;
const CONVERSION = /Conversion Rate/i;

/** Index of the first column whose merged header matches, or -1. */
function findCol(header: string[], re: RegExp, skip = new Set<number>()): number {
  for (let i = 0; i < header.length; i += 1) {
    if (!skip.has(i) && re.test(header[i])) return i;
  }
  return -1;
}

function isDomainBlock(b: Block): boolean {
  return b.rows.some((r) => (r[0] ?? '').trim() === 'Referring Domain');
}

/**
 * Pick the block to read.
 *
 * Preference order is deliberate. The conversion block carries logged-out
 * visits, new subscriptions and Adobe's own conversion rate on one row, which
 * is everything the report section needs and lets the arithmetic be checked
 * against the source rather than recomputed and hoped over. Only if that block
 * is missing does the parser fall back to the widest domain block available.
 */
function pickBlock(blocks: Block[]): { block: Block; kind: 'conversion' | 'fallback' } | null {
  const domainBlocks = blocks.filter(isDomainBlock);
  if (domainBlocks.length === 0) return null;
  const withConversion = domainBlocks.filter(
    (b) => findCol(b.header, LOGGED_OUT) >= 0 && findCol(b.header, SUBSCRIPTIONS) >= 0,
  );
  if (withConversion.length > 0) {
    const best = withConversion.reduce((a, b) => (b.rows.length > a.rows.length ? b : a));
    return { block: best, kind: 'conversion' };
  }
  const best = domainBlocks
    .filter((b) => findCol(b.header, SUBSCRIPTIONS) >= 0)
    .reduce<Block | null>((a, b) => (a === null || b.rows.length > a.rows.length ? b : a), null);
  return best ? { block: best, kind: 'fallback' } : null;
}

/**
 * Rows Adobe emits that are not referring domains.
 *
 * 'Domain' introduces an ISP breakdown (comcast.net, verizon.net) that measures
 * the visitor's internet provider rather than where they came from. Mixing that
 * into a referral ranking double counts traffic already attributed elsewhere.
 */
const NON_DOMAIN_LABELS = new Set(['Domain', 'Month', 'Segments', '']);

export function parseAdobeFreeform(text: string): FreeformParse {
  const problems: string[] = [];
  const raw = parseCsv(text);

  let reportSuite: string | null = null;
  let dateRange: string | null = null;
  for (const row of raw.slice(0, 12)) {
    const first = (row[0] ?? '').trim();
    const suite = /^#\s*Report suite:\s*(.+)$/i.exec(first);
    if (suite) reportSuite = suite[1].trim();
    const date = /^#\s*Date:\s*(.+)$/i.exec(first);
    if (date) dateRange = date[1].trim();
  }

  const blocks = splitBlocks(raw);
  if (blocks.length === 0) {
    return {
      ok: false,
      problems: ['No "# Freeform table" blocks found. This does not look like an Adobe '
        + 'Analytics Freeform export.'],
      reportSuite, dateRange, rows: [], total: null, tablesFound: 0,
    };
  }

  const picked = pickBlock(blocks);
  if (!picked) {
    return {
      ok: false,
      problems: [`Found ${blocks.length} tables but none had a "Referring Domain" row with a `
        + 'subscriptions column.'],
      reportSuite, dateRange, rows: [], total: null, tablesFound: blocks.length,
    };
  }

  const { block, kind } = picked;
  const subCol = findCol(block.header, SUBSCRIPTIONS);
  const visitCol = kind === 'conversion' ? findCol(block.header, LOGGED_OUT) : 1;
  const convCol = findCol(block.header, CONVERSION);

  if (kind === 'fallback') {
    problems.push('The table with logged-out visits was not present, so the conversion rate is '
      + 'computed here rather than read from Adobe.');
  }

  const parsedRows: FreeformDomainRow[] = [];
  let total: FreeformDomainRow | null = null;
  let skipped = 0;
  let inIspSection = false;

  for (const r of block.rows) {
    const label = (r[0] ?? '').trim();
    if (label === 'Domain') { inIspSection = true; continue; }
    if (inIspSection) { skipped += 1; continue; }
    if (NON_DOMAIN_LABELS.has(label)) continue;
    if (/^\d{4}-\d{2}-\d{2}$/.test(label)) continue;

    const loggedOutVisits = toNumber(r[visitCol]);
    const newSubscriptions = toNumber(r[subCol]);
    let conversionRate = convCol >= 0 ? toNumber(r[convCol]) : null;
    if (conversionRate === null && loggedOutVisits && newSubscriptions !== null) {
      conversionRate = newSubscriptions / loggedOutVisits;
    }

    const row: FreeformDomainRow = {
      domain: label,
      loggedOutVisits,
      totalVisits: null,
      newSubscriptions,
      conversionRate,
    };
    if (label === 'Referring Domain') total = row;
    else parsedRows.push(row);
  }

  if (skipped > 0) {
    problems.push(`Ignored ${skipped} rows from the ISP "Domain" breakdown, which measures the `
      + "visitor's internet provider rather than a referrer.");
  }

  // Total visits live in a different block. Join them on the domain name rather
  // than by position; the two tables are sorted differently.
  //
  // The column to find is headed "Visits" on BOTH header rows, which the merge
  // collapses to a bare "Visits" rather than "Visits / Visits". Matching it
  // exactly is what keeps it from colliding with "Visits / Mobile Phone" or
  // with "BG Logged Out Visits / Visits" in the block already being read.
  const deviceBlock = blocks.find(
    (b) => b !== block && isDomainBlock(b) && b.header.some((h) => /^Visits$/i.test(h)),
  );
  if (deviceBlock) {
    const col = findCol(deviceBlock.header, /^Visits$/i);
    if (col >= 0) {
      const byDomain = new Map<string, number | null>();
      for (const r of deviceBlock.rows) byDomain.set((r[0] ?? '').trim(), toNumber(r[col]));
      for (const row of parsedRows) {
        if (byDomain.has(row.domain)) row.totalVisits = byDomain.get(row.domain) ?? null;
      }
      if (total && byDomain.has('Referring Domain')) {
        total.totalVisits = byDomain.get('Referring Domain') ?? null;
      }
    }
  }

  if (parsedRows.length === 0) {
    problems.push('The table was recognised but held no domain rows.');
  }

  return {
    ok: parsedRows.length > 0,
    problems,
    reportSuite,
    dateRange,
    rows: parsedRows,
    total,
    tablesFound: blocks.length,
  };
}
