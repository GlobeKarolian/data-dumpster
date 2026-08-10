/**
 * Pure report-narrative grounding.
 *
 * The material builder is shared by the model prompt and the deterministic
 * verifier. That shared string is the boundary: a number outside the material
 * cannot be returned, saved, rendered, exported, or delivered as narrative.
 */
import {
  verifyNumbersAgainstMaterial,
  type NumericGroundingVerification,
} from '@/lib/ai/verify';
import {
  MANUAL_FIGURES,
  MANUAL_SECTIONS,
  NARRATIVE_SECTIONS,
  REPORT_PLATFORM_LABELS,
  REPORT_PLATFORMS,
  periodLabel,
  reportManualRows,
  type NarrativeBlock,
  type NarrativeSectionSpec,
} from './types';
import {
  describeDirection,
  formatCount,
  formatPct,
  formatRate,
  formatSignedCount,
  type ReportDocument,
} from './render';

function computedMaterial(doc: ReportDocument): string[] {
  const c = doc.computed;
  if (!c) return ['COMPUTED DATA: not yet computed for this report.'];

  const lines: string[] = [];
  lines.push('COMPUTED DATA (window ' + periodLabel(c.period)
    + ', compared against ' + c.previousPeriod.start + ' to ' + c.previousPeriod.end + ').');
  lines.push('Landscape: ' + c.landscape.name + '.');
  lines.push('Focus brand: ' + (c.focus.companyName ?? 'not set') + '.');
  lines.push('Focus followers: ' + formatCount(c.focus.followers.value)
    + (c.focus.netFollowers === null
      ? ', net change this week unavailable'
      : ', net change this week ' + formatSignedCount(c.focus.netFollowers))
    + ', ' + describeDirection(c.focus.followers.changePct) + '.');
  lines.push('Focus engagement total: ' + formatCount(c.focus.engagementTotal.value)
    + ', ' + describeDirection(c.focus.engagementTotal.changePct) + '.');
  lines.push('Focus posts: ' + formatCount(c.focus.posts.value)
    + '. Engagement per post: ' + formatRate(c.focus.engagementPerPost.value)
    + ', ' + describeDirection(c.focus.engagementPerPost.changePct) + '.');
  lines.push('Portfolio followers: ' + formatCount(c.portfolio.followers.value)
    + (c.portfolio.netFollowers === null
      ? ', net change unavailable this week.'
      : ', net ' + formatSignedCount(c.portfolio.netFollowers) + ' this week.'));
  lines.push('Portfolio engagement: ' + formatCount(c.portfolio.engagementTotal.value)
    + ', ' + describeDirection(c.portfolio.engagementTotal.changePct) + '.');

  lines.push('');
  lines.push('BRANDS BY TOTAL FOLLOWERS:');
  for (const brand of c.brands) {
    const split = REPORT_PLATFORMS
      .filter((platform) => brand.byPlatform[platform] !== undefined)
      .map((platform) => (
        REPORT_PLATFORM_LABELS[platform] + ' ' + formatCount(brand.byPlatform[platform])
      ))
      .join(', ');
    lines.push('  ' + (brand.rank === null ? 'Unranked' : brand.rank + '.') + ' '
      + brand.name + ' - ' + formatCount(brand.totalFollowers)
      + ' followers, '
      + (brand.netChange === null ? 'net change unavailable' : 'net ' + formatSignedCount(brand.netChange))
      + (split ? ' (' + split + ')' : ''));
  }

  if (c.topPosts.length > 0) {
    lines.push('');
    lines.push('TOP ENGAGED POSTS:');
    for (const post of c.topPosts) {
      lines.push('  ' + post.rank + '. ' + post.companyName + ' on ' + post.platform + ', '
        + formatCount(post.engagementTotal) + ' engagements: '
        + (post.text
          ? post.text.slice(0, 200).replace(/\s+/g, ' ')
          : 'no post text captured'));
    }
  }

  lines.push('');
  lines.push('COHORT BY ENGAGEMENT (' + c.cohort.memberCount + ' brands):');
  for (const row of c.cohort.rows.slice(0, 15)) {
    lines.push('  ' + row.rank + '. ' + row.name + (row.isFocus ? ' (us)' : '') + ' - '
      + formatCount(row.engagementTotal) + ', ' + formatPct(row.changePct) + ' week over week');
  }
  if (c.cohort.focusPostRank) {
    lines.push('Our best post ranked ' + c.cohort.focusPostRank + ' of the top '
      + c.cohort.focusPostPool + ' posts in the landscape.');
  }
  if (c.caveats.length > 0) {
    lines.push('');
    lines.push('MEASUREMENT CAVEATS (repeat these):');
    for (const caveat of c.caveats) lines.push('  - ' + caveat);
  }
  return lines;
}

