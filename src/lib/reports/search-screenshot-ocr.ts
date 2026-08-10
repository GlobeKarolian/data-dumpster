import { SEARCH_QUERY_LIMIT } from './types';

export type SearchOcrRow = {
  cells: [string, string, string, string, string];
  confidence: number;
  source: string;
};

type TsvWord = {
  text: string;
  confidence: number;
  left: number;
  top: number;
  lineKey: string;
};

const INTEGER = /^[+-]?[\dOoIl|][\dOoIl|,.]*$/;
const DECIMAL = /^[+-]?[\dOoIl|][\dOoIl|,.]*%?$/;
const HEADER_WORDS = /^(search|query|queries|url|clicks?|impressions?|ctr|position|average|avg)$/i;

function numericText(value: string): string {
  return value
    .replace(/[Oo]/g, '0')
    .replace(/[Il|]/g, '1')
    .replace(/\s+/g, '')
    .replace(/^[^\d+.-]+/, '')
    .replace(/[^\d%+.,-]+$/, '');
}

function isMetricToken(value: string): boolean {
  const normalized = numericText(value);
  return INTEGER.test(normalized) || DECIMAL.test(normalized);
}

function parseTsvWords(tsv: string): TsvWord[] {
  const lines = tsv.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length === 0) return [];
  const first = lines[0].split('\t');
  const hasHeader = first[0] === 'level';
  const header = hasHeader
    ? first
    : ['level', 'page_num', 'block_num', 'par_num', 'line_num', 'word_num',
      'left', 'top', 'width', 'height', 'conf', 'text'];
  const column = (name: string) => header.indexOf(name);
  const levelIndex = column('level');
  const pageIndex = column('page_num');
  const blockIndex = column('block_num');
  const paragraphIndex = column('par_num');
  const lineIndex = column('line_num');
  const leftIndex = column('left');
  const topIndex = column('top');
  const confidenceIndex = column('conf');
  const textIndex = column('text');
  if ([levelIndex, pageIndex, blockIndex, paragraphIndex, lineIndex, leftIndex, topIndex,
    confidenceIndex, textIndex].some((index) => index < 0)) return [];

  const words: TsvWord[] = [];
  for (const line of hasHeader ? lines.slice(1) : lines) {
    const cells = line.split('\t');
    if (cells[levelIndex] !== '5') continue;
    const text = (cells[textIndex] ?? '').trim();
    if (!text) continue;
    const confidence = Number(cells[confidenceIndex]);
    if (!Number.isFinite(confidence) || confidence < 15) continue;
    const left = Number(cells[leftIndex]);
    const top = Number(cells[topIndex]);
    words.push({
      text,
      confidence,
      left: Number.isFinite(left) ? left : 0,
      top: Number.isFinite(top) ? top : 0,
      lineKey: [
        cells[pageIndex], cells[blockIndex], cells[paragraphIndex], cells[lineIndex],
      ].join(':'),
    });
  }
  return words;
}

function wordsByLine(words: TsvWord[]): TsvWord[][] {
  const grouped = new Map<string, TsvWord[]>();
  for (const word of words) {
    const line = grouped.get(word.lineKey) ?? [];
    line.push(word);
    grouped.set(word.lineKey, line);
  }
  return [...grouped.values()]
    .map((line) => line.sort((a, b) => a.left - b.left))
    .sort((a, b) => (a[0]?.top ?? 0) - (b[0]?.top ?? 0));
}

function combinePercentTokens(words: TsvWord[]): TsvWord[] {
  const combined: TsvWord[] = [];
  for (const word of words) {
    if (word.text === '%' && combined.length > 0) {
      const previous = combined[combined.length - 1];
      previous.text += '%';
      previous.confidence = Math.min(previous.confidence, word.confidence);
      continue;
    }
    combined.push({ ...word });
  }
  return combined;
}

function rowFromLine(words: TsvWord[], source: string): SearchOcrRow | null {
  const line = combinePercentTokens(words);
  const metricIndexes: number[] = [];
  for (let index = line.length - 1; index >= 0 && metricIndexes.length < 4; index -= 1) {
    if (isMetricToken(line[index].text)) metricIndexes.unshift(index);
  }
  if (metricIndexes.length !== 4) return null;

  const [clicksIndex, impressionsIndex, ctrIndex, positionIndex] = metricIndexes;
  if (!(clicksIndex < impressionsIndex && impressionsIndex < ctrIndex && ctrIndex < positionIndex)) return null;

  const clicks = numericText(line[clicksIndex].text);
  const impressions = numericText(line[impressionsIndex].text);
  const ctr = numericText(line[ctrIndex].text);
  const position = numericText(line[positionIndex].text);
  if (!INTEGER.test(clicks) || !INTEGER.test(impressions) || !DECIMAL.test(ctr) || !DECIMAL.test(position)) {
    return null;
  }

  let queryWords = line.slice(0, clicksIndex);
  if (queryWords.length > 1 && /^\d{1,3}[.)]?$/.test(queryWords[0].text)) queryWords = queryWords.slice(1);
  const query = queryWords.map((word) => word.text).join(' ').replace(/\s+/g, ' ').trim();
  if (!query || queryWords.every((word) => HEADER_WORDS.test(word.text))) return null;

  const usedWords = [...queryWords, line[clicksIndex], line[impressionsIndex], line[ctrIndex], line[positionIndex]];
  const confidence = usedWords.reduce((sum, word) => sum + word.confidence, 0) / usedWords.length;
  return {
    cells: [query, clicks, impressions, ctr, position],
    confidence: Math.round(confidence),
    source,
  };
}

/**
 * Convert Tesseract's positional TSV into Search Console rows.
 *
 * Search queries can contain digits, so the parser reads the four metrics from
 * the right edge of each OCR line instead of splitting on the first number.
 * Nothing is persisted here; the client shows these candidates in an editable
 * review grid and only stores rows after the editor explicitly accepts them.
 */
export function searchRowsFromTsv(tsv: string, source: string): SearchOcrRow[] {
  return wordsByLine(parseTsvWords(tsv))
    .map((line) => rowFromLine(line, source))
    .filter((row): row is SearchOcrRow => row !== null);
}

export function mergeSearchOcrRows(groups: SearchOcrRow[][]): SearchOcrRow[] {
  const seen = new Set<string>();
  const rows: SearchOcrRow[] = [];
  for (const group of groups) {
    for (const row of group) {
      const key = row.cells.map((cell) => cell.toLowerCase().replace(/\s+/g, ' ').trim()).join('\u001f');
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
      if (rows.length >= SEARCH_QUERY_LIMIT) return rows;
    }
  }
  return rows;
}
