/**
 * Turning a report into the thing that actually gets sent.
 *
 * The delivery mechanism for this artefact is a paste into a Google Doc, so the
 * export is not a nice-to-have bolted on at the end -- it is the product. Two
 * formats are produced from one document model: HTML written for the Google Docs
 * clipboard parser, and Markdown for Slack, email and version control.
 *
 * The HTML is deliberately old-fashioned. Google Docs ignores stylesheets and
 * most of CSS layout on paste; what survives is inline styles on table, tr and
 * td, plus heading tags. So there are no classes, no flexbox, no custom
 * properties, and every border is written on the cell. It looks like 2004 and it
 * pastes perfectly, which is the only test that matters here.
 */
import {
  MANUAL_FIGURES,
  MANUAL_SECTIONS,
  NARRATIVE_SECTIONS,
  REPORT_PLATFORMS,
  REPORT_PLATFORM_LABELS,
  periodLabel,
  type ComputedBlock,
  type ManualState,
  type NarrativeBlock,
  type Period,
} from './types';

export type ReportDocument = {
  title: string;
  orgName: string;
  period: Period;
  dataNote: string | null;
  computed: ComputedBlock | null;
  manual: ManualState;
  narrative: NarrativeBlock;
};

/* ------------------------------------------------------------- formatting */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a';
  return Math.round(value).toLocaleString('en-US');
}

export function formatSignedCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a';
  if (value === 0) return '0';
  return (value > 0 ? '+' : '-') + Math.round(Math.abs(value)).toLocaleString('en-US');
}

export function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a';
  const pct = value * 100;
  const digits = Math.abs(pct) >= 10 ? 0 : 1;
  return (pct > 0 ? '+' : pct < 0 ? '-' : '') + Math.abs(pct).toFixed(digits) + '%';
}

