/**
 * PowerPoint rendering for the reviewed weekly report.
 *
 * The deck consumes only ReportDocument. It never calls the metrics layer and
 * never asks a model to calculate or restate a number, which keeps the download
 * tied to the exact fact sheet the editor approved in the report builder.
 */
import PptxGenJS from 'pptxgenjs';
import {
  MANUAL_FIGURES,
  MANUAL_SECTIONS,
  NARRATIVE_SECTIONS,
  REPORT_PLATFORMS,
  REPORT_PLATFORM_LABELS,
  periodLabel,
  reportManualRows,
  type Movement,
  type ReportPlatform,
} from '@/lib/reports/types';
import {
  executiveLines,
  formatCount,
  formatPct,
  formatRate,
  formatSignedCount,
  type ReportDocument,
} from '@/lib/reports/render';

const COLORS = {
  ink: '1E2933',
  inkSoft: '3F4C56',
  paper: 'F7F5F1',
  white: 'FFFFFF',
  line: 'D9D6CF',
  muted: '6D777F',
  light: 'ECE9E3',
  red: 'C64E43',
  redDark: '8E342E',
  coral: 'E68170',
  teal: '3E9183',
  blue: '4B82A5',
  green: '3D8A64',
  amber: 'C58B2B',
  warning: 'FFF1CF',
} as const;

const SLIDE_W = 13.333;
const SLIDE_H = 7.5;
const MARGIN_X = 0.62;
const CONTENT_W = SLIDE_W - MARGIN_X * 2;
const BODY_FONT = 'Aptos';
const HEAD_FONT = 'Aptos Display';

type Slide = PptxGenJS.Slide;
type CellAlign = 'left' | 'center' | 'right';

// ShapeType is exposed on a deck instance at runtime. Literals avoid creating a
// throwaway deck solely to read the enum while retaining the library's types.
const SHAPE = {
  ellipse: 'ellipse' as PptxGenJS.ShapeType,
  line: 'line' as PptxGenJS.ShapeType,
  rect: 'rect' as PptxGenJS.ShapeType,
  roundRect: 'roundRect' as PptxGenJS.ShapeType,
};

type TableColumn = {
  label: string;
  width: number;
  align?: CellAlign;
};

function addText(
  slide: Slide,
  text: string,
  options: PptxGenJS.TextPropsOptions,
): void {
  slide.addText(text, {
    fontFace: BODY_FONT,
    color: COLORS.ink,
    margin: 0,
    breakLine: false,
    ...options,
  });
}

function addRect(
  slide: Slide,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  line = fill,
  radius = true,
): void {
  slide.addShape(radius ? SHAPE.roundRect : SHAPE.rect, {
    x,
    y,
    w,
    h,
    rectRadius: radius ? 0.08 : undefined,
    fill: { color: fill },
    line: { color: line, width: 0.7 },
  });
}

function addSlideFrame(
  slide: Slide,
  section: string,
  title: string,
  subtitle: string,
  page: number,
): void {
  slide.background = { color: COLORS.paper };
  addText(slide, section.toUpperCase(), {
    x: MARGIN_X,
    y: 0.27,
    w: 3.5,
    h: 0.2,
    fontFace: HEAD_FONT,
    fontSize: 9,
    bold: true,
    charSpacing: 1.8,
    color: COLORS.red,
  });
  addText(slide, title, {
    x: MARGIN_X,
    y: 0.53,
    w: 8.9,
    h: 0.44,
    fontFace: HEAD_FONT,
    fontSize: title.length > 62 ? 16 : title.length > 46 ? 19 : 24,
    bold: true,
    wrap: false,
    fit: 'shrink',
  });
  addText(slide, subtitle, {
    x: 9.55,
    y: 0.61,
    w: 3.16,
    h: 0.24,
    fontSize: 9.5,
    color: COLORS.muted,
    align: 'right',
    fit: 'shrink',
  });
  slide.addShape(SHAPE.line, {
    x: MARGIN_X,
    y: 1.09,
    w: CONTENT_W,
    h: 0,
    line: { color: COLORS.line, width: 1 },
  });
  addText(slide, 'DATA DUMPSTER  /  CONFIDENTIAL', {
    x: MARGIN_X,
    y: 7.16,
    w: 4,
    h: 0.14,
    fontSize: 7.5,
    bold: true,
    color: COLORS.muted,
    charSpacing: 0.8,
  });
  addText(slide, String(page).padStart(2, '0'), {
    x: 12.2,
    y: 7.14,
    w: 0.5,
    h: 0.16,
    fontSize: 8,
    color: COLORS.muted,
    align: 'right',
  });
}