function manualMaterial(spec: NarrativeSectionSpec, doc: ReportDocument): string[] {
  const lines: string[] = [];
  for (const tableId of spec.sources.manualTables) {
    const section = MANUAL_SECTIONS.find((item) => item.id === tableId);
    if (!section) continue;
    const table = doc.manual.tables[tableId];
    const reportRows = reportManualRows(tableId, table);
    lines.push('');
    lines.push('PASTED TABLE: ' + section.title);
    if (reportRows.length === 0) {
      lines.push('  (nothing pasted for this table this week)');
      continue;
    }
    lines.push('  ' + section.columns.map((column) => column.label).join(' | '));
    for (const row of reportRows.slice(0, 25)) lines.push('  ' + row.join(' | '));
    if (reportRows.length > 25) {
      lines.push('  (' + (reportRows.length - 25) + ' further rows not shown)');
    }
  }

  const figures = spec.sources.manualFigures
    .map((id) => ({
      spec: MANUAL_FIGURES.find((figure) => figure.id === id),
      value: doc.manual.figures[id],
    }))
    .filter((figure) => figure.spec && figure.value && figure.value.trim().length > 0);
  if (figures.length > 0) {
    lines.push('');
    lines.push('HAND-ENTERED FIGURES:');
    for (const figure of figures) {
      lines.push('  ' + figure.spec?.label + ': ' + figure.value?.trim());
    }
  }
  return lines;
}

/** The exact section material used for both prompting and verification. */
export function buildNarrativeSectionMaterial(
  spec: NarrativeSectionSpec,
  doc: ReportDocument,
): string {
  const material: string[] = [];
  if (spec.sources.computed) material.push(...computedMaterial(doc));
  material.push(...manualMaterial(spec, doc));
  return material.join('\n');
}

export type NarrativeSectionVerification = NumericGroundingVerification & {
  sectionId: string;
  sectionTitle: string;
};

export type ReportNarrativeVerification = {
  ok: boolean;
  sections: Record<string, NarrativeSectionVerification>;
  invalidSectionIds: string[];
};

/** Verify one paragraph against only the material assigned to that section. */
export function verifyNarrativeSection(
  sectionId: string,
  prose: string,
  doc: ReportDocument,
  exactMaterial?: string,
): NarrativeSectionVerification {
  const spec = NARRATIVE_SECTIONS.find((section) => section.id === sectionId);
  const base = verifyNumbersAgainstMaterial(
    prose,
    exactMaterial ?? (spec ? buildNarrativeSectionMaterial(spec, doc) : ''),
  );
  return {
    ...base,
    sectionId,
    sectionTitle: spec?.title ?? sectionId,
  };
}

/** Verify every stored paragraph in a report against its own source boundary. */
export function verifyReportNarrative(doc: ReportDocument): ReportNarrativeVerification {
  const sections: Record<string, NarrativeSectionVerification> = {};
  for (const [sectionId, prose] of Object.entries(doc.narrative)) {
    if (!prose.trim()) continue;
    sections[sectionId] = verifyNarrativeSection(sectionId, prose, doc);
  }
  const invalidSectionIds = Object.values(sections)
    .filter((section) => !section.ok)
    .map((section) => section.sectionId);
  return {
    ok: invalidSectionIds.length === 0,
    sections,
    invalidSectionIds,
  };
}

/**
 * Omit stale or ungrounded stored paragraphs before a report reaches a renderer.
 * The verification result remains available for a warning or audit log.
 */
export function sanitizeReportNarrative(doc: ReportDocument): {
  narrative: NarrativeBlock;
  verification: ReportNarrativeVerification;
} {
  const verification = verifyReportNarrative(doc);
  const invalid = new Set(verification.invalidSectionIds);
  const narrative = Object.fromEntries(
    Object.entries(doc.narrative).filter(([sectionId]) => !invalid.has(sectionId)),
  );
  return { narrative, verification };
}

export function narrativeVerificationMessage(
  verification: ReportNarrativeVerification,
): string {
  const details = verification.invalidSectionIds.map((sectionId) => {
    const section = verification.sections[sectionId];
    const raw = section.claims.filter((claim) => !claim.found).map((claim) => claim.raw);
    const figures = Array.from(new Set(raw)).slice(0, 4);
    return section.sectionTitle + (figures.length > 0 ? ': ' + figures.join(', ') : '');
  });
  return 'Narrative contains figures that cannot be verified against the current report material'
    + (details.length > 0 ? ' (' + details.join('; ') + ')' : '')
    + '. Remove those figures or update them to values shown in the section.';
}

export class ReportNarrativeVerificationError extends Error {
  constructor(readonly verification: ReportNarrativeVerification) {
    super(narrativeVerificationMessage(verification));
    this.name = 'ReportNarrativeVerificationError';
  }
}

/** Fail closed for export and delivery paths. */
export function assertReportNarrativeVerified(
  doc: ReportDocument,
): ReportNarrativeVerification {
  const verification = verifyReportNarrative(doc);
  if (!verification.ok) throw new ReportNarrativeVerificationError(verification);
  return verification;
}
