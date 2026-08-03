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
  /**
   * The visits figure this row is measured on.
   *
   * Which metric that is depends on the property, so it is NOT named for one of
   * them. The Globe export carries "BG Logged Out Visits", the denominator
   * Adobe converts on; Boston.com carries plain "Visits" and has no logged-out
   * split at all. `visitsMetric` on the parse records which was read, so the UI
   * can label the column with the truth rather than an assumption.
   */
  visits: number | null;
  /** All visits, logged in and out. Present only in the device-split table. */
  totalVisits: number | null;
  /** NEW subscriptions started, attributed at visit scope. Null when absent. */
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
  /** The merged header of the column `visits` was read from. */
  visitsMetric: string;
  /** Whether the table carried a subscriptions column at all. */
  hasSubscriptions: boolean;
};

export type ParseOptions = {
  /**
   * Reject a file with no subscriptions column.
   *
   * True for the Globe, whose section ranks by subscriptions driven. False for
   * Boston.com and STAT, which are not subscription products: their referral
   * export is traffic only, and demanding a subscriptions column there would
   * refuse a perfectly good file.
   */
  requireSubscriptions?: boolean;
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
 * A rate, always as a fraction.
 *
 * The CSV download writes a bare decimal (0.00127). Excel writes the formatted
 * string it displays ("0.127%"). Stripping the sign off the second and stopping
 * there yields 0.127, a hundredfold overstatement that would survive every
 * other check in this file because it is still a plausible-looking number.
 */
function toRate(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const n = toNumber(raw);
  if (n === null) return null;
  return raw.includes('%') ? n / 100 : n;
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

const SUBSCRIPTIONS = /BG Digital Subscriptions|subscription|\bsubs\b|starts/i;
const LOGGED_OUT = /BG Logged Out Visits|logged.?out/i;
const CONVERSION = /Conversion Rate|conversion/i;
const DOMAIN_LIKE = /referr|domain|source|platform|channel/i;
const ANY_VISITS = /visits|sessions|clicks/i;

/** Blank, or a run of empty cells. Used to find chunk boundaries. */
function isBlankRow(r: string[]): boolean {
  return r.every((c) => c.trim() === '');
}

/**
 * Recover tables from a file that has no `# Freeform table` markers.
 *
 * Saving a Freeform view as XLSX drops the comment rows the CSV download
 * includes, so the marker-based split finds nothing at all. The structure
 * survives, though: a two-row header followed by a row labelled "Referring
 * Domain". Anchoring on that label reconstructs the same blocks, and lets the
 * field accept a plain spreadsheet somebody assembled by hand as well.
 */
function inferBlocks(rows: string[][]): Block[] {
  const chunks: string[][][] = [];
  let chunk: string[][] = [];
  for (const r of rows) {
    if ((r[0] ?? '').trim().startsWith('#')) continue;
    if (isBlankRow(r)) {
      if (chunk.length) { chunks.push(chunk); chunk = []; }
      continue;
    }
    chunk.push(r);
  }
  if (chunk.length) chunks.push(chunk);

  const mergeHeader = (parts: string[][]): string[] => {
    const width = Math.max(...parts.map((p) => p.length), 0);
    const out: string[] = [];
    for (let i = 0; i < width; i += 1) {
      const cells = parts.map((p) => (p[i] ?? '').trim()).filter(Boolean);
      const unique = [...new Set(cells)];
      out.push(unique.join(' / '));
    }
    return out;
  };

  const blocks: Block[] = [];
  for (const c of chunks) {
    const anchor = c.findIndex((r) => (r[0] ?? '').trim() === 'Referring Domain');
    if (anchor > 0) {
      const header = mergeHeader(c.slice(Math.max(0, anchor - 2), anchor));
      blocks.push({ label: 'inferred', header, rows: c.slice(anchor) });
      continue;
    }
    // No anchor: accept a plain one-header-row table if it names the columns
    // this section needs. Anything else is left alone rather than guessed at.
    if (c.length >= 2) {
      const header = c[0].map((h) => h.trim());
      const looksRight = header.some((h) => DOMAIN_LIKE.test(h))
        && header.some((h) => SUBSCRIPTIONS.test(h));
      if (looksRight) blocks.push({ label: 'inferred', header, rows: c.slice(1) });
    }
  }
  return blocks;
}

/** Index of the first column whose merged header matches, or -1. */
function findCol(header: string[], re: RegExp, skip = new Set<number>()): number {
  for (let i = 0; i < header.length; i += 1) {
    if (!skip.has(i) && re.test(header[i])) return i;
  }
  return -1;
}

function isDomainBlock(b: Block): boolean {
  return b.rows.some((r) => (r[0] ?? '').trim() === 'Referring Domain')
    || DOMAIN_LIKE.test(b.header[0] ?? '');
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
/**
 * Metric name prefixes that identify which property a panel is querying.
 *
 * Adobe namespaces custom metrics per property: the Globe's are prefixed "BG",
 * Boston.com's "Bcom". The prefix travels with the column header, which makes
 * it the only reliable way to tell whose numbers a table actually holds.
 */
const SUITE_PREFIXES: { suite: RegExp; prefix: RegExp; name: string }[] = [
  { suite: /bostonglobe/i, prefix: /\bBG\b/, name: 'the Globe' },
  { suite: /boston\.com|^bcom/i, prefix: /\bBcom\b/, name: 'Boston.com' },
];

/**
 * Does this block's metrics belong to a property other than the file's own?
 *
 * A real Boston.com export was found to contain a table whose 401 rows were
 * byte-identical to the Globe's, carrying "BG Logged Out Visits" under a
 * "Report suite: Boston.com" header: a stale panel in the Workspace project
 * pointed at the wrong suite. Because that table is the one with a conversion
 * rate, it is exactly the table this parser prefers, and every number in it
 * looks entirely plausible. Detecting the mismatch is the only thing standing
 * between that file and a report that presents Globe figures as Boston.com's.
 */
function foreignSuite(block: Block, reportSuite: string | null): string | null {
  if (!reportSuite) return null;
  const own = SUITE_PREFIXES.find((s) => s.suite.test(reportSuite));
  if (!own) return null;
  const header = block.header.join(' | ');
  for (const other of SUITE_PREFIXES) {
    if (other === own) continue;
    if (other.prefix.test(header) && !own.prefix.test(header)) return other.name;
  }
  return null;
}

function pickBlock(
  blocks: Block[],
  requireSubscriptions: boolean,
  reportSuite: string | null,
  problems: string[],
): { block: Block; kind: 'conversion' | 'fallback' } | null {
  const all = blocks.filter(isDomainBlock);
  if (all.length === 0) return null;

  const domainBlocks: Block[] = [];
  for (const b of all) {
    const foreign = foreignSuite(b, reportSuite);
    if (foreign) {
      problems.push(`A table measuring ${foreign} was ignored: its metrics are named for a `
        + `different report suite than this file's "${reportSuite}". Check that panel in `
        + 'Workspace, it is pointed at the wrong property.');
      continue;
    }
    domainBlocks.push(b);
  }
  if (domainBlocks.length === 0) return null;

  const widest = (list: Block[]) =>
    list.reduce<Block | null>((a, b) => (a === null || b.rows.length > a.rows.length ? b : a), null);

  const withConversion = domainBlocks.filter(
    (b) => findCol(b.header, LOGGED_OUT) >= 0 && findCol(b.header, SUBSCRIPTIONS) >= 0,
  );
  const best = widest(withConversion);
  if (best) return { block: best, kind: 'conversion' };

  const withSubs = widest(domainBlocks.filter((b) => findCol(b.header, SUBSCRIPTIONS) >= 0));
  if (withSubs) return { block: withSubs, kind: 'fallback' };
  if (requireSubscriptions) return null;

  // Traffic-only properties. Widest wins because Adobe emits a short summary
  // table alongside the full ranking and both match on a visits column.
  const withVisits = widest(domainBlocks.filter((b) => findCol(b.header, ANY_VISITS) >= 0));
  return withVisits ? { block: withVisits, kind: 'fallback' } : null;
}

/**
 * Rows Adobe emits that are not referring domains.
 *
 * 'Domain' introduces an ISP breakdown (comcast.net, verizon.net) that measures
 * the visitor's internet provider rather than where they came from. Mixing that
 * into a referral ranking double counts traffic already attributed elsewhere.
 */
const NON_DOMAIN_LABELS = new Set(['Domain', 'Month', 'Segments', '']);

export function parseAdobeFreeform(text: string, opts: ParseOptions = {}): FreeformParse {
  const requireSubscriptions = opts.requireSubscriptions ?? true;
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

  // Marker-based split first, then the anchor-based reconstruction that an XLSX
  // export needs because saving as a workbook drops the comment rows.
  let blocks = splitBlocks(raw);
  let picked = pickBlock(blocks, requireSubscriptions, reportSuite, problems);
  if (!picked) {
    const inferred = inferBlocks(raw);
    const retry: string[] = [];
    const pickedInferred = pickBlock(inferred, requireSubscriptions, reportSuite, retry);
    if (pickedInferred) { blocks = inferred; picked = pickedInferred; problems.push(...retry); }
  }

  if (!picked) {
    return {
      ok: false,
      problems: [
        blocks.length === 0
          ? 'No table with a referring-domain column was found. Check that this is the Top '
            + 'Referrals export rather than another view.'
          : `Found ${blocks.length} tables, but none usable`
            + (requireSubscriptions
              ? ' with both a referring-domain and a subscriptions column.'
              : ' with a referring-domain and a visits column.'),
        ...problems,
      ],
      reportSuite, dateRange, rows: [], total: null,
      tablesFound: blocks.length, visitsMetric: '', hasSubscriptions: false,
    };
  }

  const { block } = picked;
  const subCol = findCol(block.header, SUBSCRIPTIONS);
  const convCol = findCol(block.header, CONVERSION);
  // Logged-out visits first, since that is the denominator Adobe divides by
  // where it exists. Boston.com has no such split and reports plain Visits.
  let visitCol = findCol(block.header, LOGGED_OUT);
  if (visitCol < 0) {
    visitCol = findCol(block.header, ANY_VISITS, new Set([subCol, convCol].filter((i) => i >= 0)));
  }
  if (visitCol < 0) visitCol = 1;
  const visitsMetric = (block.header[visitCol] ?? 'Visits').replace(/\s*\/\s*Visits$/i, '');

  if (subCol >= 0 && convCol < 0) {
    problems.push('Adobe did not supply a conversion rate column, so it is computed here from '
      + `${visitsMetric.toLowerCase()}.`);
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

    const visits = toNumber(r[visitCol]);
    const newSubscriptions = subCol >= 0 ? toNumber(r[subCol]) : null;
    let conversionRate = convCol >= 0 ? toRate(r[convCol]) : null;
    if (conversionRate === null && visits && newSubscriptions !== null) {
      conversionRate = newSubscriptions / visits;
    }

    const row: FreeformDomainRow = {
      domain: label,
      visits,
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
    visitsMetric,
    hasSubscriptions: subCol >= 0,
  };
}