function truncate(value: string, max: number): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}

function platformLabel(platform: string): string {
  if (REPORT_PLATFORMS.includes(platform as ReportPlatform)) {
    return REPORT_PLATFORM_LABELS[platform as ReportPlatform];
  }
  return platform.charAt(0).toUpperCase() + platform.slice(1);
}

function movementTone(movement: Movement): string {
  if (movement.changePct === null) return COLORS.muted;
  if (movement.direction === 'up') return COLORS.green;
  if (movement.direction === 'down') return COLORS.red;
  return COLORS.muted;
}

function movementLabel(movement: Movement): string {
  return movement.changePct === null ? 'No comparable baseline' : formatPct(movement.changePct);
}

function addKpiCard(
  slide: Slide,
  x: number,
  y: number,
  w: number,
  label: string,
  value: string,
  comparison: string,
  comparisonColor: string,
): void {
  addRect(slide, x, y, w, 1.14, COLORS.white, COLORS.line);
  addText(slide, label.toUpperCase(), {
    x: x + 0.18,
    y: y + 0.17,
    w: w - 0.36,
    h: 0.17,
    fontSize: 8,
    bold: true,
    charSpacing: 0.8,
    color: COLORS.muted,
    fit: 'shrink',
  });
  addText(slide, value, {
    x: x + 0.18,
    y: y + 0.38,
    w: w - 0.36,
    h: 0.36,
    fontFace: HEAD_FONT,
    fontSize: 22,
    bold: true,
    fit: 'shrink',
  });
  addText(slide, comparison, {
    x: x + 0.18,
    y: y + 0.84,
    w: w - 0.36,
    h: 0.16,
    fontSize: 8.5,
    bold: true,
    color: comparisonColor,
    fit: 'shrink',
  });
}

function addSimpleTable(
  slide: Slide,
  columns: TableColumn[],
  rows: string[][],
  options: {
    x: number;
    y: number;
    rowHeight: number;
    focusRows?: Set<number>;
    fontSize?: number;
  },
): void {
  const { x, y, rowHeight } = options;
  let cursorX = x;
  for (const column of columns) {
    addRect(slide, cursorX, y, column.width, rowHeight, COLORS.ink, COLORS.ink, false);
    addText(slide, column.label, {
      x: cursorX + 0.08,
      y: y + 0.02,
      w: column.width - 0.16,
      h: rowHeight - 0.04,
      fontSize: 8,
      bold: true,
      color: COLORS.white,
      align: column.align ?? 'left',
      valign: 'middle',
      fit: 'shrink',
    });
    cursorX += column.width;
  }

  rows.forEach((row, rowIndex) => {
    cursorX = x;
    const focus = options.focusRows?.has(rowIndex) ?? false;
    const fill = focus
      ? 'F8E3DF'
      : rowIndex % 2 === 0 ? COLORS.white : 'F1EFEA';
    columns.forEach((column, columnIndex) => {
      addRect(
        slide,
        cursorX,
        y + rowHeight * (rowIndex + 1),
        column.width,
        rowHeight,
        fill,
        COLORS.line,
        false,
      );
      addText(slide, row[columnIndex] ?? '', {
        x: cursorX + 0.08,
        y: y + rowHeight * (rowIndex + 1) + 0.02,
        w: column.width - 0.16,
        h: rowHeight - 0.04,
        fontSize: options.fontSize ?? 9,
        bold: focus && columnIndex === 1,
        color: focus && columnIndex === 1 ? COLORS.redDark : COLORS.ink,
        align: column.align ?? 'left',
        valign: 'middle',
        fit: 'shrink',
      });
      cursorX += column.width;
    });
  });
}

