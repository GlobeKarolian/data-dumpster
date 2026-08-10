/**
 * A sectioned CSV rendering of the complete weekly report.
 *
 * This is intentionally built from ReportDocument rather than querying the
 * warehouse again. The stored computed block is the report's fact sheet, so an
 * export can never quietly disagree with the version an editor reviewed.
 */
import {
  MANUAL_FIGURES,
  MANUAL_SECTIONS,
  NARRATIVE_SECTIONS,
  REPORT_PLATFORMS,
  REPORT_PLATFORM_LABELS,
  type ComputedBlock,
} from '@/lib/reports/types';
import { reportManualRows } from '@/lib/reports/manual-rows';
import { executiveLines, type ReportDocument } from '@/lib/reports/render';

export type CsvValue = string | number | boolean | null | undefined;

const FORMULA_LEAD = /^\s*[=+\-@]/;

/**
 * RFC 4180 cell encoding with spreadsheet-formula neutralization.
 *
 * Numbers stay unquoted so spreadsheet software imports them as numbers.
 * Strings are always quoted because post and narrative text routinely contain
 * commas, quotes, and line breaks. Numeric strings supplied in a manual section
 * remain strings; the exporter must not reinterpret human-entered data.
 */
export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('A report export cannot contain a non-finite number.');
    }
    return String(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';

  const safe = FORMULA_LEAD.test(value) ? "'" + value : value;
  return '"' + safe.replace(/"/g, '""') + '"';
}

function csvRow(values: CsvValue[]): string {
  return values.map(csvCell).join(',');
}

class SectionedCsv {
  private readonly rows: string[] = [];

  section(title: string, columns: string[], data: CsvValue[][]): void {
    if (this.rows.length > 0) this.rows.push('');
    this.rows.push(csvRow([title]));
    this.rows.push(csvRow(columns));
    for (const row of data) this.rows.push(csvRow(row));
  }

  render(): string {
    // The BOM makes Excel detect UTF-8 reliably without changing the CSV data.
    return '\uFEFF' + this.rows.join('\r\n') + '\r\n';
  }
}

function rowsForManualSection(
  doc: ReportDocument,
  sectionId: string,
  width: number,
): CsvValue[][] {
  const rows = reportManualRows(sectionId, doc.manual.tables[sectionId]);
  return rows.map((source) => {
    const row: CsvValue[] = [];
    for (let index = 0; index < width; index += 1) row.push(source[index] ?? '');
    return row;
  });
}

/**
 * Render a report as a workbook-friendly CSV with independent named sections.
 *
 * Percent-change columns are explicitly labelled as fractions: 0.12 means
 * twelve percent. A null comparison remains an empty cell and is never coerced
 * to zero, Infinity, or a fabricated percentage.
 */
export function renderReportCsv(doc: ReportDocument): string {
  const csv = new SectionedCsv();

  csv.section('Report metadata', ['field', 'value'], [
    ['title', doc.title],
    ['organization', doc.orgName],
    ['period_start', doc.period.start],
    ['period_end', doc.period.end],
    ['data_note', doc.dataNote],
    ['computed_status', doc.computed ? 'available' : 'not available'],
    ['computed_generated_at', doc.computed?.generatedAt],
    ['landscape', doc.computed?.landscape.name],
  ]);

  const summary = executiveLines(doc);
  csv.section(
    'Executive summary',
    ['label', 'statement'],
    summary.map((line) => [line.label, line.value]),
  );

  const computed = doc.computed;
  if (computed) {
    csv.section('Focus performance', [
      'metric',
      'current_value',
      'previous_value',
      'change_pct_fraction',
      'direction',
    ], [
      [
        'followers',
        computed.focus.followers.value,
        computed.focus.followers.previousValue,
        computed.focus.followers.changePct,
        computed.focus.followers.direction,
      ],
      [
        'net_followers',
        computed.focus.netFollowers,
        computed.focus.previousNetFollowers,
        null,
        '',
      ],
      [
        'engagement_total',
        computed.focus.engagementTotal.value,
        computed.focus.engagementTotal.previousValue,
        computed.focus.engagementTotal.changePct,
        computed.focus.engagementTotal.direction,
      ],
      [
        'posts',
        computed.focus.posts.value,
        computed.focus.posts.previousValue,
        computed.focus.posts.changePct,
        computed.focus.posts.direction,
      ],
      [
        'engagement_per_post',
        computed.focus.engagementPerPost.value,
        computed.focus.engagementPerPost.previousValue,
        computed.focus.engagementPerPost.changePct,
        computed.focus.engagementPerPost.direction,
      ],
    ]);

    csv.section('Portfolio performance', [
      'metric',
      'current_value',
      'previous_value',
      'change_pct_fraction',
      'direction',
    ], [
      [
        'followers',
        computed.portfolio.followers.value,
        computed.portfolio.followers.previousValue,
        computed.portfolio.followers.changePct,
        computed.portfolio.followers.direction,
      ],
      ['net_followers', computed.portfolio.netFollowers, null, null, ''],
      [
        'engagement_total',
        computed.portfolio.engagementTotal.value,
        computed.portfolio.engagementTotal.previousValue,
        computed.portfolio.engagementTotal.changePct,
        computed.portfolio.engagementTotal.direction,
      ],
      [
        'posts',
        computed.portfolio.posts.value,
        computed.portfolio.posts.previousValue,
        computed.portfolio.posts.changePct,
        computed.portfolio.posts.direction,
      ],
      [
        'engagement_per_post',
        computed.portfolio.engagementPerPost.value,
        computed.portfolio.engagementPerPost.previousValue,
        computed.portfolio.engagementPerPost.changePct,
        computed.portfolio.engagementPerPost.direction,
      ],
    ]);

    csv.section('Owned brand leaderboard', [
      'rank',
      'company_id',
      'brand',
      'is_bgm_owned',
      'total_followers',
      'previous_total_followers',
      'net_change',
      'change_pct_fraction',
      ...REPORT_PLATFORMS.map((platform) => (
        REPORT_PLATFORM_LABELS[platform].toLowerCase() + '_followers'
      )),
    ], computed.brands.map((brand) => [
      brand.rank,
      brand.companyId,
      brand.name,
      brand.isBgmOwned ?? false,
      brand.totalFollowers,
      brand.previousTotalFollowers,
      brand.netChange,
      brand.changePct,
      ...REPORT_PLATFORMS.map((platform) => brand.byPlatform[platform]),
    ]));

    const topPostColumns = [
      'rank',
      'post_id',
      'company',
      'is_bgm_owned',
      'platform',
      'posted_at',
      'engagement_total',
      'text',
      'permalink',
    ];
    const topPostRows = (posts: ComputedBlock['topPosts']) => posts.map((post) => [
      post.rank,
      post.id,
      post.companyName,
      post.isBgmOwned ?? false,
      post.platform,
      post.postedAt,
      post.engagementTotal,
      post.text,
      post.permalink,
    ]);
    csv.section('Top posts — market', topPostColumns, topPostRows(computed.topPosts));
    csv.section('Top posts — BGM', topPostColumns, topPostRows(computed.bgmTopPosts ?? []));

    csv.section('Cohort summary', ['field', 'value'], [
      ['landscape', computed.cohort.landscapeName],
      ['focus_company', computed.cohort.focusCompanyName],
      ['focus_rank', computed.cohort.focusRank],
      ['member_count', computed.cohort.memberCount],
      ['engagement_total', computed.cohort.engagement.value],
      ['previous_engagement_total', computed.cohort.engagement.previousValue],
      ['engagement_change_pct_fraction', computed.cohort.engagement.changePct],
      ['engagement_direction', computed.cohort.engagement.direction],
      ['focus_post_rank', computed.cohort.focusPostRank],
      ['focus_post_pool', computed.cohort.focusPostPool],
    ]);

    csv.section('Cohort leaderboard', [
      'rank',
      'company_id',
      'company',
      'engagement_total',
      'change_pct_fraction',
      'is_focus',
      'is_bgm_owned',
    ], computed.cohort.rows.map((company) => [
      company.rank,
      company.companyId,
      company.name,
      company.engagementTotal,
      company.changePct,
      company.isFocus,
      company.isBgmOwned ?? false,
    ]));

    csv.section(
      'Measurement notes',
      ['note'],
      computed.caveats.map((note) => [note]),
    );
  }

  csv.section('Manual figures', ['id', 'group', 'measure', 'value'], MANUAL_FIGURES.map((figure) => [
    figure.id,
    figure.group,
    figure.label,
    doc.manual.figures[figure.id] ?? '',
  ]));

  for (const spec of MANUAL_SECTIONS) {
    csv.section(
      'Manual table: ' + spec.title,
      spec.columns.map((column) => column.label),
      rowsForManualSection(doc, spec.id, spec.columns.length),
    );
  }

  const knownNarratives = new Set(NARRATIVE_SECTIONS.map((section) => section.id));
  const narrativeRows: CsvValue[][] = NARRATIVE_SECTIONS.map((section) => [
    section.id,
    section.title,
    doc.narrative[section.id] ?? '',
  ]);
  for (const id of Object.keys(doc.narrative).filter((id) => !knownNarratives.has(id)).sort()) {
    narrativeRows.push([id, id, doc.narrative[id]]);
  }
  csv.section('Narrative', ['section_id', 'section', 'text'], narrativeRows);

  return csv.render();
}
