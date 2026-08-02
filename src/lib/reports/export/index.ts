import { slugify } from '@/lib/utils';
import type { ReportDocument } from '@/lib/reports/render';

export { renderReportCsv } from './csv';
export { renderReportPptx } from './pptx';

export function reportExportFilename(
  doc: ReportDocument,
  format: 'csv' | 'pptx',
): string {
  const title = slugify(doc.title) || 'weekly-social-report';
  return [
    'data-dumpster',
    title,
    doc.period.start,
    'to',
    doc.period.end,
  ].join('-') + '.' + format;
}