function addCover(pptx: PptxGenJS, doc: ReportDocument): number {
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.ink };
  slide.addShape(SHAPE.rect, {
    x: 0,
    y: 0,
    w: 0.24,
    h: SLIDE_H,
    fill: { color: COLORS.red },
    line: { color: COLORS.red },
  });
  slide.addShape(SHAPE.ellipse, {
    x: 9.58,
    y: 0.12,
    w: 3.55,
    h: 3.55,
    fill: { color: COLORS.red, transparency: 12 },
    line: { color: COLORS.red, transparency: 100 },
  });
  slide.addShape(SHAPE.ellipse, {
    x: 10.48,
    y: 1.02,
    w: 1.76,
    h: 1.76,
    fill: { color: COLORS.coral, transparency: 18 },
    line: { color: COLORS.coral, transparency: 100 },
  });
  addText(slide, 'DATA DUMPSTER', {
    x: 0.82,
    y: 0.63,
    w: 3.2,
    h: 0.25,
    fontFace: HEAD_FONT,
    fontSize: 11,
    bold: true,
    charSpacing: 2.1,
    color: COLORS.coral,
  });
  addText(slide, doc.title, {
    x: 0.82,
    y: 2.15,
    w: 8.9,
    h: 1.45,
    fontFace: HEAD_FONT,
    fontSize: 34,
    bold: true,
    color: COLORS.white,
    breakLine: false,
    fit: 'shrink',
    valign: 'middle',
  });
  addText(slide, periodLabel(doc.period), {
    x: 0.85,
    y: 3.83,
    w: 7.7,
    h: 0.38,
    fontSize: 16,
    color: 'D8DEE2',
    fit: 'shrink',
  });
  addText(slide, doc.orgName, {
    x: 0.85,
    y: 4.35,
    w: 7.7,
    h: 0.32,
    fontSize: 13,
    bold: true,
    color: COLORS.white,
  });
  addText(slide, 'Executive social performance report', {
    x: 0.85,
    y: 6.48,
    w: 4.5,
    h: 0.2,
    fontSize: 9,
    color: 'AEB8BE',
    charSpacing: 0.7,
  });
  addText(slide, 'CONFIDENTIAL', {
    x: 10.56,
    y: 6.48,
    w: 1.75,
    h: 0.2,
    fontSize: 9,
    bold: true,
    color: COLORS.coral,
    align: 'right',
    charSpacing: 1.2,
  });
  slide.addNotes('All figures in this deck are rendered from the report fact sheet.');
  return 1;
}