export function formatRate(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a';
  return value.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

/**
 * "up 12%" / "down 4%" / "flat" / "against no baseline".
 *
 * A change above 1000 percent is always a near-zero baseline, and printing the
 * figure turns a rounding artefact into a headline. Those are described in
 * words instead, which is the same rule the AI prompts enforce on the model.
 */
export function describeDirection(changePct: number | null | undefined): string {
  if (changePct === null || changePct === undefined || !Number.isFinite(changePct)) {
    return 'against no comparable baseline';
  }
  if (Math.abs(changePct) < 0.005) return 'flat week over week';
  if (Math.abs(changePct) >= 10) {
    return (changePct > 0 ? 'up sharply' : 'down sharply') + ' from a very low prior week';
  }
  return (changePct > 0 ? 'up ' : 'down ') + formatPct(Math.abs(changePct)).replace('+', '')
    + ' week over week';
}

function figureValue(manual: ManualState, id: string): string {
  const raw = manual.figures[id];
  return raw && raw.trim().length > 0 ? raw.trim() : '';
}

/* ------------------------------------------------------------- the model */

type Line = { label: string; value: string };

/** The executive summary bullets, exactly the ones the printed artefact carries. */
export function executiveLines(doc: ReportDocument): Line[] {
  const out: Line[] = [];
  const c = doc.computed;
  if (c) {
    const brand = c.focus.companyName ?? 'The portfolio';
    const audienceStatement = c.focus.netFollowers === null
      ? brand + ' did not have enough audience history to compute net follower change. '
      : brand + ' gained ' + formatSignedCount(c.focus.netFollowers) + ' net followers. ';
    out.push({
      label: 'Performance',
      value: audienceStatement
        + 'Engagement was ' + formatCount(c.focus.engagementTotal.value) + ', '
        + describeDirection(c.focus.engagementTotal.changePct) + ', across '
        + formatCount(c.focus.posts.value) + ' posts, or '
        + formatRate(c.focus.engagementPerPost.value) + ' per post.',
    });
    if (c.topPosts.length > 0) {
      out.push({
        label: 'Most engaged posts',
        value: c.topPosts
          .map((p) => p.companyName + ' on ' + p.platform + ' (' + formatCount(p.engagementTotal) + ')')
          .join('; ') + '.',
      });
    }
    const rank = c.cohort.focusRank;
    out.push({
      label: 'Boston news cohort',
      value: 'Cohort engagement was ' + formatCount(c.cohort.engagement.value) + ', '
        + describeDirection(c.cohort.engagement.changePct) + '.'
        + (rank ? ' ' + (c.cohort.focusCompanyName ?? 'The focus brand') + ' ranked '
          + rank + ' of ' + c.cohort.memberCount + '.' : '')
        + (c.cohort.focusPostRank
          ? ' Its best post ranked ' + c.cohort.focusPostRank + ' of the top '
            + c.cohort.focusPostPool + ' in the landscape.'
          : ''),
    });
  }

  const starts = figureValue(doc.manual, 'paidStarts');
  const cost = figureValue(doc.manual, 'paidCostPerStart');
  if (starts || cost) {
    out.push({
      label: 'Paid promotion',
      value: (starts ? starts + ' subscription starts year to date' : 'Starts not reported')
        + (cost ? ' at a blended ' + cost + ' per start.' : '.'),
    });
  }

  const apple = MANUAL_FIGURES
    .filter((f) => f.group === 'appleNews')
    .map((f) => ({ label: f.label, value: figureValue(doc.manual, f.id) }))
    .filter((f) => f.value.length > 0);
  if (apple.length > 0) {
    out.push({
      label: 'Boston.com Apple News',
      value: apple.map((f) => f.label.toLowerCase() + ' ' + f.value).join(', ') + '.',
    });
  }

  return out;
}

/* ------------------------------------------------------------ table model */

type Cell = { text: string; numeric?: boolean };
type TableModel = { columns: { label: string; numeric?: boolean }[]; rows: Cell[][] };

function brandTable(computed: ComputedBlock): TableModel {
  return {
    columns: [
      { label: 'Brand' },
      { label: 'Total Followers', numeric: true },
      { label: 'Net Change', numeric: true },
      ...REPORT_PLATFORMS.map((p) => ({ label: REPORT_PLATFORM_LABELS[p], numeric: true })),
    ],
    rows: computed.brands.map((b) => [
      { text: b.name },
      { text: formatCount(b.totalFollowers), numeric: true },
      { text: formatSignedCount(b.netChange), numeric: true },
      ...REPORT_PLATFORMS.map((p) => ({
        text: b.byPlatform[p] === undefined ? '-' : formatCount(b.byPlatform[p]),
        numeric: true,
      })),
    ]),
  };
}

function cohortTable(computed: ComputedBlock): TableModel {
  return {
    columns: [
      { label: 'Rank', numeric: true },
      { label: 'Brand' },
      { label: 'Engagement', numeric: true },
      { label: 'Week over Week', numeric: true },
    ],
    rows: computed.cohort.rows.map((r) => [
      { text: String(r.rank), numeric: true },
      { text: r.isFocus ? r.name + ' (us)' : r.name },
      { text: formatCount(r.engagementTotal), numeric: true },
      { text: formatPct(r.changePct), numeric: true },
    ]),
  };
}

function topPostTable(computed: ComputedBlock): TableModel {
  return {
    columns: [
      { label: 'Rank', numeric: true },
      { label: 'Brand' },
      { label: 'Platform' },
      { label: 'Post' },
      { label: 'Engagement', numeric: true },
    ],
    rows: computed.topPosts.map((p) => [
      { text: String(p.rank), numeric: true },
      { text: p.companyName },
      { text: p.platform },
      { text: (p.text ?? '').slice(0, 160) || (p.permalink ?? 'Untitled post') },
      { text: formatCount(p.engagementTotal), numeric: true },
    ]),
  };
}

function manualTable(id: string, manual: ManualState): TableModel | null {
  const spec = MANUAL_SECTIONS.find((s) => s.id === id);
  if (!spec) return null;
  const table = manual.tables[id];
  if (!table || table.rows.length === 0) return null;
  return {
    columns: spec.columns.map((c) => ({ label: c.label, numeric: c.numeric })),
    rows: table.rows.map((row) => row.map((text, i) => ({ text, numeric: spec.columns[i]?.numeric }))),
  };
}

/* -------------------------------------------------------------- HTML pass */

const TD = 'border:1px solid #d4d4d8;padding:5px 9px;font-size:10pt;';
const TH = TD + 'background:#f4f4f5;font-weight:700;';

function htmlTable(model: TableModel): string {
  const head = model.columns
    .map((c) => '<td style="' + TH + (c.numeric ? 'text-align:right;' : '') + '">'
      + escapeHtml(c.label) + '</td>')
    .join('');
  const body = model.rows
    .map((row) => '<tr>' + row
      .map((cell) => '<td style="' + TD + (cell.numeric ? 'text-align:right;' : '') + '">'
        + escapeHtml(cell.text) + '</td>')
      .join('') + '</tr>')
    .join('');
  return '<table style="border-collapse:collapse;width:100%;margin:8px 0 16px;">'
    + '<tr>' + head + '</tr>' + body + '</table>';
}

function htmlHeading(text: string): string {
  return '<h2 style="font-size:13pt;margin:20px 0 6px;font-weight:700;">' + escapeHtml(text) + '</h2>';
}

function htmlParagraph(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) => '<p style="font-size:11pt;line-height:1.45;margin:0 0 10px;">'
      + escapeHtml(block.trim()).replace(/\n/g, '<br>') + '</p>')
    .join('');
}

