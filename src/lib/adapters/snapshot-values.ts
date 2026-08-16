/**
 * Build the value rows for one run's post_metric_snapshots insert.
 *
 * Pure on purpose: this file exists because the mapping used to live inline in
 * the runner and silently lacked the one property that matters here.
 *
 * The snapshot primary key is (post_id, captured_at), and captured_at is the
 * run's single start instant, so within one run each post may produce at most
 * ONE snapshot row. `upsertPosts` already de-duplicates its own batch by
 * external id — its comment even names the reason: Postgres refuses to update
 * the same row twice in one statement. The snapshot writer then mapped the
 * ORIGINAL, un-deduplicated post list through the id map. Whenever a vendor
 * feed overlapped itself — which Facebook's paged Bright Data payloads do
 * routinely — two occurrences of the same post became two identical
 * (post_id, captured_at) keys in one ON CONFLICT DO UPDATE statement, and the
 * whole insert failed with "cannot affect row a second time".
 *
 * That single failure was 1,054 of the errors in the eleven days before this
 * file existed, all Facebook. Because snapshots write before the cursor, every
 * failure also froze the channel's watermark and made the next run repeat the
 * same paid window.
 *
 * Later occurrences win, exactly matching upsertPosts, so the two writers can
 * never disagree about which duplicate is current.
 */

export interface SnapshotSourceRow {
  externalId: string;
  applause: number;
  conversation: number;
  amplification: number;
  saves: number;
  views: number;
  engagementTotal: number;
}

export interface SnapshotValue {
  postId: string;
  capturedAt: Date;
  applause: number;
  conversation: number;
  amplification: number;
  saves: number;
  views: number;
  engagementTotal: number;
  sourceRunId: string;
  visibility: 'public_comparable';
}

/**
 * Columns per snapshot row, for the bind-parameter budget.
 *
 * The inline version chunked by 8 while the table had grown to 10 columns
 * (source_run_id and visibility), quietly overrunning the parameter budget by
 * a quarter. Keep this equal to the field count of SnapshotValue; the test
 * suite asserts the two cannot drift apart again.
 */
export const SNAPSHOT_COLUMNS = 10;

export function snapshotValuesFor(
  postRows: readonly SnapshotSourceRow[],
  ids: ReadonlyMap<string, string>,
  capturedAt: Date,
  sourceRunId: string,
): SnapshotValue[] {
  const byPostId = new Map<string, SnapshotValue>();
  for (const row of postRows) {
    const postId = ids.get(row.externalId);
    if (!postId) continue;
    byPostId.set(postId, {
      postId,
      capturedAt,
      applause: row.applause,
      conversation: row.conversation,
      amplification: row.amplification,
      saves: row.saves,
      views: row.views,
      engagementTotal: row.engagementTotal,
      sourceRunId,
      visibility: 'public_comparable',
    });
  }
  return Array.from(byPostId.values());
}