function addOverview(pptx: PptxGenJS, doc: ReportDocument, page: number): number {
  const slide = pptx.addSlide();
  addSlideFrame(
    slide,
    'Weekly signal',
    'Executive overview',
    periodLabel(doc.period),
    page,
  );

  const computed = doc.computed;
  if (!computed) {
    addRect(slide, MARGIN_X, 1.5, CONTENT_W, 2.1, COLORS.white, COLORS.line);
    addText(slide, 'Computed metrics are not available yet.', {
      x: 1.05,
      y: 2.05,
      w: 11.2,
      h: 0.4,
      fontFace: HEAD_FONT,
      fontSize: 24,
      bold: true,
      align: 'center',
    });
    addText(slide, 'Recompute the report after ingestion completes. Manual inputs and narrative remain in the appendix.', {
      x: 1.5,
      y: 2.62,
      w: 10.3,
      h: 0.36,
      fontSize: 12,
      color: COLORS.muted,
      align: 'center',
      fit: 'shrink',
    });
    return page + 1;
  }

  const focus = computed.focus;
  const cards = [
    {
      label: 'Audience',
      value: formatCount(focus.followers.value),
      comparison: movementLabel(focus.followers),
      color: movementTone(focus.followers),
    },
    {
      label: 'Net audience',
      value: formatSignedCount(focus.netFollowers),
      comparison: focus.previousNetFollowers === null
        ? 'No comparable baseline'
        : 'Prior ' + formatSignedCount(focus.previousNetFollowers),
      color: focus.netFollowers === null
        ? COLORS.muted
        : focus.netFollowers > 0 ? COLORS.green : focus.netFollowers < 0 ? COLORS.red : COLORS.muted,
    },
    {
      label: 'Engagement',
      value: formatCount(focus.engagementTotal.value),
      comparison: movementLabel(focus.engagementTotal),
      color: movementTone(focus.engagementTotal),
    },
    {
      label: 'Posts',
      value: formatCount(focus.posts.value),
      comparison: movementLabel(focus.posts),
      color: movementTone(focus.posts),
    },
    {
      label: 'Engagement / post',
      value: formatRate(focus.engagementPerPost.value),
      comparison: movementLabel(focus.engagementPerPost),
      color: movementTone(focus.engagementPerPost),
    },
  ];
  const gap = 0.14;
  const cardW = (CONTENT_W - gap * (cards.length - 1)) / cards.length;
  cards.forEach((card, index) => {
    addKpiCard(
      slide,
      MARGIN_X + index * (cardW + gap),
      1.38,
      cardW,
      card.label,
      card.value,
      card.comparison,
      card.color,
    );
  });

  const focusLabel = focus.companyName ?? 'Focus company';
  addText(slide, focusLabel, {
    x: MARGIN_X,
    y: 2.72,
    w: 4,
    h: 0.24,
    fontFace: HEAD_FONT,
    fontSize: 14,
    bold: true,
  });

  if (doc.dataNote?.trim()) {
    addRect(slide, MARGIN_X, 3.07, CONTENT_W, 0.61, COLORS.warning, 'E7C46F');
    addText(slide, 'DATA NOTE', {
      x: MARGIN_X + 0.18,
      y: 3.18,
      w: 0.9,
      h: 0.16,
      fontSize: 8,
      bold: true,
      color: COLORS.redDark,
      charSpacing: 0.7,
    });
    addText(slide, truncate(doc.dataNote, 360), {
      x: MARGIN_X + 1.12,
      y: 3.13,
      w: CONTENT_W - 1.32,
      h: 0.28,
      fontSize: 10,
      color: COLORS.inkSoft,
      fit: 'shrink',
    });
  }

  const narrative = (doc.narrative.executiveSummary ?? '').trim();
  const summaryY = doc.dataNote?.trim() ? 3.93 : 3.2;
  const summaryH = doc.dataNote?.trim() ? 2.74 : 3.47;
  addRect(slide, MARGIN_X, summaryY, 5.15, summaryH, COLORS.white, COLORS.line);
  addText(slide, 'EDITORIAL TAKEAWAY', {
    x: MARGIN_X + 0.22,
    y: summaryY + 0.2,
    w: 2.5,
    h: 0.18,
    fontSize: 8,
    bold: true,
    charSpacing: 0.9,
    color: COLORS.red,
  });
  addText(slide, narrative || 'No executive narrative has been added.', {
    x: MARGIN_X + 0.22,
    y: summaryY + 0.52,
    w: 4.7,
    h: summaryH - 0.74,
    fontSize: 13,
    color: narrative ? COLORS.ink : COLORS.muted,
    italic: !narrative,
    valign: 'top',
    breakLine: false,
    fit: 'shrink',
  });

  const lines = executiveLines(doc);
  addRect(slide, 5.98, summaryY, 6.73, summaryH, COLORS.ink, COLORS.ink);
  addText(slide, 'VERIFIED SIGNALS', {
    x: 6.23,
    y: summaryY + 0.2,
    w: 2.5,
    h: 0.18,
    fontSize: 8,
    bold: true,
    charSpacing: 0.9,
    color: COLORS.coral,
  });
  const visibleLines = lines.slice(0, 4);
  visibleLines.forEach((line, index) => {
    const lineY = summaryY + 0.58 + index * ((summaryH - 0.72) / Math.max(visibleLines.length, 1));
    addText(slide, line.label, {
      x: 6.23,
      y: lineY,
      w: 1.5,
      h: 0.18,
      fontSize: 9,
      bold: true,
      color: COLORS.white,
      fit: 'shrink',
    });
    addText(slide, truncate(line.value, 245), {
      x: 7.78,
      y: lineY - 0.02,
      w: 4.62,
      h: Math.min(0.58, (summaryH - 0.75) / Math.max(visibleLines.length, 1)),
      fontSize: 9.5,
      color: 'D8DEE2',
      valign: 'top',
      fit: 'shrink',
    });
  });

  slide.addNotes('Metrics are read directly from the stored computed report block.');
  return page + 1;
}