function narrativeHtml(doc: ReportDocument, id: string): string {
  const text = (doc.narrative[id] ?? '').trim();
  return text ? htmlParagraph(text) : '';
}

/** The whole report as clipboard HTML. Inline styles only, by necessity. */
export function renderReportHtml(doc: ReportDocument): string {
  const parts: string[] = [];
  parts.push('<div style="font-family:Arial,Helvetica,sans-serif;color:#18181b;">');
  parts.push('<p style="font-size:9pt;font-weight:700;letter-spacing:.08em;color:#b91c1c;margin:0;">'
    + 'DO NOT FORWARD - CONFIDENTIAL</p>');
  parts.push('<p style="font-size:10pt;margin:2px 0 0;color:#52525b;">'
    + escapeHtml(doc.orgName) + '</p>');
  parts.push('<h1 style="font-size:17pt;margin:6px 0 2px;font-weight:700;">'
    + escapeHtml(doc.title) + '</h1>');
  parts.push('<p style="font-size:10pt;margin:0 0 14px;color:#52525b;">'
    + escapeHtml(periodLabel(doc.period)) + '</p>');

  if (doc.dataNote && doc.dataNote.trim()) {
    parts.push('<table style="border-collapse:collapse;width:100%;margin:0 0 16px;"><tr>'
      + '<td style="border:1px solid #f59e0b;background:#fffbeb;padding:8px 10px;font-size:10pt;">'
      + '<strong>IMPORTANT NOTE:</strong> ' + escapeHtml(doc.dataNote.trim())
      + '</td></tr></table>');
  }

  parts.push(htmlHeading('Executive Summary'));
  parts.push(narrativeHtml(doc, 'executiveSummary'));
  const lines = executiveLines(doc);
  if (lines.length > 0) {
    parts.push('<ul style="font-size:11pt;line-height:1.45;margin:0 0 12px;padding-left:20px;">'
      + lines.map((l) => '<li><strong>' + escapeHtml(l.label) + ':</strong> '
        + escapeHtml(l.value) + '</li>').join('')
      + '</ul>');
  }

  if (doc.computed) {
    parts.push(htmlHeading('Owned Brands Key Metrics'));
    parts.push(narrativeHtml(doc, 'brands'));
    parts.push(htmlTable(brandTable(doc.computed)));
    if (doc.computed.topPosts.length > 0) {
      parts.push(htmlHeading('Top Engaged Posts'));
      parts.push(htmlTable(topPostTable(doc.computed)));
    }
  }

  // One narrative covers several tables (search covers two, referral covers three),
  // so it is emitted above the first table of its group and not repeated.
  const proseUsed = new Set<string>();
  for (const spec of MANUAL_SECTIONS) {
    const model = manualTable(spec.id, doc.manual);
    const narrativeId = NARRATIVE_SECTIONS
      .find((n) => n.sources.manualTables.includes(spec.id))?.id;
    const prose = narrativeId && !proseUsed.has(narrativeId)
      ? (doc.narrative[narrativeId] ?? '').trim()
      : '';
    if (!model && !prose) continue;
    parts.push(htmlHeading(spec.title));
    if (prose && narrativeId) {
      proseUsed.add(narrativeId);
      parts.push(htmlParagraph(prose));
    }
    if (model) parts.push(htmlTable(model));
  }

  const paidProse = (doc.narrative.paid ?? '').trim();
  const paidFigures = MANUAL_FIGURES
    .map((f) => ({ spec: f, value: figureValue(doc.manual, f.id) }))
    .filter((f) => f.value.length > 0);
  if (paidProse || paidFigures.length > 0) {
    parts.push(htmlHeading('Paid Promotion and Apple News'));
    if (paidProse) parts.push(htmlParagraph(paidProse));
    if (paidFigures.length > 0) {
      parts.push(htmlTable({
        columns: [{ label: 'Measure' }, { label: 'Value', numeric: true }],
        rows: paidFigures.map((f) => [{ text: f.spec.label }, { text: f.value, numeric: true }]),
      }));
    }
  }

  if (doc.computed) {
    parts.push(htmlHeading('Boston News Landscape'));
    parts.push(narrativeHtml(doc, 'cohort'));
    parts.push(htmlTable(cohortTable(doc.computed)));
    if (doc.computed.caveats.length > 0) {
      parts.push('<p style="font-size:9pt;color:#71717a;margin:0 0 8px;"><strong>Measurement notes:</strong> '
        + escapeHtml(doc.computed.caveats.join(' ')) + '</p>');
    }
    parts.push('<p style="font-size:9pt;color:#a1a1aa;margin:12px 0 0;">Computed figures generated '
      + escapeHtml(new Date(doc.computed.generatedAt).toLocaleString('en-US'))
      + ' from ' + escapeHtml(doc.computed.landscape.name) + '.</p>');
  }

  parts.push('</div>');
  return parts.join('');
}

