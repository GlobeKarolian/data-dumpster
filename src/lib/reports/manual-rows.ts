import { MANUAL_SECTIONS, type ManualTable } from './types';
import { parseTable } from './tsv';

const SEARCH_SECTION_IDS = new Set(['globeSearch', 'bostonSearch']);

/**
 * Return the complete saved row set for presentation, evidence, and exports.
 *
 * Search tables saved before header-aware parsing may contain the raw eight-column
 * Looker table squeezed into the old five-column shape. Re-reading their retained
 * raw paste repairs those reports without asking the editor to paste them again.
 */
export function reportManualRows(sectionId: string, table: ManualTable | undefined): string[][] {
  if (!table) return [];
  if (SEARCH_SECTION_IDS.has(sectionId) && table.raw.trim()) {
    const spec = MANUAL_SECTIONS.find((section) => section.id === sectionId);
    if (spec) {
      const parsed = parseTable(table.raw, spec.columns);
      if (parsed.headerDropped) return parsed.rows;
    }
  }
  return table.rows;
}
