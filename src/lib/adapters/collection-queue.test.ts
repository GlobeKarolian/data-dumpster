import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { automaticRefreshWindowStart } from './automatic-refresh';
import { collectionQueueTestHelpers } from './collection-queue';
import { collectionOutcomeForFetch } from './runner';

const LOOKBACK_MS = collectionQueueTestHelpers.POST_REFRESH_LOOKBACK_DAYS * 86_400_000;

const {
  collectionRunSince,
  extendedTerminalSuffix,
  assertValidDemandWindow,
  demandRegistrationNeedsQueue,
  demandWindowIsCovered,
  demandExpandedDuringClaim,
  mergeCertifiedCoverage,
  poolDemandWindows,
  queueDisposition,
} = collectionQueueTestHelpers;

describe('pooled landscape demand', () => {
  const narrowSince = new Date('2026-07-01T00:00:00Z');
  const wideSince = new Date('2026-05-01T00:00:00Z');
  const narrowUntil = new Date('2026-08-01T00:00:00Z');
  const wideUntil = new Date('2026-08-03T00:00:00Z');
  const base = {
    channelId: 'channel-1',
    companyId: 'company-1',
    orgId: 'org-1',
  };

  it('pools two landscapes into one channel state and one claim target', () => {
    const pooled = poolDemandWindows([
      { ...base, landscapeId: 'landscape-1', requiredSince: narrowSince, requiredUntil: narrowUntil },
      { ...base, landscapeId: 'landscape-2', requiredSince: wideSince, requiredUntil: wideUntil },
    ]);

    assert.equal(pooled.length, 1);
    assert.deepEqual(pooled[0]?.landscapeIds.sort(), ['landscape-1', 'landscape-2']);
    assert.equal(pooled[0]?.requiredSince.toISOString(), wideSince.toISOString());
    assert.equal(pooled[0]?.requiredUntil.toISOString(), wideUntil.toISOString());
  });

  it('reuses certified coverage when a second landscape requests a covered window', () => {
    assert.equal(demandWindowIsCovered({
      requiredSince: narrowSince,
      requiredUntil: narrowUntil,
      coverageSince: wideSince,
      coverageUntil: wideUntil,
    }), true);
  });

  it('registers a second landscape without re-crawling fresh settled coverage', () => {
    const now = new Date('2026-08-03T12:00:00Z');
    const common = {
      force: false,
      now,
      staleBefore: new Date('2026-08-03T09:00:00Z'),
      hasMore: false,
      nextAttemptAt: null,
      leaseUntil: null,
      existingRequiredSince: narrowSince,
      existingRequiredUntil: narrowUntil,
      demandedSince: narrowSince,
      demandedUntil: narrowUntil,
      attemptedUntil: new Date('2026-08-03T11:30:00Z'),
    } as const;

    assert.equal(demandRegistrationNeedsQueue({
      ...common,
      status: 'succeeded',
      outcome: 'certified_complete',
      coverageSince: narrowSince,
      coverageUntil: narrowUntil,
    }), false);
    assert.equal(demandRegistrationNeedsQueue({
      ...common,
      status: 'partial',
      outcome: 'terminal_source_limitation',
      coverageSince: null,
      coverageUntil: null,
    }), false);
  });

  it('queues the noon window after a midnight worker starts one minute late', () => {
    const now = new Date('2026-08-11T12:00:16.448Z');
    assert.equal(demandRegistrationNeedsQueue({
      force: false,
      now,
      staleBefore: automaticRefreshWindowStart(now),
      status: 'partial',
      outcome: 'terminal_source_limitation',
      hasMore: false,
      nextAttemptAt: null,
      leaseUntil: null,
      existingRequiredSince: narrowSince,
      existingRequiredUntil: new Date('2026-08-11T00:01:24.461Z'),
      demandedSince: narrowSince,
      demandedUntil: now,
      coverageSince: null,
      coverageUntil: null,
      attemptedUntil: new Date('2026-08-11T00:01:24.461Z'),
    }), true);
  });

  it('queues one pooled crawl when certified coverage does not span wider history', () => {
    const now = new Date('2026-08-03T12:00:00Z');
    assert.equal(demandRegistrationNeedsQueue({
      force: false,
      now,
      staleBefore: new Date('2026-08-03T09:00:00Z'),
      status: 'succeeded',
      outcome: 'certified_complete',
      hasMore: false,
      nextAttemptAt: null,
      leaseUntil: null,
      existingRequiredSince: narrowSince,
      existingRequiredUntil: narrowUntil,
      demandedSince: wideSince,
      demandedUntil: wideUntil,
      coverageSince: narrowSince,
      coverageUntil: narrowUntil,
      attemptedUntil: new Date('2026-08-03T11:30:00Z'),
    }), true);
  });

  it('does not re-buy a fresh source-limited payload for an older demand', () => {
    const now = new Date('2026-08-03T12:00:00Z');
    assert.equal(demandRegistrationNeedsQueue({
      force: false,
      now,
      staleBefore: new Date('2026-08-03T09:00:00Z'),
      status: 'partial',
      outcome: 'terminal_source_limitation',
      hasMore: false,
      nextAttemptAt: null,
      leaseUntil: null,
      existingRequiredSince: narrowSince,
      existingRequiredUntil: narrowUntil,
      demandedSince: wideSince,
      demandedUntil: wideUntil,
      coverageSince: null,
      coverageUntil: null,
      attemptedUntil: new Date('2026-08-03T11:30:00Z'),
    }), false);
  });

  it('lets an explicit refresh bypass fresh pooled coverage', () => {
    const now = new Date('2026-08-03T12:00:00Z');
    assert.equal(demandRegistrationNeedsQueue({
      force: true,
      now,
      staleBefore: new Date('2026-08-03T09:00:00Z'),
      status: 'succeeded',
      outcome: 'certified_complete',
      hasMore: false,
      nextAttemptAt: null,
      leaseUntil: null,
      existingRequiredSince: narrowSince,
      existingRequiredUntil: narrowUntil,
      demandedSince: narrowSince,
      demandedUntil: narrowUntil,
      coverageSince: narrowSince,
      coverageUntil: narrowUntil,
      attemptedUntil: narrowUntil,
    }), true);
  });

  it('detects demand widened while the pooled channel lease is running', () => {
    assert.equal(demandExpandedDuringClaim({
      claimedSince: narrowSince,
      claimedUntil: narrowUntil,
      pooledDemandSince: wideSince,
      pooledDemandUntil: wideUntil,
    }), true);
    assert.equal(demandExpandedDuringClaim({
      claimedSince: narrowSince,
      claimedUntil: narrowUntil,
      pooledDemandSince: narrowSince,
      pooledDemandUntil: narrowUntil,
    }), false);
    assert.equal(demandExpandedDuringClaim({
      claimedSince: narrowSince,
      claimedUntil: narrowUntil,
      pooledDemandSince: narrowSince,
      pooledDemandUntil: new Date(narrowUntil.getTime() + 1_000),
    }), false);
  });

  it('finishes a narrow continuation before scheduling exactly one wider follow-up', () => {
    const resumedSince = collectionRunSince({
      requiredSince: narrowSince,
      coverageSince: null,
      coverageUntil: null,
      hasMore: true,
    });
    assert.equal(resumedSince.toISOString(), narrowSince.toISOString());

    const settledNarrow = mergeCertifiedCoverage({
      requiredSince: narrowSince,
      requiredUntil: narrowUntil,
      coverageSince: null,
      coverageUntil: null,
      attemptedSince: narrowSince,
      attemptedUntil: narrowUntil,
    });
    assert.equal(settledNarrow.complete, true);

    const followUps = [demandExpandedDuringClaim({
      claimedSince: narrowSince,
      claimedUntil: narrowUntil,
      pooledDemandSince: wideSince,
      pooledDemandUntil: wideUntil,
    })].filter(Boolean).length;
    assert.equal(followUps, 1);
  });

  it('widens only the one pooled window when another landscape needs more history', () => {
    const [before] = poolDemandWindows([
      { ...base, landscapeId: 'landscape-1', requiredSince: narrowSince, requiredUntil: narrowUntil },
    ]);
    const [after] = poolDemandWindows([
      { ...base, landscapeId: 'landscape-1', requiredSince: narrowSince, requiredUntil: narrowUntil },
      { ...base, landscapeId: 'landscape-2', requiredSince: wideSince, requiredUntil: wideUntil },
    ]);

    assert.equal(before.requiredSince.toISOString(), narrowSince.toISOString());
    assert.equal(after.requiredSince.toISOString(), wideSince.toISOString());
    assert.equal(after.channelId, before.channelId);
  });

  it('preserves another landscape demand and makes the channel dormant after the last removal', () => {
    const demands = [
      { ...base, landscapeId: 'landscape-1', requiredSince: narrowSince, requiredUntil: narrowUntil },
      { ...base, landscapeId: 'landscape-2', requiredSince: wideSince, requiredUntil: wideUntil },
    ];
    assert.equal(
      poolDemandWindows(demands.filter((row) => row.landscapeId !== 'landscape-1')).length,
      1,
    );
    assert.equal(poolDemandWindows([]).length, 0);
  });

  it('is idempotent under duplicate or concurrent demand delivery', () => {
    const demand = {
      ...base,
      landscapeId: 'landscape-1',
      requiredSince: narrowSince,
      requiredUntil: narrowUntil,
    };
    const pooled = poolDemandWindows([demand, demand, demand]);
    assert.equal(pooled.length, 1);
    assert.deepEqual(pooled[0]?.landscapeIds, ['landscape-1']);
  });

  it('rejects invalid demand windows before they reach SQL', () => {
    assert.throws(() => assertValidDemandWindow({
      since: wideUntil,
      until: wideSince,
    }), /since <= until/);
  });
});