function addBrandSlides(pptx: PptxGenJS, doc: ReportDocument, startPage: number): number {
  const computed = doc.computed;
  if (!computed) return startPage;

  const fixedColumnWidth = 0.42 + 2.18 + 1.02 + 0.7 + 0.7;
  const platformColumnWidth = (CONTENT_W - fixedColumnWidth) / REPORT_PLATFORMS.length;
  const columns: TableColumn[] = [
    { label: '#', width: 0.42, align: 'center' },
    { label: 'Brand', width: 2.18 },
    { label: 'Followers', width: 1.02, align: 'right' },
    { label: 'Net', width: 0.7, align: 'right' },
    { label: 'Change', width: 0.7, align: 'right' },
    ...REPORT_PLATFORMS.map((platform) => ({
      label: REPORT_PLATFORM_LABELS[platform],
      width: platformColumnWidth,
      align: 'right' as const,
    })),
  ];
  const PAGE_SIZE = 12;
  let page = startPage;
  const chunks = computed.brands.length > 0
    ? Array.from(
      { length: Math.ceil(computed.brands.length / PAGE_SIZE) },
      (_, index) => computed.brands.slice(index * PAGE_SIZE, (index + 1) * PAGE_SIZE),
    )
    : [[]];

  chunks.forEach((brands, chunkIndex) => {
    const slide = pptx.addSlide();
    addSlideFrame(
      slide,
      'Owned brands',
      chunkIndex === 0 ? 'Audience leaderboard' : 'Audience leaderboard, continued',
      computed.landscape.name,
      page,
    );
    if (brands.length === 0) {
      addText(slide, 'No owned-brand rows are available for this report.', {
        x: MARGIN_X,
        y: 2.6,
        w: CONTENT_W,
        h: 0.4,
        fontSize: 18,
        color: COLORS.muted,
        align: 'center',
      });
    } else {
      const rows = brands.map((brand) => [
        brand.rank === null ? 'n/a' : String(brand.rank),
        brand.name,
        formatCount(brand.totalFollowers),
        formatSignedCount(brand.netChange),
        formatPct(brand.changePct),
        ...REPORT_PLATFORMS.map((platform) => (
          brand.byPlatform[platform] === undefined
            ? 'n/a'
            : formatCount(brand.byPlatform[platform])
        )),
      ]);
      const focusRows = new Set<number>();
      brands.forEach((brand, index) => {
        if (brand.isBgmOwned) focusRows.add(index);
      });
      addSimpleTable(slide, columns, rows, {
        x: MARGIN_X,
        y: 1.42,
        rowHeight: 0.42,
        focusRows,
        fontSize: 8.5,
      });
      addText(slide, 'Audience is the latest snapshot in the report window, never a sum of daily snapshots.', {
        x: MARGIN_X,
        y: 6.73,
        w: 8.5,
        h: 0.18,
        fontSize: 8,
        color: COLORS.muted,
        italic: true,
      });
    }
    page += 1;
  });
  return page;
}

