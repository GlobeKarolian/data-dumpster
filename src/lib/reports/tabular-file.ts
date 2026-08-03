/**
 * Turning an uploaded spreadsheet into text the Freeform parser can read.
 *
 * Analysts export from Adobe in whatever format their habit produces: CSV from
 * the download menu, XLSX from Workspace, and occasionally a legacy XLS that
 * has been round-tripping through a shared drive since 2014. All three describe
 * the same grid, so all three are normalised to CSV here and exactly one parser
 * downstream has to understand the Freeform layout.
 *
 * SheetJS is loaded through a dynamic import on purpose. It is roughly half a
 * megabyte and this path runs a handful of times a week, so paying for it in
 * the main bundle would slow every page in the product to speed up one.
 */

export type ReadResult =
  | { ok: true; text: string; kind: 'csv' | 'excel'; sheetNames: string[] }
  | { ok: false; problems: string[] };

/** ZIP local file header: every .xlsx is a zip archive. */
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
/** OLE2 compound document header: the legacy .xls container. */
const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0];

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  return magic.every((b, i) => bytes[i] === b);
}

/**
 * Sniff the bytes rather than trusting the extension.
 *
 * A file named .csv that is actually XLSX is a routine outcome of "Save As" in
 * Excel, and the reverse happens whenever someone renames a download. Reading
 * the first four bytes is decisive where the filename is only a suggestion.
 */
export function detectKind(bytes: Uint8Array, fileName: string): 'csv' | 'excel' {
  if (startsWith(bytes, ZIP_MAGIC) || startsWith(bytes, OLE_MAGIC)) return 'excel';
  if (/\.(xlsx|xlsm|xlsb|xls)$/i.test(fileName)) return 'excel';
  return 'csv';
}

/**
 * Decode CSV bytes as text.
 *
 * Adobe writes UTF-8 with a BOM, which the parser strips. Excel on Windows can
 * emit UTF-16LE instead, which decoded as UTF-8 produces a string full of NUL
 * bytes that no delimiter survives; the BOM is checked so that case reads
 * correctly rather than silently parsing to nothing.
 */
function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes);
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes);
  }
  return new TextDecoder('utf-8').decode(bytes);
}

function escapeCsvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/**
 * Read a workbook into CSV text.
 *
 * Every sheet is emitted, separated by a blank line, because Adobe splits a
 * Freeform export across sheets as readily as it stacks tables inside one. The
 * downstream parser scans for its own anchors, so concatenating costs nothing
 * and covers both layouts without asking the user which one they have.
 */
async function readWorkbook(bytes: Uint8Array): Promise<ReadResult> {
  let XLSX: typeof import('xlsx');
  try {
    XLSX = await import('xlsx');
  } catch {
    return { ok: false, problems: ['The spreadsheet reader failed to load. Export the report as '
      + 'CSV and drop that instead.'] };
  }

  try {
    const wb = XLSX.read(bytes, { type: 'array', cellDates: false, cellFormula: false });
    if (!wb.SheetNames.length) return { ok: false, problems: ['The workbook has no sheets.'] };

    const parts: string[] = [];
    for (const name of wb.SheetNames) {
      const sheet = wb.Sheets[name];
      if (!sheet) continue;
      // `raw: false` keeps Adobe's displayed values, so a percentage stays the
      // string Excel shows rather than becoming an unlabelled 0.00127.
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1, blankrows: true, defval: '', raw: false,
      });
      parts.push(rows.map((r) => r.map(escapeCsvCell).join(',')).join('\n'));
    }
    return { ok: true, text: parts.join('\n\n'), kind: 'excel', sheetNames: wb.SheetNames };
  } catch {
    return {
      ok: false,
      problems: ['The spreadsheet could not be opened. If it is password protected, or still '
        + 'open in Excel, close it and try again.'],
    };
  }
}

/** Guard against a mis-drop of something enormous locking up the tab. */
const MAX_BYTES = 25 * 1024 * 1024;

export async function readTabularFile(file: File): Promise<ReadResult> {
  if (file.size > MAX_BYTES) {
    return {
      ok: false,
      problems: [`That file is ${(file.size / 1024 / 1024).toFixed(1)}MB, larger than the 25MB `
        + 'limit. A weekly referral export is normally well under 1MB, so this may be the '
        + 'wrong file.'],
    };
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return { ok: false, problems: ['The file could not be read from disk.'] };
  }
  if (bytes.length === 0) return { ok: false, problems: ['That file is empty.'] };

  const kind = detectKind(bytes, file.name);
  if (kind === 'excel') return readWorkbook(bytes);
  return { ok: true, text: decodeText(bytes), kind: 'csv', sheetNames: [] };
}
