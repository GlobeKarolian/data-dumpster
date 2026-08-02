import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ReportDocument } from './render';
import {
  assertReportNarrativeVerified,
  buildNarrativeSectionMaterial,
  ReportNarrativeVerificationError,
  sanitizeReportNarrative,
  verifyNarrativeSection,
  verifyReportNarrative,
} from './narrative-verification';
import { NARRATIVE_SECTIONS } from './types';

function report(narrative: Record<string, string>): ReportDocument {
  return {
    title: 'Weekly report',
    orgName: 'Example News',
    period: { start: '2026-07-20', end: '2026-07-26' },
    dataNote: null,
    computed: null,
    manual: {
      tables: {
        globeSearch: {
          raw: 'election\t777\t2,000\t38.9%\t1.2',
          rows: [['election', '777', '2,000', '38.9%', '1.2']],
          updatedAt: '2026-07-27T12:00:00.000Z',
        },
      },
      figures: { paidStarts: '325', paidCostPerStart: '$18.40' },
    },
    narrative,
  };
}

describe('report narrative verification', () => {
  it('uses the same exact section material string exposed to the model', () => {
    const doc = report({});
    const search = NARRATIVE_SECTIONS.find((section) => section.id === 'search');
    assert.ok(search);

    const material = buildNarrativeSectionMaterial(search, doc);
    assert.match(material, /election \| 777 \| 2,000 \| 38\.9% \| 1\.2/);

    const verification = verifyNarrativeSection(
      'search',
      'Election generated 777 clicks from 2,000 impressions at a 38.9% CTR.',
      doc,
    );
    assert.equal(verification.ok, true);
    assert.equal(verification.stats.total, 3);
  });

  it('does not let a real number leak across section boundaries', () => {
    const doc = report({});
    const search = verifyNarrativeSection('search', 'Election generated 777 clicks.', doc);
    const executive = verifyNarrativeSection(
      'executiveSummary',
      'Election generated 777 clicks.',
      doc,
    );

    assert.equal(search.ok, true);
    assert.equal(executive.ok, false);
    assert.deepEqual(
      executive.claims.filter((claim) => !claim.found).map((claim) => claim.raw),
      ['777'],
    );
  });

  it('rejects any unmatched figure in a human-authored narrative block', () => {
    const doc = report({
      search: 'Election generated 778 clicks.',
      paid: 'Paid promotion delivered 325 starts at $18.40 per start.',
    });
    const verification = verifyReportNarrative(doc);

    assert.equal(verification.ok, false);
    assert.deepEqual(verification.invalidSectionIds, ['search']);
    assert.equal(verification.sections.paid.ok, true);
    assert.throws(
      () => assertReportNarrativeVerified(doc),
      ReportNarrativeVerificationError,
    );
  });

  it('omits stale prose before rendering while preserving grounded prose', () => {
    const doc = report({
      search: 'Election generated 778 clicks.',
      paid: 'Paid promotion delivered 325 starts at $18.40 per start.',
      referral: 'Referral performance was concentrated in a small group of domains.',
    });
    const sanitized = sanitizeReportNarrative(doc);

    assert.equal(sanitized.verification.ok, false);
    assert.equal(sanitized.narrative.search, undefined);
    assert.equal(
      sanitized.narrative.paid,
      'Paid promotion delivered 325 starts at $18.40 per start.',
    );
    assert.equal(
      sanitized.narrative.referral,
      'Referral performance was concentrated in a small group of domains.',
    );
  });
});