function addTopPostSlides(pptx: PptxGenJS, doc: ReportDocument, startPage: number): number {
  const computed = doc.computed;
  if (!computed) return startPage;
  const PAGE_SIZE = 8;
  let page = startPage;
  const groups = [
    { title: 'Top engaged posts — market', posts: computed.topPosts },
    ...(computed.bgmTopPosts === undefined
      ? []
      : [{ title: 'Top engaged posts — BGM', posts: computed.bgmTopPosts }]),
  ];

  groups.forEach((group) => {
    const chunks = group.posts.length > 0
      ? Array.from(
        { length: Math.ceil(group.posts.length / PAGE_SIZE) },
        (_, index) => group.posts.slice(index * PAGE_SIZE, (index + 1) * PAGE_SIZE),
      )
      : [[]];

    chunks.forEach((posts, chunkIndex) => {
      const slide = pptx.addSlide();
      addSlideFrame(
        slide,
        'Content performance',
        chunkIndex === 0 ? group.title : group.title + ', continued',
        computed.landscape.name,
        page,
      );
      if (posts.length === 0) {
        addText(slide, 'No posts are available for this report window.', {
          x: MARGIN_X,
          y: 2.6,
          w: CONTENT_W,
          h: 0.4,
          fontSize: 18,
          color: COLORS.muted,
          align: 'center',
        });
      }
      posts.forEach((post, index) => {
        const column = index % 2;
        const row = Math.floor(index / 2);
        const cardW = 5.96;
        const x = MARGIN_X + column * 6.17;
        const y = 1.39 + row * 1.36;
        addRect(slide, x, y, cardW, 1.17, COLORS.white, COLORS.line);
        addRect(slide, x, y, 0.64, 1.17, post.isBgmOwned ? COLORS.red : COLORS.ink, undefined, false);
        addText(slide, String(post.rank), {
          x: x + 0.08,
          y: y + 0.36,
          w: 0.48,
          h: 0.34,
          fontFace: HEAD_FONT,
          fontSize: 19,
          bold: true,
          color: COLORS.white,
          align: 'center',
        });
        addText(slide, post.companyName + '  ·  ' + platformLabel(post.platform), {
          x: x + 0.82,
          y: y + 0.14,
          w: 3.55,
          h: 0.18,
          fontSize: 9.5,
          bold: true,
          color: post.isBgmOwned ? COLORS.redDark : COLORS.ink,
          fit: 'shrink',
        });
        addText(slide, formatCount(post.engagementTotal), {
          x: x + 4.42,
          y: y + 0.12,
          w: 1.23,
          h: 0.2,
          fontSize: 10,
          bold: true,
          color: COLORS.redDark,
          align: 'right',
          fit: 'shrink',
        });
        addText(slide, truncate(post.text || post.permalink || 'Untitled post', 170), {
          x: x + 0.82,
          y: y + 0.45,
          w: 4.83,
          h: 0.44,
          fontSize: 9.5,
          color: COLORS.inkSoft,
          valign: 'top',
          fit: 'shrink',
        });
        addText(slide, post.postedAt.slice(0, 10), {
          x: x + 0.82,
          y: y + 0.94,
          w: 1.6,
          h: 0.12,
          fontSize: 7.5,
          color: COLORS.muted,
        });
      });
      page += 1;
    });
  });
  return page;
}

function addCohortSlides(pptx: PptxGenJS, doc: ReportDocument, startPage: number): number {
  const computed = doc.computed;
  if (!computed) return startPage;
  const cohort = computed.cohort;
  const FIRST_PAGE_SIZE = 9;
  const NEXT_PAGE_SIZE = 13;
  const chunks: typeof cohort.rows[] = [];
  chunks.push(cohort.rows.slice(0, FIRST_PAGE_SIZE));
  for (let offset = FIRST_PAGE_SIZE; offset < cohort.rows.length; offset += NEXT_PAGE_SIZE) {
    chunks.push(cohort.rows.slice(offset, offset + NEXT_PAGE_SIZE));
  }
  let page = startPage;

  chunks.forEach((companies, chunkIndex) => {
    const slide = pptx.addSlide();
    addSlideFrame(
      slide,
      'Competitive landscape',
      chunkIndex === 0 ? 'Boston news cohort' : 'Boston news cohort, continued',
      cohort.landscapeName,
      page,
    );

    const tableY = chunkIndex === 0 ? 2.68 : 1.42;
    if (chunkIndex === 0) {
      const summaryCards = [
        {
          label: 'Cohort engagement',
          value: formatCount(cohort.engagement.value),
          note: movementLabel(cohort.engagement),
          color: movementTone(cohort.engagement),
        },
        {
          label: 'Focus rank',
          value: cohort.focusRank === null ? 'n/a' : String(cohort.focusRank),
          note: cohort.focusCompanyName ?? 'No focus company',
          color: COLORS.blue,
        },
        {
          label: 'Cohort members',
          value: formatCount(cohort.memberCount),
          note: cohort.landscapeName,
          color: COLORS.teal,
        },
        {
          label: 'Best focus post',
          value: cohort.focusPostRank === null ? 'n/a' : '#' + cohort.focusPostRank,
          note: cohort.focusPostRank === null ? 'No ranked focus post' : 'In the landscape top posts',
          color: COLORS.amber,
        },
      ];
      const gap = 0.15;
      const w = (CONTENT_W - gap * 3) / 4;
      summaryCards.forEach((card, index) => {
        addKpiCard(
          slide,
          MARGIN_X + index * (w + gap),
          1.36,
          w,
          card.label,
          card.value,
          card.note,
          card.color,
        );
      });
    }

    const columns: TableColumn[] = [
      { label: '#', width: 0.6, align: 'center' },
      { label: 'Company', width: 5.2 },
      { label: 'Engagement', width: 2.1, align: 'right' },
      { label: 'Week over week', width: 2.05, align: 'right' },
      { label: 'Position', width: 2.14, align: 'center' },
    ];
    const rows = companies.map((company) => [
      String(company.rank),
      company.name,
      formatCount(company.engagementTotal),
      formatPct(company.changePct),
      company.isFocus ? 'Focus company' : '',
    ]);
    const focusRows = new Set<number>();
    companies.forEach((company, index) => {
      if (company.isBgmOwned) focusRows.add(index);
    });
    addSimpleTable(slide, columns, rows, {
      x: MARGIN_X,
      y: tableY,
      rowHeight: chunkIndex === 0 ? 0.41 : 0.42,
      focusRows,
      fontSize: 9.5,
    });

    if (chunkIndex === chunks.length - 1 && computed.caveats.length > 0) {
      addText(slide, 'Measurement notes: ' + truncate(computed.caveats.join(' '), 430), {
        x: MARGIN_X,
        y: 6.72,
        w: CONTENT_W,
        h: 0.2,
        fontSize: 8,
        color: COLORS.muted,
        italic: true,
        fit: 'shrink',
      });
    }
    page += 1;
  });
  return page;
}