/* ---------------------------------------------------------- Markdown pass */

function mdTable(model: TableModel): string {
  const header = '| ' + model.columns.map((c) => c.label).join(' | ') + ' |';
  const rule = '| ' + model.columns.map((c) => (c.numeric ? '---:' : ':---')).join(' | ') + ' |';
  const body = model.rows
    .map((row) => '| ' + row.map((cell) => cell.text.replace(/\|/g, '\\|')).join(' | ') + ' |')
    .join('\n');
  return [header, rule, body].filter(Boolean).join('\n');
}

/** The same document as Markdown, for Slack, email and anything diffable. */
export function renderReportMarkdown(doc: ReportDocument): string {
  const out: string[] = [];
  out.push('**DO NOT FORWARD - CONFIDENTIAL**');
  out.push(doc.orgName);
  out.push('# ' + doc.title);
  out.push(periodLabel(doc.period));

  if (doc.dataNote && doc.dataNote.trim()) {
    out.push('> **IMPORTANT NOTE:** ' + doc.dataNote.trim());
  }

  out.push('## Executive Summary');
  const summaryProse = (doc.narrative.executiveSummary ?? '').trim();
  if (summaryProse) out.push(summaryProse);
  for (const line of executiveLines(doc)) out.push('- **' + line.label + ':** ' + line.value);

  if (doc.computed) {
    out.push('## Owned Brands Key Metrics');
    const brandProse = (doc.narrative.brands ?? '').trim();
    if (brandProse) out.push(brandProse);
    out.push(mdTable(brandTable(doc.computed)));
    if (doc.computed.topPosts.length > 0) {
      out.push('## Top Engaged Posts');
      out.push(mdTable(topPostTable(doc.computed)));
    }
  }

  const proseUsed = new Set<string>();
  for (const spec of MANUAL_SECTIONS) {
    const model = manualTable(spec.id, doc.manual);
    const narrativeId = NARRATIVE_SECTIONS
      .find((n) => n.sources.manualTables.includes(spec.id))?.id;
    const prose = narrativeId && !proseUsed.has(narrativeId)
      ? (doc.narrative[narrativeId] ?? '').trim()
      : '';
    if (!model && !prose) continue;
    out.push('## ' + spec.title);
    if (prose && narrativeId) { proseUsed.add(narrativeId); out.push(prose); }
    if (model) out.push(mdTable(model));
  }

  const paidProse = (doc.narrative.paid ?? '').trim();
  const paidFigures = MANUAL_FIGURES
    .map((f) => ({ spec: f, value: figureValue(doc.manual, f.id) }))
    .filter((f) => f.value.length > 0);
  if (paidProse || paidFigures.length > 0) {
    out.push('## Paid Promotion and Apple News');
    if (paidProse) out.push(paidProse);
    if (paidFigures.length > 0) {
      out.push(mdTable({
        columns: [{ label: 'Measure' }, { label: 'Value', numeric: true }],
        rows: paidFigures.map((f) => [{ text: f.spec.label }, { text: f.value, numeric: true }]),
      }));
    }
  }

  if (doc.computed) {
    out.push('## Boston News Landscape');
    const cohortProse = (doc.narrative.cohort ?? '').trim();
    if (cohortProse) out.push(cohortProse);
    out.push(mdTable(cohortTable(doc.computed)));
    if (doc.computed.caveats.length > 0) {
      out.push('_Measurement notes: ' + doc.computed.caveats.join(' ') + '_');
    }
    out.push('_Computed figures generated '
      + new Date(doc.computed.generatedAt).toLocaleString('en-US')
      + ' from ' + doc.computed.landscape.name + '._');
  }

  return out.join('\n\n') + '\n';
}