describe('durable collection windows', () => {
  const requiredSince = new Date('2026-05-01T00:00:00Z');
  const coverageUntil = new Date('2026-07-30T12:00:00Z');

  it('overlaps back across the posts still accruing after the window is complete', () => {
    // Eight days, not two: a post keeps gaining engagement for about a week,
    // and a shorter overlap freezes its metrics where the window left it.
    assert.equal(collectionRunSince({
      requiredSince,
      coverageSince: requiredSince,
      coverageUntil,
      hasMore: false,
    }).toISOString(), new Date(coverageUntil.getTime() - LOOKBACK_MS).toISOString());
  });

  it('keeps the full requested window while pagination remains', () => {
    assert.equal(collectionRunSince({
      requiredSince,
      coverageSince: requiredSince,
      coverageUntil,
      hasMore: true,
    }).toISOString(), requiredSince.toISOString());
  });

  it('backfills from the new boundary when the requested history expands', () => {
    const expandedSince = new Date('2026-01-01T00:00:00Z');
    assert.equal(collectionRunSince({
      requiredSince: expandedSince,
      coverageSince: requiredSince,
      coverageUntil,
      hasMore: false,
    }).toISOString(), expandedSince.toISOString());
  });

  it('refreshes a terminally limited source across the accrual window', () => {
    assert.equal(collectionRunSince({
      requiredSince,
      coverageSince: null,
      coverageUntil: null,
      attemptedUntil: coverageUntil,
      outcome: 'terminal_source_limitation',
      hasMore: false,
    }).toISOString(), new Date(coverageUntil.getTime() - LOOKBACK_MS).toISOString());
  });

  it('starts from the full boundary when no source response has settled', () => {
    assert.equal(collectionRunSince({
      requiredSince,
      coverageSince: null,
      coverageUntil: null,
      attemptedUntil: null,
      outcome: 'retryable_operational_failure',
      hasMore: false,
    }).toISOString(), requiredSince.toISOString());
  });

  it('keeps the last settled overlap through a transient retry', () => {
    assert.equal(collectionRunSince({
      requiredSince,
      coverageSince: null,
      coverageUntil: null,
      attemptedUntil: coverageUntil,
      outcome: 'retryable_operational_failure',
      hasMore: false,
    }).toISOString(), new Date(coverageUntil.getTime() - LOOKBACK_MS).toISOString());
  });

  it('does not turn a recent overlap into certified historical coverage', () => {
    const merged = mergeCertifiedCoverage({
      requiredSince,
      requiredUntil: new Date('2026-08-01T12:00:00Z'),
      coverageSince: null,
      coverageUntil: null,
      attemptedSince: new Date('2026-07-28T12:00:00Z'),
      attemptedUntil: new Date('2026-08-01T12:00:00Z'),
    });
    assert.equal(merged.since.toISOString(), '2026-07-28T12:00:00.000Z');
    assert.equal(merged.complete, false);
  });

  it('does not re-buy the full window after certifying only a recent limited suffix', () => {
    assert.equal(collectionRunSince({
      requiredSince,
      coverageSince: new Date('2026-07-28T12:00:00Z'),
      coverageUntil: new Date('2026-08-01T12:00:00Z'),
      attemptedUntil: new Date('2026-08-01T12:00:00Z'),
      outcome: 'terminal_source_limitation',
      hasMore: false,
    }).toISOString(),
      new Date(new Date('2026-08-01T12:00:00Z').getTime() - LOOKBACK_MS).toISOString());
  });

  it('merges an overlapping refresh into previously certified coverage', () => {
    const merged = mergeCertifiedCoverage({
      requiredSince,
      requiredUntil: new Date('2026-08-01T12:00:00Z'),
      coverageSince: requiredSince,
      coverageUntil,
      attemptedSince: new Date('2026-07-28T12:00:00Z'),
      attemptedUntil: new Date('2026-08-01T12:00:00Z'),
    });
    assert.equal(merged.since.toISOString(), requiredSince.toISOString());
    assert.equal(merged.until.toISOString(), '2026-08-01T12:00:00.000Z');
    assert.equal(merged.complete, true);
  });
});

