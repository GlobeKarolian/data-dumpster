import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeSearchOcrRows, searchRowsFromTsv, type SearchOcrRow } from './search-screenshot-ocr';

function tsv(lines: Array<Array<{ text: string; left: number; confidence?: number }>>): string {
  const header = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext';
  const rows = [header];
  lines.forEach((line, lineIndex) => {
    line.forEach((word, wordIndex) => {
      rows.push([
        5, 1, 1, 1, lineIndex + 1, wordIndex + 1, word.left, 20 + lineIndex * 30,
        word.text.length * 8, 14, word.confidence ?? 92, word.text,
      ].join('\t'));
    });
  });
  return rows.join('\n');
}

test('extracts the four right-edge metrics while keeping digits inside a query', () => {
  const rows = searchRowsFromTsv(tsv([[
    { text: '1', left: 10 }, { text: 'election', left: 40 }, { text: '2026', left: 120 },
    { text: '1,234', left: 400 }, { text: '5,000', left: 500 },
    { text: '24.68', left: 600 }, { text: '%', left: 650 }, { text: '3.46', left: 700 },
  ]]), 'one.jpg');
  assert.deepEqual(rows[0]?.cells, ['election 2026', '1,234', '5,000', '24.68%', '3.46']);
  assert.equal(rows[0]?.source, 'one.jpg');
});

test('corrects common OCR substitutions only inside numeric cells', () => {
  const rows = searchRowsFromTsv(tsv([[
    { text: 'Boston', left: 10 }, { text: 'Globe', left: 70 },
    { text: 'l,2O4', left: 400 }, { text: '5,OOO', left: 500 },
    { text: '24.6O%', left: 600 }, { text: '3.4I', left: 700 },
  ]]), 'two.jpeg');
  assert.deepEqual(rows[0]?.cells, ['Boston Globe', '1,204', '5,000', '24.60%', '3.41']);
});

test('accepts the headerless TSV emitted by Tesseract.js 6', () => {
  const withHeader = tsv([[
    { text: 'weather', left: 10 }, { text: 'boston', left: 80 },
    { text: '812', left: 400 }, { text: '3,905', left: 500 },
    { text: '20.79%', left: 600 }, { text: '2.98', left: 700 },
  ]]);
  const rows = searchRowsFromTsv(withHeader.split('\n').slice(1).join('\n'), 'three.jpg');
  assert.deepEqual(rows[0]?.cells, ['weather boston', '812', '3,905', '20.79%', '2.98']);
});

test('deduplicates overlapping screenshots and caps the report at twenty rows', () => {
  const row = (index: number): SearchOcrRow => ({
    cells: [`query ${index}`, String(index), '100', '1%', '2'], confidence: 90, source: `${index}.jpg`,
  });
  const merged = mergeSearchOcrRows([
    Array.from({ length: 15 }, (_, index) => row(index)),
    Array.from({ length: 15 }, (_, index) => row(index + 10)),
  ]);
  assert.equal(merged.length, 20);
  assert.equal(merged[10].cells[0], 'query 10');
  assert.equal(merged[19].cells[0], 'query 19');
});