function splitNarrative(text: string, maxChars = 920): string[] {
  const paragraphs = text.trim().split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = '';

  const pushCurrent = () => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  };

  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/);
    for (const word of words) {
      if (current.length + word.length + 1 > maxChars) pushCurrent();
      current += (current ? ' ' : '') + word;
    }
    if (current.length > maxChars * 0.62) pushCurrent();
    else if (current) current += '\n\n';
  }
  pushCurrent();
  return chunks;
}

function addNarrativeSlides(
  pptx: PptxGenJS,
  doc: ReportDocument,
  startPage: number,
): number {
  const entries = NARRATIVE_SECTIONS.flatMap((section) => {
    const text = (doc.narrative[section.id] ?? '').trim();
    return splitNarrative(text).map((chunk, index) => ({
      title: section.title + (index > 0 ? ' (continued)' : ''),
      text: chunk,
    }));
  });
  if (entries.length === 0) {
    entries.push({
      title: 'Editorial narrative',
      text: 'No editorial narrative has been added to this report.',
    });
  }

  let page = startPage;
  for (let offset = 0; offset < entries.length; offset += 2) {
    const batch = entries.slice(offset, offset + 2);
    const slide = pptx.addSlide();
    addSlideFrame(
      slide,
      'Appendix',
      offset === 0 ? 'Editorial narrative' : 'Editorial narrative, continued',
      periodLabel(doc.period),
      page,
    );
    const panelHeight = batch.length === 1 ? 5.36 : 2.55;
    batch.forEach((entry, index) => {
      const y = 1.4 + index * 2.72;
      addRect(slide, MARGIN_X, y, CONTENT_W, panelHeight, COLORS.white, COLORS.line);
      addText(slide, entry.title, {
        x: MARGIN_X + 0.25,
        y: y + 0.2,
        w: 4.4,
        h: 0.24,
        fontFace: HEAD_FONT,
        fontSize: 14,
        bold: true,
        color: COLORS.redDark,
        fit: 'shrink',
      });
      addText(slide, entry.text, {
        x: MARGIN_X + 0.25,
        y: y + 0.62,
        w: CONTENT_W - 0.5,
        h: panelHeight - 0.84,
        fontSize: batch.length === 1 ? 15 : 12,
        color: COLORS.inkSoft,
        valign: 'top',
        breakLine: false,
        fit: 'shrink',
      });
    });
    page += 1;
  }
  return page;
}

function manualColumnWidths(columnCount: number): number[] {
  if (columnCount <= 1) return [CONTENT_W];
  if (columnCount === 2) return [CONTENT_W * 0.62, CONTENT_W * 0.38];
  const first = CONTENT_W * 0.38;
  return [first, ...Array.from(
    { length: columnCount - 1 },
    () => (CONTENT_W - first) / (columnCount - 1),
  )];
}