describe('post refresh lookback', () => {
  const day = (d: string) => new Date(d + 'T00:00:00Z');

  it('re-reads far enough back that a live post keeps being updated', () => {
    // A terminally limited source (every vendor-capped platform) refreshing on
    // Aug 28. A post published Aug 19 is still accruing engagement, so the
    // window has to reach it; at the old two-day overlap it never would.
    const since = collectionRunSince({
      requiredSince: day('2026-05-02'),
      coverageSince: day('2026-08-01'),
      coverageUntil: day('2026-08-05'),
      attemptedUntil: day('2026-08-28'),
      outcome: 'terminal_source_limitation',
      hasMore: false,
    });
    assert.ok(since <= day('2026-08-19'), 'window must still cover an Aug 19 post');
  });

  it('never reaches back past the requested boundary', () => {
    const since = collectionRunSince({
      requiredSince: day('2026-08-25'),
      coverageSince: day('2026-08-01'),
      coverageUntil: day('2026-08-05'),
      attemptedUntil: day('2026-08-28'),
      outcome: 'terminal_source_limitation',
      hasMore: false,
      lookbackDays: 30,
    });
    assert.equal(since.toISOString(), day('2026-08-25').toISOString());
  });
});

describe('terminal suffix extension', () => {
  const day = (d: string) => new Date(d + 'T00:00:00Z');

  it('moves the right edge when the attempt overlaps the certified suffix', () => {
    const extended = extendedTerminalSuffix({
      attemptedSince: day('2026-08-24'),
      attemptedUntil: day('2026-08-26'),
      coverageSince: day('2026-05-02'),
      coverageUntil: day('2026-08-25'),
    });
    assert.ok(extended);
    assert.equal(extended.since.toISOString(), day('2026-05-02').toISOString());
    assert.equal(extended.until.toISOString(), day('2026-08-26').toISOString());
  });

  it('refuses to vouch for a gap between suffix and attempt', () => {
    assert.equal(extendedTerminalSuffix({
      attemptedSince: day('2026-08-24'),
      attemptedUntil: day('2026-08-26'),
      coverageSince: day('2026-05-02'),
      coverageUntil: day('2026-08-20'),
    }), null);
  });

  it('does nothing without an existing certified suffix or attempt bounds', () => {
    assert.equal(extendedTerminalSuffix({
      attemptedSince: day('2026-08-24'),
      attemptedUntil: day('2026-08-26'),
      coverageSince: null,
      coverageUntil: null,
    }), null);
    assert.equal(extendedTerminalSuffix({
      attemptedSince: null,
      attemptedUntil: null,
      coverageSince: day('2026-05-02'),
      coverageUntil: day('2026-08-25'),
    }), null);
  });

  it('never moves the left edge or shrinks the right one', () => {
    assert.equal(extendedTerminalSuffix({
      attemptedSince: day('2026-08-01'),
      attemptedUntil: day('2026-08-20'),
      coverageSince: day('2026-05-02'),
      coverageUntil: day('2026-08-25'),
    }), null);
  });
});

