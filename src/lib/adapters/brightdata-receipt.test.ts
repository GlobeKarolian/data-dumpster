import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DATASETS, PendingSnapshotError } from '@/lib/vendors/brightdata';
import type { Platform } from '@/lib/types';
import {
  clearBrightDataReceipt,
  profileFromBrightDataReceipt,
  runBrightDataStage,
} from './brightdata-receipt';
import { AdapterError } from './types';

const SINCE = new Date('2026-07-01T00:00:00.000Z');
const UNTIL = new Date('2026-07-31T23:59:59.000Z');
const STARTED = new Date('2026-08-01T00:00:00.000Z');

const STAGES: Array<{
  platform: Platform;
  stage: string;
  datasetId: string;
}> = [
  { platform: 'facebook', stage: 'facebook-page-posts', datasetId: DATASETS.facebookPagePosts },
  { platform: 'instagram', stage: 'instagram-profile', datasetId: DATASETS.instagramProfile },
  { platform: 'instagram', stage: 'instagram-posts', datasetId: DATASETS.instagramPost },
  { platform: 'tiktok', stage: 'tiktok-profile', datasetId: DATASETS.tiktokProfile },
  { platform: 'tiktok', stage: 'tiktok-posts', datasetId: DATASETS.tiktokPostsByProfile },
  { platform: 'twitter', stage: 'twitter-posts', datasetId: DATASETS.twitterPosts },
  { platform: 'threads', stage: 'threads-profile', datasetId: DATASETS.threadsProfile },
  { platform: 'threads', stage: 'threads-posts', datasetId: DATASETS.threadsPosts },
];

function context(cursor: Record<string, unknown> = {}) {
  return { cursor, since: SINCE, until: UNTIL };
}