function addManualSlides(pptx: PptxGenJS, doc: ReportDocument, startPage: number): number {
  let page = startPage;
  const figures = MANUAL_FIGURES
    .map((spec) => ({ spec, value: (doc.manual.figures[spec.id] ?? '').trim() }))
    .filter((entry) => entry.value);

  {
    const slide = pptx.addSlide();
    addSlideFrame(slide, 'Appendix', 'Manual inputs', periodLabel(doc.period), page);
    if (figures.length === 0) {
      addText(slide, 'No manual figures have been supplied.', {
        x: MARGIN_X,
        y: 2.55,
        w: CONTENT_W,
        h: 0.4,
        fontSize: 18,
        color: COLORS.muted,
        align: 'center',
      });
    } else {
      figures.forEach((entry, index) => {
        const column = index % 2;
        const row = Math.floor(index / 2);
        const x = MARGIN_X + column * 6.18;
        const y = 1.45 + row * 1.44;
        addRect(slide, x, y, 5.95, 1.16, COLORS.white, COLORS.line);
        addText(slide, entry.spec.label, {
          x: x + 0.22,
          y: y + 0.2,
          w: 3.9,
          h: 0.24,
          fontSize: 10,
          bold: true,
          color: COLORS.inkSoft,
          fit: 'shrink',
        });
        addText(slide, entry.value, {
          x: x + 0.22,
          y: y + 0.57,
          w: 5.5,
          h: 0.32,
          fontFace: HEAD_FONT,
          fontSize: 20,
          bold: true,
          color: COLORS.redDark,
          fit: 'shrink',
        });
      });
    }
    addText(slide, 'These values are visibly manual and are not recalculated by Data Dumpster.', {
      x: MARGIN_X,
      y: 6.66,
      w: CONTENT_W,
      h: 0.18,
      fontSize: 8,
      color: COLORS.muted,
      italic: true,
    });
    page += 1;
  }

  for (const spec of MANUAL_SECTIONS) {
    const rows = reportManualRows(spec.id, doc.manual.tables[spec.id]);
    if (rows.length === 0) continue;
    const PAGE_SIZE = 13;
    for (let offset = 0; offset < rows.length; offset += PAGE_SIZE) {
      const batch = rows.slice(offset, offset + PAGE_SIZE);
      const slide = pptx.addSlide();
      addSlideFrame(
        slide,
        'Manual appendix',
        spec.title + (offset > 0 ? ', continued' : ''),
        'Human-entered source data',
        page,
      );
      const widths = manualColumnWidths(spec.columns.length);
      const columns = spec.columns.map((column, index) => ({
        label: column.label,
        width: widths[index],
        align: column.numeric ? 'right' as const : 'left' as const,
      }));
      addSimpleTable(
        slide,
        columns,
        batch.map((row) => spec.columns.map((_, index) => truncate(row[index] ?? '', 120))),
        {
          x: MARGIN_X,
          y: 1.43,
          rowHeight: 0.4,
          fontSize: 8.5,
        },
      );
      addText(slide, spec.hint, {
        x: MARGIN_X,
        y: 6.74,
        w: CONTENT_W,
        h: 0.16,
        fontSize: 7.5,
        color: COLORS.muted,
        italic: true,
        fit: 'shrink',
      });
      page += 1;
    }
  }

  return page;
}

/** Build a polished 16:9 executive deck from the report's reviewed fact sheet. */
export async function renderReportPptx(doc: ReportDocument): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'Data Dumpster';
  pptx.company = doc.orgName;
  pptx.subject = 'Weekly social performance report for ' + periodLabel(doc.period);
  pptx.title = doc.title;
  pptx.revision = '1';
  pptx.theme = {
    headFontFace: HEAD_FONT,
    bodyFontFace: BODY_FONT,
  };

  let page = addCover(pptx, doc);
  page = addOverview(pptx, doc, page + 1);
  page = addBrandSlides(pptx, doc, page);
  page = addTopPostSlides(pptx, doc, page);
  page = addCohortSlides(pptx, doc, page);
  page = addNarrativeSlides(pptx, doc, page);
  addManualSlides(pptx, doc, page);

  const output = await pptx.write({ outputType: 'nodebuffer', compression: true });
  if (output instanceof Uint8Array) return Buffer.from(output);
  if (output instanceof ArrayBuffer) return Buffer.from(output);
  if (typeof Blob !== 'undefined' && output instanceof Blob) {
    return Buffer.from(await output.arrayBuffer());
  }
  if (typeof output === 'string') return Buffer.from(output, 'binary');
  throw new Error('PowerPoint generation returned an unsupported output type.');
}