describe('collection outcomes', () => {
  it('distinguishes real continuations from terminal source limitations', () => {
    assert.equal(collectionOutcomeForFetch({ hasMore: true, exhaustive: false }), 'continuation');
    assert.equal(
      collectionOutcomeForFetch({ hasMore: false, exhaustive: false }),
      'terminal_source_limitation',
    );
    assert.equal(collectionOutcomeForFetch({ hasMore: false, exhaustive: true }), 'certified_complete');
  });

  it('fails closed when a runtime adapter omits completeness fields', () => {
    assert.equal(collectionOutcomeForFetch({}), 'terminal_source_limitation');
    assert.equal(
      collectionOutcomeForFetch({ exhaustive: true }),
      'terminal_source_limitation',
    );
    assert.equal(
      collectionOutcomeForFetch({ hasMore: false }),
      'terminal_source_limitation',
    );
  });

  it('only schedules real continuations immediately', () => {
    assert.equal(queueDisposition('certified_complete').schedule, 'none');
    assert.equal(queueDisposition('continuation').schedule, 'immediate');
    assert.equal(queueDisposition('terminal_source_limitation').schedule, 'none');
    assert.equal(queueDisposition('retryable_operational_failure').schedule, 'backoff');
    assert.equal(queueDisposition('permanent_failure').schedule, 'none');
  });

  it('never lets a terminal source limitation advance certified coverage', () => {
    const limited = queueDisposition('terminal_source_limitation');
    assert.equal(limited.advancesAttemptWatermark, true);
    assert.equal(limited.mayAdvanceCoverage, false);
    assert.equal(limited.status, 'partial');
  });
});

describe('escalateRetryableOutcome', () => {
  const { escalateRetryableOutcome, MAX_CONSECUTIVE_RETRYABLE_ATTEMPTS } =
    collectionQueueTestHelpers;

  it('leaves a retryable failure retryable below the ceiling', () => {
    assert.equal(
      escalateRetryableOutcome('retryable_operational_failure',
        MAX_CONSECUTIVE_RETRYABLE_ATTEMPTS - 1),
      'retryable_operational_failure',
    );
  });

  it('stops the paid loop at the ceiling and asks a person', () => {
    // Backoff caps at sixty minutes and never ends on its own, so without
    // this ceiling a channel whose vendor answer is wrong every time becomes
    // an hourly purchase forever.
    assert.equal(
      escalateRetryableOutcome('retryable_operational_failure',
        MAX_CONSECUTIVE_RETRYABLE_ATTEMPTS),
      'permanent_failure',
    );
  });

  it('never touches any other outcome, whatever the attempt count', () => {
    for (const outcome of [
      'certified_complete', 'continuation',
      'terminal_source_limitation', 'permanent_failure',
    ] as const) {
      assert.equal(escalateRetryableOutcome(outcome, 999), outcome);
    }
  });
});