describe('durable Bright Data stage receipts', () => {
  for (const stage of STAGES) {
    it('resumes the exact paid ' + stage.stage + ' snapshot without retriggering', async () => {
      const snapshotId = 'sd_' + stage.stage;
      let starts = 0;
      let resumes = 0;

      const first = await runBrightDataStage(context(), {
        ...stage,
        now: STARTED,
      }, async (resumeSnapshotId) => {
        assert.equal(resumeSnapshotId, undefined);
        starts += 1;
        throw new PendingSnapshotError(stage.platform, snapshotId);
      });

      assert.equal(first.kind, 'continuation');
      if (first.kind !== 'continuation') return;
      assert.deepEqual(first.result.posts, []);
      assert.deepEqual(first.result.audience, []);
      assert.equal(first.result.hasMore, true);
      assert.equal(first.result.exhaustive, false);
      assert.equal(first.result.cursor?.source, 'brightdata');
      assert.equal(first.result.cursor?.brightDataStage, stage.stage);
      assert.equal(first.result.cursor?.brightDataDatasetId, stage.datasetId);
      assert.equal(first.result.cursor?.pendingSnapshotId, snapshotId);
      assert.equal(first.result.cursor?.brightDataReplacementAttempts, 0);
      assert.equal(first.result.cursor?.nextCursor, snapshotId);
      assert.equal(first.result.cursor?.windowSince, SINCE.toISOString());
      assert.equal(first.result.cursor?.windowUntil, UNTIL.toISOString());
      assert.equal(first.result.cursor?.pendingSince, STARTED.toISOString());

      const second = await runBrightDataStage(
        context(first.result.cursor ?? {}),
        { ...stage, now: new Date(STARTED.getTime() + 60 * 60 * 1000) },
        async (resumeSnapshotId) => {
          assert.equal(resumeSnapshotId, snapshotId);
          resumes += 1;
          return 'finished';
        },
      );

      assert.equal(second.kind, 'complete');
      if (second.kind !== 'complete') return;
      assert.equal(second.value, 'finished');
      assert.equal(second.resumed, true);
      assert.equal(starts, 1, 'only the first attempt may trigger paid work');
      assert.equal(resumes, 1, 'the retry must poll the saved snapshot');
      assert.match(second.warnings.join(' '), /without starting another paid job/i);
    });
  }

  it('carries an already-resolved profile and audience across a later pending stage', async () => {
    const result = await runBrightDataStage(context(), {
      platform: 'instagram',
      stage: 'instagram-posts',
      datasetId: DATASETS.instagramPost,
      now: STARTED,
    }, async () => {
      throw new PendingSnapshotError('instagram', 'sd_instagram_posts');
    }, {
      externalId: '17841400000000000',
      handle: 'bostonglobe',
    }, [{ day: '2026-08-01', followers: 812_345 }]);

    assert.equal(result.kind, 'continuation');
    if (result.kind !== 'continuation') return;
    assert.equal(result.result.profile?.externalId, '17841400000000000');
    assert.deepEqual(result.result.posts, []);
    assert.deepEqual(result.result.audience, [{ day: '2026-08-01', followers: 812_345 }]);
    assert.deepEqual(profileFromBrightDataReceipt(result.result.cursor ?? {}), {
      externalId: '17841400000000000',
      handle: 'bostonglobe',
      meta: { source: 'brightdata' },
    });
  });

  it('polls an unbound legacy Facebook receipt without starting another paid job', async () => {
    let starts = 0;
    let polls = 0;
    const result = await runBrightDataStage(context({
      source: 'brightdata',
      pendingSnapshotId: 'sd_legacy_facebook',
      pendingSince: STARTED.toISOString(),
    }), {
      platform: 'facebook',
      stage: 'facebook-page-posts',
      datasetId: DATASETS.facebookPagePosts,
      legacyStage: 'facebook-page-posts',
      legacyDatasetId: DATASETS.facebookPagePosts,
      now: new Date(STARTED.getTime() + 60 * 60 * 1000),
    }, async (resumeSnapshotId) => {
      if (resumeSnapshotId) polls += 1;
      else starts += 1;
      assert.equal(resumeSnapshotId, 'sd_legacy_facebook');
      return 'recovered';
    });

    assert.equal(result.kind, 'complete');
    if (result.kind !== 'complete') return;
    assert.equal(result.value, 'recovered');
    assert.equal(result.resumed, true);
    assert.equal(starts, 0);
    assert.equal(polls, 1);
    assert.match(result.warnings.join(' '), /predates window binding.*exact saved snapshot/i);
  });

  it('never replaces an unbound legacy Facebook receipt that is still pending', async () => {
    let starts = 0;
    let polls = 0;
    await assert.rejects(
      runBrightDataStage(context({
        source: 'brightdata',
        pendingSnapshotId: 'sd_legacy_pending',
        pendingSince: '2026-07-01T00:00:00.000Z',
      }), {
        platform: 'facebook',
        stage: 'facebook-page-posts',
        datasetId: DATASETS.facebookPagePosts,
        legacyStage: 'facebook-page-posts',
        legacyDatasetId: DATASETS.facebookPagePosts,
        now: STARTED,
      }, async (resumeSnapshotId) => {
        if (resumeSnapshotId) polls += 1;
        else starts += 1;
        assert.equal(resumeSnapshotId, 'sd_legacy_pending');
        throw new PendingSnapshotError('facebook', 'sd_legacy_pending');
      }),
      (err: unknown) => err instanceof AdapterError
        && err.opts.retryable === false
        && /receipt-only recovery poll.*No replacement was purchased/i.test(err.message),
    );
    assert.equal(starts, 0);
    assert.equal(polls, 1);
  });

  it('does not treat a partially bound receipt as legacy', async () => {
    let calls = 0;
    await assert.rejects(
      runBrightDataStage(context({
        source: 'brightdata',
        pendingSnapshotId: 'sd_partial_binding',
        pendingSince: STARTED.toISOString(),
        nextCursor: 'sd_partial_binding',
      }), {
        platform: 'facebook',
        stage: 'facebook-page-posts',
        datasetId: DATASETS.facebookPagePosts,
        legacyStage: 'facebook-page-posts',
        legacyDatasetId: DATASETS.facebookPagePosts,
        now: STARTED,
      }, async () => {
        calls += 1;
        return 'should-not-run';
      }),
      /is bound to undefined through undefined.*Refusing to trigger another paid snapshot/i,
    );
    assert.equal(calls, 0);
  });

  it('fails closed on a stage, dataset, window, or generic-cursor mismatch', async () => {
    const validCursor = {
      source: 'brightdata',
      brightDataStage: 'instagram-profile',
      brightDataDatasetId: DATASETS.instagramProfile,
      pendingSnapshotId: 'sd_exact',
      pendingSince: STARTED.toISOString(),
      nextCursor: 'sd_exact',
      windowSince: SINCE.toISOString(),
      windowUntil: UNTIL.toISOString(),
    };
    let calls = 0;
    const run = async () => {
      calls += 1;
      return 'should-not-run';
    };

    await assert.rejects(
      runBrightDataStage(context(validCursor), {
        platform: 'instagram',
        stage: 'instagram-posts',
        datasetId: DATASETS.instagramPost,
        now: new Date('2026-08-01T01:00:00.000Z'),
      }, run),
      /belongs to stage.*Refusing to trigger another paid snapshot/i,
    );
    await assert.rejects(
      runBrightDataStage(context({
        ...validCursor,
        brightDataDatasetId: DATASETS.instagramPost,
      }), {
        platform: 'instagram',
        stage: 'instagram-profile',
        datasetId: DATASETS.instagramProfile,
        now: new Date('2026-08-01T01:00:00.000Z'),
      }, run),
      /belongs to dataset.*Refusing to trigger another paid snapshot/i,
    );
    await assert.rejects(
      runBrightDataStage({
        cursor: validCursor,
        since: new Date('2026-07-02T00:00:00.000Z'),
        until: UNTIL,
      }, {
        platform: 'instagram',
        stage: 'instagram-profile',
        datasetId: DATASETS.instagramProfile,
        now: new Date('2026-08-01T01:00:00.000Z'),
      }, run),
      /is bound to.*Refusing to trigger another paid snapshot/i,
    );
    await assert.rejects(
      runBrightDataStage(context({ ...validCursor, nextCursor: 'sd_other' }), {
        platform: 'instagram',
        stage: 'instagram-profile',
        datasetId: DATASETS.instagramProfile,
        now: new Date('2026-08-01T01:00:00.000Z'),
      }, run),
      /generic continuation cursor.*Refusing to trigger another paid snapshot/i,
    );
    assert.equal(calls, 0);
  });

  it('fails closed on an empty or non-string snapshot marker', async () => {
    for (const pendingSnapshotId of ['', 12345]) {
      let calls = 0;
      await assert.rejects(
        runBrightDataStage(context({
          source: 'brightdata',
          brightDataStage: 'threads-profile',
          brightDataDatasetId: DATASETS.threadsProfile,
          pendingSnapshotId,
          pendingSince: STARTED.toISOString(),
          nextCursor: String(pendingSnapshotId),
          windowSince: SINCE.toISOString(),
          windowUntil: UNTIL.toISOString(),
        }), {
          platform: 'threads',
          stage: 'threads-profile',
          datasetId: DATASETS.threadsProfile,
          now: STARTED,
        }, async () => {
          calls += 1;
          return 'should-not-run';
        }),
        /snapshot id is empty or malformed.*Refusing to trigger another paid snapshot/i,
      );
      assert.equal(calls, 0);
    }
  });

  it('abandons a receipt older than 24 hours explicitly before a replacement attempt', async () => {
    let resumeArgument: string | undefined = 'not-called';
    const result = await runBrightDataStage(context({
      source: 'brightdata',
      brightDataStage: 'twitter-posts',
      brightDataDatasetId: DATASETS.twitterPosts,
      pendingSnapshotId: 'sd_stale',
      pendingSince: '2026-07-30T00:00:00.000Z',
      nextCursor: 'sd_stale',
      windowSince: SINCE.toISOString(),
      windowUntil: UNTIL.toISOString(),
    }), {
      platform: 'twitter',
      stage: 'twitter-posts',
      datasetId: DATASETS.twitterPosts,
      now: STARTED,
    }, async (resumeSnapshotId) => {
      resumeArgument = resumeSnapshotId;
      return 'replacement-completed';
    });

    assert.equal(result.kind, 'complete');
    if (result.kind !== 'complete') return;
    assert.equal(resumeArgument, undefined);
    assert.match(
      result.warnings.join(' '),
      /older than 24 hours.*explicitly abandoned.*one allowed automatic replacement/i,
    );
  });

  it('permits only one automatic replacement for a permanently stuck snapshot', async () => {
    let paidStarts = 0;
    let receiptPolls = 0;
    const replacement = await runBrightDataStage(context({
      source: 'brightdata',
      brightDataStage: 'threads-profile',
      brightDataDatasetId: DATASETS.threadsProfile,
      pendingSnapshotId: 'sd_original_stuck',
      pendingSince: '2026-07-30T00:00:00.000Z',
      nextCursor: 'sd_original_stuck',
      windowSince: SINCE.toISOString(),
      windowUntil: UNTIL.toISOString(),
    }), {
      platform: 'threads',
      stage: 'threads-profile',
      datasetId: DATASETS.threadsProfile,
      now: STARTED,
    }, async (resumeSnapshotId) => {
      assert.equal(resumeSnapshotId, undefined);
      paidStarts += 1;
      throw new PendingSnapshotError('threads', 'sd_replacement_stuck');
    });

    assert.equal(replacement.kind, 'continuation');
    if (replacement.kind !== 'continuation') return;
    assert.equal(replacement.result.cursor?.brightDataReplacementAttempts, 1);
    assert.equal(replacement.result.cursor?.pendingSnapshotId, 'sd_replacement_stuck');

    await assert.rejects(
      runBrightDataStage(context(replacement.result.cursor ?? {}), {
        platform: 'threads',
        stage: 'threads-profile',
        datasetId: DATASETS.threadsProfile,
        now: new Date(STARTED.getTime() + 25 * 60 * 60 * 1000),
      }, async (resumeSnapshotId) => {
        assert.equal(resumeSnapshotId, 'sd_replacement_stuck');
        receiptPolls += 1;
        throw new PendingSnapshotError('threads', 'sd_replacement_stuck');
      }),
      (err: unknown) => err instanceof AdapterError
        && err.opts.retryable === false
        && /automatic replacement limit reached/i.test(err.message),
    );

    assert.equal(paidStarts, 1, 'only one replacement may omit resumeSnapshotId');
    assert.equal(receiptPolls, 1, 'the terminal recovery attempt only polls the saved receipt');
  });

  it('can recover for free when the single replacement becomes ready on its final poll', async () => {
    let paidStarts = 0;
    const result = await runBrightDataStage(context({
      source: 'brightdata',
      brightDataStage: 'twitter-posts',
      brightDataDatasetId: DATASETS.twitterPosts,
      pendingSnapshotId: 'sd_replacement_ready',
      pendingSince: '2026-07-30T00:00:00.000Z',
      brightDataReplacementAttempts: 1,
      nextCursor: 'sd_replacement_ready',
      windowSince: SINCE.toISOString(),
      windowUntil: UNTIL.toISOString(),
    }), {
      platform: 'twitter',
      stage: 'twitter-posts',
      datasetId: DATASETS.twitterPosts,
      now: STARTED,
    }, async (resumeSnapshotId) => {
      assert.equal(resumeSnapshotId, 'sd_replacement_ready');
      if (!resumeSnapshotId) paidStarts += 1;
      return 'recovered';
    });

    assert.equal(result.kind, 'complete');
    if (result.kind !== 'complete') return;
    assert.equal(result.value, 'recovered');
    assert.equal(paidStarts, 0);
    assert.match(result.warnings.join(' '), /final receipt-only poll.*not start another paid/i);
  });

  it('fails closed if the one replacement trigger has an ambiguous outcome', async () => {
    let calls = 0;
    await assert.rejects(
      runBrightDataStage(context({
        source: 'brightdata',
        brightDataStage: 'instagram-posts',
        brightDataDatasetId: DATASETS.instagramPost,
        pendingSnapshotId: 'sd_original_stale',
        pendingSince: '2026-07-30T00:00:00.000Z',
        nextCursor: 'sd_original_stale',
        windowSince: SINCE.toISOString(),
        windowUntil: UNTIL.toISOString(),
      }), {
        platform: 'instagram',
        stage: 'instagram-posts',
        datasetId: DATASETS.instagramPost,
        now: STARTED,
      }, async (resumeSnapshotId) => {
        assert.equal(resumeSnapshotId, undefined);
        calls += 1;
        throw new Error('connection disappeared after trigger');
      }),
      (err: unknown) => err instanceof AdapterError
        && err.opts.retryable === false
        && /stopped because retrying could purchase duplicate work/i.test(err.message),
    );
    assert.equal(calls, 1);
  });

  it('fails closed on a malformed automatic replacement counter', async () => {
    let calls = 0;
    await assert.rejects(
      runBrightDataStage(context({
        source: 'brightdata',
        brightDataStage: 'facebook-page-posts',
        brightDataDatasetId: DATASETS.facebookPagePosts,
        pendingSnapshotId: 'sd_counter',
        pendingSince: STARTED.toISOString(),
        brightDataReplacementAttempts: 2,
        nextCursor: 'sd_counter',
        windowSince: SINCE.toISOString(),
        windowUntil: UNTIL.toISOString(),
      }), {
        platform: 'facebook',
        stage: 'facebook-page-posts',
        datasetId: DATASETS.facebookPagePosts,
        now: STARTED,
      }, async () => {
        calls += 1;
        return 'should-not-run';
      }),
      /automatic replacement counter is malformed/i,
    );
    assert.equal(calls, 0);
  });

  it('clears every receipt binding after a stage completes', () => {
    assert.deepEqual(clearBrightDataReceipt(), {
      brightDataStage: null,
      brightDataDatasetId: null,
      pendingSnapshotId: null,
      pendingSince: null,
      brightDataReplacementAttempts: null,
      nextCursor: null,
      windowSince: null,
      windowUntil: null,
      pendingProfileExternalId: null,
      pendingProfileHandle: null,
      pendingProfileSource: null,
    });
  });
});
